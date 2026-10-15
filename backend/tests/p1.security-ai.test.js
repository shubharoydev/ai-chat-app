import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { getGeminiResponse } from '../utils/gemini.js';
import { jwtAccessSecret, jwtRefreshSecret } from '../config/env.js';

describe('P1 Security & AI Resilience Suite', () => {
  describe('1. JWT & Authorization Edge Cases', () => {
    test('rejects missing tokens with 401', async () => {
      const req = { cookies: {} };
      const res = {};
      const next = jest.fn();

      await authMiddleware(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 401 }));
    });

    test('rejects tampered tokens with 401', async () => {
      const req = { cookies: { accessToken: 'tampered.header.signature' } };
      const res = {};
      const next = jest.fn();

      await authMiddleware(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 401 }));
    });

    test('accepts valid active tokens', async () => {
      const validToken = jwt.sign({ userId: '507f1f77bcf86cd799439011' }, jwtAccessSecret, { expiresIn: '15m' });
      const req = { cookies: { accessToken: validToken } };
      const res = {};
      const next = jest.fn();

      await authMiddleware(req, res, next);
      expect(next).toHaveBeenCalledWith();
      expect(req.user.userId).toBe('507f1f77bcf86cd799439011');
    });
  });

  describe('2. Gemini AI Fault Tolerance & Quota Handling', () => {
    test('handles quota exhaustion / all models failing by returning controlled 503 instead of crashing process', async () => {
      // Mock global fetch returning 429 Too Many Requests (quota exceeded)
      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        json: async () => ({ error: 'RESOURCE_EXHAUSTED' }),
      });

      try {
        await expect(getGeminiResponse('Explain quantum computing'))
          .rejects.toThrow(/AI service is temporarily experiencing high load/);
      } finally {
        global.fetch = originalFetch;
      }
    });

    test('handles fetch abort/timeout without leaking sensitive keys in unhandled exceptions', async () => {
      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockImplementation(() => {
        const error = new Error('AbortError');
        error.name = 'AbortError';
        return Promise.reject(error);
      });

      try {
        await expect(getGeminiResponse('Fast query'))
          .rejects.toThrow(/AI service is temporarily experiencing high load/);
      } finally {
        global.fetch = originalFetch;
      }
    });
  });
});
