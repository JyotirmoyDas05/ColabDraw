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

// AI Server Endpoints (ColabDraw-room server)
const SERVER_URL = "http://localhost:3002";
const GEMINI_API_URL = `${SERVER_URL}/api/analyze-canvas`;
const GEMINI_IMAGE_API_URL = `${SERVER_URL}/api/generate-image`;

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

/**
 * Check if user has exhausted their quota (not whether API is available)
 * Only returns true when quota is actually used up.
 */
export function isRateLimited(): boolean {
  const apiKeyInfo = getActiveApiKey();
  // If no API key exists, we're not "rate limited" - API is just unavailable
  if (!apiKeyInfo) {
    return false;
  }
  // Only rate limited if we have a key but quota is exhausted
  return !canUseAPI(apiKeyInfo.isUserKey);
}

/**
 * Check if any API key is configured (user or default)
 */
export function hasApiKey(): boolean {
  return getActiveApiKey() !== null;
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

// ============================================================================
// API Types
// ============================================================================

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
    // Use server proxy for AI requests
    const response = await fetch(GEMINI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt,
        image_data: imageDataUrl,
      }),
    });

    // Check for HTTP errors first
    if (!response.ok) {
      if (response.status === 429) {
        return {
          success: false,
          error:
            "Rate limit exceeded. Please wait a moment and try again, or add your own API key for higher limits.",
          rateLimited: true,
        };
      }
      if (response.status === 503) {
        return {
          success: false,
          error:
            "Gemini service is temporarily unavailable. Please try again in a few seconds.",
        };
      }
      return {
        success: false,
        error: `API error (${response.status}): ${response.statusText}`,
      };
    }

    const data = await response.json();

    if (!data.success) {
      const errorMsg = data.error || "API error";
      if (
        errorMsg.toLowerCase().includes("quota") ||
        errorMsg.toLowerCase().includes("rate")
      ) {
        return { success: false, error: errorMsg, rateLimited: true };
      }
      return { success: false, error: errorMsg };
    }

    const text = data.response;
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

// ============================================================================
// Image Generation
// ============================================================================

export interface GeminiImageResult {
  success: boolean;
  imageData?: string; // base64 PNG
  error?: string;
  rateLimited?: boolean;
}

/**
 * Generate refined diagram image using Gemini's image generation model.
 * Takes a sketch and prompt, returns a clean PNG image.
 */
export async function generateImageWithGemini(
  imageDataUrl: string,
  customPrompt?: string,
): Promise<GeminiImageResult> {
  const apiKeyInfo = getActiveApiKey();

  if (!apiKeyInfo) {
    return { success: false, error: "No Gemini API key configured" };
  }

  if (!canUseAPI(apiKeyInfo.isUserKey)) {
    return {
      success: false,
      error: `Daily limit reached. Add your own API key for unlimited access.`,
      rateLimited: true,
    };
  }

  // Build the prompt for diagram refinement
  const prompt =
    customPrompt ||
    `Generate a clean, high-quality, professional diagram as a PNG image based on the provided reference image.

IMPORTANT INTERPRETATION RULE:
- Treat the reference image as a rough sketch or visual hint, NOT as a final diagram.
- You are allowed and expected to redraw, correct, and standardize shapes, proportions, and outlines to create a proper textbook-style diagram.

Diagram guidelines:
- Use a clean white background.
- Replace all rough, hand-drawn, or uneven outlines with precise, smooth, and well-proportioned shapes.
- Redraw objects using correct canonical forms (e.g., cylinders, boxes, arrows, tubes) even if the sketch is distorted or incomplete.
- Do NOT trace the sketch. Reconstruct the diagram clearly and accurately.
- Use consistent line thickness and clean geometry.
- Use arrows and connectors to clearly show structure, flow, or relationships.
- Include and clearly label all entities, components, and relationships.
- If the sketch is ambiguous, resolve it into the most reasonable and standard diagram.

Text handling:
- Preserve any text or labels from the reference image exactly if they exist.
- Add missing labels ONLY if they are clearly implied.

Output requirements:
- Output only the generated PNG image.
- Do not include any text, explanations, or captions outside the image.`;

  try {
    const response = await fetch(GEMINI_IMAGE_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt,
        image_data: imageDataUrl,
      }),
    });

    // Check for HTTP errors first
    if (!response.ok) {
      if (response.status === 429) {
        return {
          success: false,
          error:
            "Rate limit exceeded. Please wait a moment and try again, or add your own API key for higher limits.",
          rateLimited: true,
        };
      }
      if (response.status === 503 || response.status === 504) {
        return {
          success: false,
          error:
            "Gemini service is temporarily unavailable or timed out. Please try again in a few seconds.",
        };
      }
      return {
        success: false,
        error: `API error (${response.status}): ${response.statusText}`,
      };
    }

    const data = await response.json();

    if (!data.success) {
      // Check if error message indicates rate limiting
      const errorMsg = data.error || "API error";
      const isRateLimit =
        data.rateLimited ||
        errorMsg.toLowerCase().includes("quota") ||
        errorMsg.toLowerCase().includes("rate");

      return { success: false, error: errorMsg, rateLimited: isRateLimit };
    }

    // Extract image from response
    const imageData = data.image_data;
    if (!imageData) {
      return { success: false, error: "No image in response" };
    }

    // Increment usage on success (only for default key users)
    if (!apiKeyInfo.isUserKey) {
      incrementUsage();
    }

    return { success: true, imageData };
  } catch (err) {
    const error = err instanceof Error ? err.message : "Unknown error";
    return { success: false, error };
  }
}
