import express from 'express';
import { signup, login, refreshToken,logout } from '../controllers/authController.js';
import { validate } from '../middleware/validate.js';
import { arcjetRateLimiter } from '../middleware/arcjetRateLimiter.js';
import { logInfo, logError } from '../utils/logger.js';

const router = express.Router();

// Request logging middleware
router.use((req, res, next) => {
  logInfo(`[${new Date().toISOString()}] ${req.method} ${req.path}`, {
    body: req.body,
    query: req.query,
    params: req.params
  });
  next();
});

// Error handling middleware
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch((error) => {
    logError('Route handler error:', {
      path: req.path,
      method: req.method,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
    next(error);
  });
};

// Signup route with validation and rate limiting (5 tokens per 10 seconds)
router.post(
  '/signup',
  validate('signup'),
  asyncHandler(arcjetRateLimiter(5, '10s')), // 5 requests per 10 seconds
  asyncHandler(signup)
);

// Login route with validation and rate limiting (10 tokens per 10 seconds)
router.post(
  '/login',
  validate('login'),
  asyncHandler(arcjetRateLimiter(10, '10s')), // 10 requests per 10 seconds
  asyncHandler(login)
);

// Refresh token route with rate limiting (5 tokens per minute)
router.post(
  '/refresh-token',
  asyncHandler(arcjetRateLimiter(5, '60s')), // 5 requests per minute
  asyncHandler(refreshToken)
);

// Logout route with rate limiting (5 tokens per minute)
router.post(
  '/logout',
  asyncHandler(arcjetRateLimiter(5, '60s')), // 5 requests per minute
  asyncHandler(logout)
);

// Health check endpoint
router.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
  });
});

export default router;