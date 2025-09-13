import { addFriend as addFriendService, updateFriendNickname as updateFriendNicknameService, searchUser as searchUserService, getFriendList as getFriendListService } from '../services/userService.js';
import { createError } from '../utils/errorHandler.js';

export const addFriend = async (req, res, next) => {
  try {
    const { email, nickname } = req.body;
    const userId = req.user.userId;

    const result = await addFriendService(userId, email, nickname);
    res.status(201).json({ message: 'Friend added', friend: result.friend });
  } catch (error) {
    next(error);
  }
};

export const updateFriendNickname = async (req, res, next) => {
  try {
    const { friendId, nickname } = req.body;
    const userId = req.user.userId;

    if (!friendId || !nickname) throw createError(400, 'Friend ID and nickname are required');

    const result = await updateFriendNicknameService(userId, friendId, nickname);
    res.json({ message: 'Nickname updated', friend: result.friend });
  } catch (error) {
    next(error);
  }
};

export const searchUser = async (req, res, next) => {
  try {
    const { query } = req.query;
    const users = await searchUserService(query);
    res.json({ users });
  } catch (error) {
    next(error);
  }
};

export const getFriendList = async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const friends = await getFriendListService(userId);
    res.json({ friends });
  } catch (error) {
    next(error);
  }
};