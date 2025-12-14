import { createError } from './errorHandler.js';
import { logError } from './logger.js';
import { GEMINI_API_KEY } from '../config/env.js';

export const getGeminiResponse = async (query) => {
  const preprompt = "Reply concisely (100–150 words max). Be direct and informative.\n\nUser: ";
const models = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-2.0-pro',
  'gemini-1.5-pro-002',
  'gemini-1.5-flash-002',
  'gemini-1.0-pro',
  'gemini-pro',         
  'gemini-pro-vision',  
  'text-bison-001',     
  'chat-bison-001'      
];

  for (const model of models) {
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
        }
      );

      if (!response.ok) {
        logError(`Gemini API request failed for ${model}: ${response.statusText}`);
        continue; // try next model
      }

      const data = await response.json();
      const aiResponse = data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response from AI';
      return aiResponse;
    } catch (error) {
      logError(`Failed to get Gemini response from ${model}`, error);
      // try next model if this one fails
    }
  }

  throw createError(500, 'Failed to get AI response after trying all models');
};
