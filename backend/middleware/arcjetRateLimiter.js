import arcjet, { tokenBucket } from "@arcjet/node";
import { createError } from '../utils/errorHandler.js';

// Opt-in escape hatch for local development and load testing. When
// DISABLE_ARCJET=true the middleware becomes a pass-through and the Arcjet
// client is never constructed (so no external calls are made). Default is
// false: production behaviour is unchanged.
const arcjetDisabled = process.env.DISABLE_ARCJET === 'true';

// Initialize Arcjet with environment variable for the key
const aj = arcjetDisabled ? null : arcjet({
  key: process.env.ARCJET_KEY, 
  characteristics: ["userId"], 
  rules: [
    // Create a token bucket rate limit
    tokenBucket({
      mode: process.env.NODE_ENV === 'production' ? "LIVE" : "DRY_RUN", // LIVE in production, DRY_RUN in development
      refillRate: 5, // refill 5 tokens per interval
      interval: 10, // refill every 10 seconds
      capacity: 10, // bucket maximum capacity of 10 tokens
    }),
  ],
});

/**
 * Arcjet rate limiter middleware
 * @param {Object} options - Rate limiting options
 * @param {number} options.tokens - Number of tokens to consume per request (default: 1)
 * @returns {Function} Express middleware function
 */
export const arcjetRateLimiter = (options = {}) => {
  const { tokens = 1 } = options;

  if (arcjetDisabled) {
    return (req, res, next) => next();
  }

  return async (req, res, next) => {
    try {
      // Get user ID from authenticated request or fallback to IP
      const userId = req.user?.userId || req.ip;
      
      const decision = await aj.protect(req, { 
        userId,
        requested: tokens,
        // Add any additional characteristics for more granular rate limiting
        characteristics: {
          ip: req.ip,
          method: req.method,
          path: req.path,
        },
      });

      // Set rate limit headers
      res.set({
        'X-RateLimit-Limit': decision.conformant,
        'X-RateLimit-Remaining': decision.remaining,
        'X-RateLimit-Reset': decision.resetTime,
      });

      if (decision.isDenied()) {
        // Log rate limit hits for monitoring
        console.warn('Rate limit exceeded', {
          userId,
          ip: req.ip,
          path: req.path,
          method: req.method,
          decision,
        });

        throw createError(429, 'Too Many Requests', {
          reason: decision.reason,
          retryAfter: decision.retryAfter,
        });
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

// Export the Arcjet instance in case it's needed elsewhere
export { aj as arcjet };
