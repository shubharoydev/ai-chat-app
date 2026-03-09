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
  const getSafeMessage = (error) => {
    const rawMessage = error?.message || (typeof error === 'string' ? error : 'No detail provided');
    return typeof rawMessage === 'string' ? rawMessage.substring(0, 100) + '...' : 'Invalid error object';
  };

  const safeError = err.originalError ? { message: getSafeMessage(err.originalError) } : { message: getSafeMessage(err) };
  logError('❌ ' + message, safeError);
  res.status(status).json({
    error: {
      status,
      message,
    },
  });
};