import Joi from 'joi';

export const signupSchema = Joi.object({
  name: Joi.string().trim().min(2).max(50).required(),
  email: Joi.string().email().lowercase().required(),
  password: Joi.string().min(8).required(),
});

export const loginSchema = Joi.object({
  email: Joi.string().email().lowercase().required(),
  password: Joi.string().required(),
});

export const friendRequestSchema = Joi.object({
  email: Joi.string().email().lowercase().required(),
  nickname: Joi.string().trim().min(2).max(50).optional(),
});

export const messageSchema = Joi.object({
  friendId: Joi.string().required(),
  content: Joi.string().trim().min(1).max(1000).required(),
});

export const nicknameUpdateSchema = Joi.object({
  friendId: Joi.string().required(),
  nickname: Joi.string().trim().min(2).max(50).required(),
});