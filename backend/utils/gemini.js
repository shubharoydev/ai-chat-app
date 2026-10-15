import { createError } from './errorHandler.js';
import { logError } from './logger.js';
import { GEMINI_API_KEY } from '../config/env.js';

export const getGeminiResponse = async (query) => {
  if (!GEMINI_API_KEY) {
    throw createError(503, 'AI service is temporarily unavailable (API key not configured)');
  }

  const preprompt = "Reply concisely (100–150 words max). Be direct and informative.\n\nUser: ";
  const models = [
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-1.5-flash',
    'gemini-1.5-pro'
  ];

  for (const model of models) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000); // 8-second timeout per model attempt

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  { text: preprompt + query }
                ]
              }
            ]
          }),
          signal: controller.signal,
        }
      );

      clearTimeout(timeout);

      if (!response.ok) {
        // Redact key and query from logs
        logError('Gemini API request failed', {
          model,
          status: response.status,
          statusText: response.statusText,
        });
        continue; // try next model
      }

      const data = await response.json();
      const aiResponse = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!aiResponse) {
        logError('Gemini response missing text candidate', { model });
        continue;
      }

      return aiResponse.trim();
    } catch (error) {
      clearTimeout(timeout);
      const isTimeout = error.name === 'AbortError';
      logError('Gemini request failed', {
        model,
        reason: isTimeout ? 'Request timed out (8s)' : error.message,
      });
    }
  }

  throw createError(503, 'AI service is temporarily experiencing high load. Please try again shortly.');
};
