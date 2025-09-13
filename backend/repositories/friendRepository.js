import { Friend } from '../models/friendModel.js';
import { createError } from '../utils/errorHandler.js';

export const createFriend = async (userId, friendId, nickname = null) => {
  try {
    // Check for existing friend
    const existingFriend = await Friend.findOne({ userId, friendId });
    if (existingFriend) {
      throw createError(400, 'Friend already added');
    }

    const friend = new Friend({ userId, friendId, nickname });
    await friend.save();
    return friend;
  } catch (error) {
    if (error.code === 11000) {
      throw createError(400, 'Friend already added');
    }
    throw createError(error.status || 500, error.message || 'Failed to add friend', error);
  }
};

export const updateFriendNickname = async (userId, friendId, nickname) => {
  try {
    const friend = await Friend.findOneAndUpdate(
      { userId, friendId },
      { nickname },
      { new: true }
    );
    if (!friend) {
      throw createError(404, 'Friend not found');
    }
    return friend;
  } catch (error) {
    throw createError(error.status || 500, error.message || 'Failed to update nickname', error);
  }
};

export const getAddedFriends = async (userId) => {
  try {
    return await Friend.find({ userId })
      .populate('friendId', 'name email')
      .lean();
  } catch (error) {
    throw createError(500, 'Failed to retrieve friends', error);
  }
};

export const findFriendship = async (userId, friendId) => {
  try {
    return await Friend.findOne({ userId, friendId });
  } catch (error) {
    throw createError(500, 'Failed to find friendship', error);
  }
};

export const findMutualFriendship = async (userId, friendId) => {
  try {
    return await Friend.findOne({
      $or: [
        { userId, friendId },
        { userId: friendId, friendId: userId },
      ],
    });
  } catch (error) {
    throw createError(500, 'Failed to find mutual friendship', error);
  }
};