import { User } from '../models/userModel.js';
import { createError } from '../utils/errorHandler.js';

export const createUser = async ({ name, email, password }) => {
  try {
    const user = new User({ name, email, password });
    await user.save();
    return { id: user._id, name, email };
  } catch (error) {
    if (error.code === 11000) {
      throw createError(409, 'Email already exists');
    }
    throw createError(500, 'Failed to create user', error);
  }
};

export const findUserByEmail = async (email) => {
  try {
    const user = await User.findOne({ email }).select('+password'); // Include password for login
    if (!user) {
      throw createError(404, 'User not found');
    }
    return user;
  } catch (error) {
    throw createError(error.status || 500, error.message || 'Failed to find user', error);
  }
};

export const searchUsers = async (query, limit = 10) => {
  try {
    const users = await User.find(
      {
        $or: [
          { name: { $regex: query, $options: 'i' } },
          { email: { $regex: query, $options: 'i' } },
        ],
      },
      { name: 1, email: 1 }
    ).limit(limit);
    return users;
  } catch (error) {
    throw createError(500, 'Failed to search users', error);
  }
};