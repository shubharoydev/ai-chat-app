import { createError } from './errorHandler.js';
import { logError } from './logger.js';

export const getGeminiResponse = async (query) => {
  const preprompt = "Reply to the point. The answer should be concise and informative, not exceeding 100-150 words.\n\nUser: ";

  try {
    const response = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' + process.env.GEMINI_API_KEY,
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
      }
    );

    if (!response.ok) {
      throw new Error(`Gemini API request failed: ${response.statusText}`);
    }

    const data = await response.json();
    const aiResponse = data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response from AI';
    return aiResponse;
  } catch (error) {
    logError('Failed to get Gemini response', error);
    throw createError(500, 'Failed to get AI response', error);
  }
};
