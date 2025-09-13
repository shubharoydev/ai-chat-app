import Joi from 'joi';
import { createError } from '../utils/errorHandler.js';

// Validation schemas
const signupSchema = Joi.object({
  name: Joi.string().trim().min(2).max(50).required(),
  email: Joi.string().email().lowercase().required(),
  password: Joi.string().min(8).required(),
});

const loginSchema = Joi.object({
  email: Joi.string().email().lowercase().required(),
  password: Joi.string().required(),
});

const friendRequestSchema = Joi.object({
  email: Joi.string().email().lowercase().required(),
});

const messageSchema = Joi.object({
  friendId: Joi.string().required(),
  content: Joi.string().trim().min(1).max(1000).required(),
});

export const validate = (type) => {
  const schemas = {
    signup: signupSchema,
    login: loginSchema,
    friendRequest: friendRequestSchema,
    message: messageSchema,
  };

  return (req, res, next) => {
    try {
      const schema = schemas[type];
      if (!schema) {
        throw createError(500, 'Invalid validation type');
      }

      const { error } = schema.validate(req.body, { abortEarly: false });
      if (error) {
        const errorMessage = error.details.map((detail) => detail.message).join(', ');
        throw createError(400, errorMessage);
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};