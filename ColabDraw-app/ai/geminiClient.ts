/**
 * Smart Canvas AI - Gemini API Client
 *
 * Handles communication with Google's Gemini 2.5 Flash API
 * for high-quality canvas analysis.
 *
 * Rate limiting: 15 requests/day per user using the default API key.
 * Users can provide their own key for unlimited usage.
 */

import type { GeminiUsage } from "./types";

// ============================================================================
// Configuration
// ============================================================================

// Gemini 2.5 Flash - Latest fast, capable model
const GEMINI_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

const DAILY_LIMIT_DEFAULT = 15; // Limit for users using default key
const DAILY_LIMIT_USER_KEY = 1500; // Much higher for user's own key

// Google AI Studio link for users to get their own key
export const GOOGLE_AI_STUDIO_URL = "https://aistudio.google.com/apikey";

// ============================================================================
// Storage Keys
// ============================================================================

const STORAGE_KEYS = {
  userApiKey: "colabdraw-gemini-api-key",
  usage: "colabdraw-gemini-usage",
  userId: "colabdraw-user-id",
};

// ============================================================================
// User Identification (for rate limiting)
// ============================================================================

function getUserId(): string {
  let userId = localStorage.getItem(STORAGE_KEYS.userId);
  if (!userId) {
    // Generate a unique user ID for rate limiting
    userId = `user_${Date.now()}_${Math.random()
      .toString(36)
      .substring(2, 11)}`;
    localStorage.setItem(STORAGE_KEYS.userId, userId);
  }
  return userId;
}

// ============================================================================
// Usage Tracking
// ============================================================================

function getTodayKey(): string {
  return new Date().toISOString().split("T")[0]; // YYYY-MM-DD
}

export function getUsage(isUserKey: boolean): GeminiUsage {
  const today = getTodayKey();
  const userId = getUserId();
  const usageKey = `${STORAGE_KEYS.usage}-${userId}`;
  const stored = localStorage.getItem(usageKey);

  if (stored) {
    try {
      const usage = JSON.parse(stored) as GeminiUsage;
      if (usage.date === today) {
        return {
          ...usage,
          limit: isUserKey ? DAILY_LIMIT_USER_KEY : DAILY_LIMIT_DEFAULT,
        };
      }
    } catch {
      // Invalid stored data, reset
    }
  }

  // New day or no data
  return {
    date: today,
    count: 0,
    limit: isUserKey ? DAILY_LIMIT_USER_KEY : DAILY_LIMIT_DEFAULT,
  };
}

function incrementUsage(): void {
  const userId = getUserId();
  const usageKey = `${STORAGE_KEYS.usage}-${userId}`;
  const usage = getUsage(false);
  usage.count += 1;
  localStorage.setItem(usageKey, JSON.stringify(usage));
}

export function canUseAPI(isUserKey: boolean): boolean {
  const usage = getUsage(isUserKey);
  return usage.count < usage.limit;
}

export function isRateLimited(): boolean {
  const apiKeyInfo = getActiveApiKey();
  if (!apiKeyInfo) {
    return true;
  }
  return !canUseAPI(apiKeyInfo.isUserKey);
}

// ============================================================================
// API Key Management
// ============================================================================

export function getUserApiKey(): string | null {
  return localStorage.getItem(STORAGE_KEYS.userApiKey);
}

export function setUserApiKey(key: string | null): void {
  if (key && key.trim()) {
    localStorage.setItem(STORAGE_KEYS.userApiKey, key.trim());
  } else {
    localStorage.removeItem(STORAGE_KEYS.userApiKey);
  }
}

export function getDefaultApiKey(): string | null {
  // Get from environment variable
  return import.meta.env.VITE_APP_GEMINI_API_KEY || null;
}

export function getActiveApiKey(): { key: string; isUserKey: boolean } | null {
  // Priority: User's own key > Default key from ENV
  const userKey = getUserApiKey();
  if (userKey) {
    return { key: userKey, isUserKey: true };
  }

  const defaultKey = getDefaultApiKey();
  if (defaultKey) {
    return { key: defaultKey, isUserKey: false };
  }

  return null;
}

export function hasUserProvidedKey(): boolean {
  return !!getUserApiKey();
}

// ============================================================================
// API Calls
// ============================================================================

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
  error?: {
    message: string;
    code: number;
  };
}

export interface GeminiAnalysisResult {
  success: boolean;
  response?: string;
  error?: string;
  rateLimited?: boolean;
}

/**
 * Analyze canvas image using Gemini 2.5 Flash API
 */
export async function analyzeWithGemini(
  imageDataUrl: string,
  customPrompt?: string,
): Promise<GeminiAnalysisResult> {
  const apiKeyInfo = getActiveApiKey();

  if (!apiKeyInfo) {
    return { success: false, error: "No Gemini API key configured" };
  }

  if (!canUseAPI(apiKeyInfo.isUserKey)) {
    return {
      success: false,
      error: `Daily limit reached (${
        getUsage(apiKeyInfo.isUserKey).limit
      } requests). Add your own API key for unlimited access.`,
      rateLimited: true,
    };
  }

  // Extract base64 data from data URL
  const base64Match = imageDataUrl.match(/^data:image\/\w+;base64,(.+)$/);
  if (!base64Match) {
    return { success: false, error: "Invalid image data" };
  }
  const base64Data = base64Match[1];

  // Build the prompt
  const prompt =
    customPrompt ||
    `You are an AI assistant analyzing a whiteboard/canvas image.

Instructions:
1. If you see a math equation (like "2+2=?" or handwritten math), solve it and give the answer clearly.
2. If you see handwritten or typed text, read it and respond appropriately.
3. If you see a diagram, flowchart, or sketch, describe what it represents.
4. If you see a question written on the canvas, answer it.
5. If you see code or pseudocode, explain it or suggest improvements.

Be direct and concise. Give the answer, not a description of what you see.
For math: show the calculation and result (e.g., "2+2 = 4").
For diagrams: describe the structure and meaning.`;

  try {
    const response = await fetch(`${GEMINI_API_URL}?key=${apiKeyInfo.key}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                inlineData: {
                  mimeType: "image/png",
                  data: base64Data,
                },
              },
              {
                text: prompt,
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 512,
        },
      }),
    });

    const data = (await response.json()) as GeminiResponse;

    if (data.error) {
      return { success: false, error: data.error.message };
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      return { success: false, error: "No response from Gemini" };
    }

    // Increment usage on success (only for default key users)
    if (!apiKeyInfo.isUserKey) {
      incrementUsage();
    }

    return { success: true, response: text.trim() };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    return { success: false, error: `API call failed: ${errorMessage}` };
  }
}

/**
 * Check if Gemini API is available and has remaining quota
 */
export function isGeminiAvailable(): boolean {
  const apiKeyInfo = getActiveApiKey();
  if (!apiKeyInfo) {
    return false;
  }
  return canUseAPI(apiKeyInfo.isUserKey);
}

/**
 * Get remaining API calls for today
 */
export function getRemainingCalls(): number {
  const apiKeyInfo = getActiveApiKey();
  if (!apiKeyInfo) {
    return 0;
  }
  const usage = getUsage(apiKeyInfo.isUserKey);
  return Math.max(0, usage.limit - usage.count);
}
