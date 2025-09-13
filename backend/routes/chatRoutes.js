import express from 'express';
import { sendMessage, getMessages } from '../controllers/chatController.js';
import { validate } from '../middleware/validate.js';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { arcjetRateLimiter } from '../middleware/arcjetRateLimiter.js';

const router = express.Router();

// Send message route with authentication, validation, and rate limiting (10 tokens per 10 seconds)
router.post('/messages', 
  authMiddleware, 
  validate('message'), 
  arcjetRateLimiter({ tokens: 2 }), 
  sendMessage
);

// Get messages route with authentication and rate limiting (20 tokens per 10 seconds)
router.get('/messages/:friendId', 
  authMiddleware, 
  arcjetRateLimiter({ tokens: 1 }), 
  getMessages
);

export default router;