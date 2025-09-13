import express from 'express';
import { addFriend, updateFriendNickname, searchUser, getFriendList } from '../controllers/userController.js';
import { validate } from '../middleware/validate.js';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { arcjetRateLimiter } from '../middleware/arcjetRateLimiter.js';

const router = express.Router();

// Friend management routes with rate limiting
router.post('/friends', 
  authMiddleware, 
  validate('friendRequest'), 
  arcjetRateLimiter({ tokens: 2 }), 
  addFriend
);

router.put('/friends/nickname', 
  authMiddleware, 
  validate('nicknameUpdate'), 
  arcjetRateLimiter({ tokens: 2 }), 
  updateFriendNickname
);

// Search and friend list routes with rate limiting
router.get('/search', 
  authMiddleware, 
  arcjetRateLimiter({ tokens: 1 }), 
  searchUser
);

router.get('/friends', 
  authMiddleware, 
  arcjetRateLimiter({ tokens: 1 }), 
  getFriendList
);

export default router;