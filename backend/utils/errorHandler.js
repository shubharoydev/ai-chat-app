import { logError } from './logger.js';

export const createError = (status, message, error = null) => {
  const err = new Error(message);
  err.status = status;
  if (error) {
    err.originalError = error;
  }
  return err;
};

export const globalErrorHandler = (err, req, res, next) => {
  const status = err.status || 500;
  const message = err.message || 'Internal server error';
  const safeError = err.originalError ? { message: err.originalError.message.substring(0, 100) + '...' } : { message: err.message.substring(0, 100) + '...' };
  logError('❌ ' + message, safeError); // Add ❌ prefix and mask error message
  res.status(status).json({
    error: {
      status,
      message,
    },
  });
};