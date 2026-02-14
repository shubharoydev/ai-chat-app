import { User } from '../models/userModel.js';
import { createFriend, updateFriendNickname as updateFriendNicknameInDB, getAddedFriends, findMutualFriendship } from '../repositories/friendRepository.js';
import { getMessagesByChatId } from '../repositories/messageRepository.js';
import { getRedisClient } from '../config/redisSetup.js';

import { createError } from '../utils/errorHandler.js';
import { Friend } from '../models/friendModel.js';

export const addFriend = async (userId, email, nickname = null) => {
  const friend = await User.findOne({ email });
  if (!friend) throw createError(404, 'User not found');

  if (friend._id.toString() === userId) {
    throw createError(400, 'Cannot add yourself as a friend');
  }

  const friendId = friend._id.toString();

  // Check if friendship already exists in either direction
  const alreadyFriend = await Friend.exists({
    $or: [
      { userId, friendId },
      { userId: friendId, friendId: userId }
    ]
  });

  if (alreadyFriend) {
    throw createError(409, 'Already friends');
  }

  // Create two-way friendship
  const [userToFriend, friendToUser] = await Promise.all([
    createFriend(userId, friendId, nickname),
    createFriend(friendId, userId, null) // Optionally allow B to set nickname later
  ]);

  return {
    friend: {
      id: friendId,
      name: friend.name,
      email: friend.email,
      nickname: userToFriend.nickname
    },
    message: 'Friend added successfully (mutual)'
  };
};

export const updateFriendNickname = async (userId, friendId, nickname) => {
  const friend = await updateFriendNicknameInDB(userId, friendId, nickname);
  return { friend: { id: friend.friendId, nickname: friend.nickname } };
};

export const searchUser = async (query) => {
  if (!query) throw createError(400, 'Search query is required');

  const redisClient = getRedisClient();
  const cacheKey = `search:${query.toLowerCase()}`;
  const cachedUsers = await redisClient.get(cacheKey);
  if (cachedUsers) {
    return JSON.parse(cachedUsers);
  }

  const users = await User.find(
    {
      $or: [
        { name: { $regex: query, $options: 'i' } },
        { email: { $regex: query, $options: 'i' } },
      ],
    },
    { name: 1, email: 1 }
  ).limit(10);

  if (!users.length) throw createError(404, 'No users found');

  await redisClient.setWithExpiry(cacheKey, JSON.stringify(users), 300);
  return users;
};

export const getFriendList = async (userId) => {
  const friends = await getAddedFriends(userId);
  const friendList = [];

  for (const friend of friends) {
    const friendId = friend.friendId._id.toString();
    const chatId = [userId, friendId].sort().join(':');

    // Only include friends added by the user
    if (friend.userId.toString() === userId) {
      friendList.push({
        id: friendId,
        name: friend.nickname || friend.friendId.name,
        email: friend.friendId.email,
      });
    }

    // Include friends who sent messages, even if not added by user
    const redisClient = getRedisClient();
    const redisMessages = await redisClient.lrange(`chat:${chatId}`, 0, -1);
    const hasMessages = redisMessages.some(msg => JSON.parse(msg).senderId === friendId);

    if (hasMessages && !friendList.some(f => f.id === friendId)) {
      friendList.push({
        id: friendId,
        name: friend.friendId.name, // Use original name, as user didn't set nickname
        email: friend.friendId.email,
      });
    }
  }

  return friendList;
};