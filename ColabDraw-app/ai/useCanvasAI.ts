/**
 * Smart Canvas AI - React Hook for Hybrid AI Orchestration
 *
 * Manages AI analysis using:
 * - Gemini API (primary, when available)
 * - Local models (Qwen2-VL-2B + Janus-Pro-1B) as fallback
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { randomId } from "@excalidraw/common";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { INITIAL_DOWNLOAD_STATE as DOWNLOAD_STATE_INIT } from "./types";

import {
  analyzeWithGemini,
  isGeminiAvailable,
  getUsage,
  setUserApiKey as saveUserApiKey,
  getActiveApiKey,
} from "./geminiClient";

import {
  captureCanvas,
  buildAIPrompt,
  detectBrowser,
  loadAISettings,
  saveAISettings,
} from "./aiUtils";

import type {
  AIMode,
  AIStatus,
  AIStatusStep,
  AIWorkerMessage,
  AIWorkerResponse,
  DownloadState,
  GeminiUsage,
  UseCanvasAIReturn,
} from "./types";

// ============================================================================
// Helpers
// ============================================================================

/** Generate a simple hash from canvas data URL for duplicate detection */
async function generateCanvasHash(dataUrl: string): Promise<string> {
  // Use first 10000 chars + length as a simple fingerprint
  const sample = dataUrl.slice(0, 10000) + dataUrl.length;
  // Simple hash using SubtleCrypto when available
  if (crypto.subtle) {
    const encoder = new TextEncoder();
    const data = encoder.encode(sample);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  // Fallback: simple string hash
  let hash = 0;
  for (let i = 0; i < sample.length; i++) {
    const char = sample.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return hash.toString(16);
}

// ============================================================================
// Hook
// ============================================================================

export function useCanvasAI(
  excalidrawAPI: ExcalidrawImperativeAPI | null,
  aiEnabled: boolean,
): UseCanvasAIReturn {
  // Mode & Settings
  const [aiMode, setAiModeState] = useState<AIMode>("auto");
  const [isUsingAPI, setIsUsingAPI] = useState(false);

  // Model States
  const [isQwenReady, setIsQwenReady] = useState(false);
  const [isJanusReady, setIsJanusReady] = useState(false);
  const [downloadState, setDownloadState] =
    useState<DownloadState>(DOWNLOAD_STATE_INIT);
  const [backend, setBackend] = useState<"webgpu" | "wasm" | null>(null);

  // Operation States
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [isModelLoading, setIsModelLoading] = useState(false);

  // Results
  const [aiResponse, setAiResponse] = useState<string | null>(null);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // API Usage
  const [apiUsage, setApiUsage] = useState<GeminiUsage | null>(null);

  // UI State
  const [showBrowserBanner, setShowBrowserBanner] = useState(false);

  // Refs
  const workerRef = useRef<Worker | null>(null);
  const inactivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentRequestIdRef = useRef<string | null>(null);
  const isAnalyzingRef = useRef(false);
  const settingsRef = useRef(loadAISettings());
  const lastCanvasHashRef = useRef<string | null>(null);

  // Status for real-time display
  const [status, setStatus] = useState<AIStatus>({
    step: "idle",
    message: "",
    timestamp: Date.now(),
  });

  // Helper to update status
  const updateStatus = useCallback((step: AIStatusStep, message: string) => {
    setStatus({ step, message, timestamp: Date.now() });
  }, []);

  // ============================================================================
  // Worker Setup
  // ============================================================================

  useEffect(() => {
    // Create worker
    workerRef.current = new Worker(new URL("./aiWorker.ts", import.meta.url), {
      type: "module",
    });

    // Handle worker messages
    workerRef.current.onmessage = (event: MessageEvent<AIWorkerResponse>) => {
      const data = event.data;

      switch (data.type) {
        case "download_progress":
          if (data.model && data.progress) {
            setDownloadState((prev) => {
              const updated = {
                ...prev,
                [data.model!]: data.progress!,
              };
              // Calculate overall progress
              updated.overallProgress =
                (updated.qwen.progress + updated.janus.progress) / 2;
              return updated;
            });
            setIsModelLoading(true);
          }
          break;

        case "model_ready":
          if (data.model === "qwen") {
            setIsQwenReady(true);
          }
          if (data.model === "janus") {
            setIsJanusReady(true);
          }
          if (data.backend) {
            setBackend(data.backend);
          }
          // Check if all models are ready
          setIsModelLoading(false);
          break;

        case "analyzing":
          setIsAnalyzing(true);
          break;

        case "token":
          // Streaming token update
          if (data.token) {
            setAiResponse((prev) => (prev || "") + data.token);
          }
          break;

        case "complete":
          if (data.requestId === currentRequestIdRef.current) {
            setAiResponse(data.response || null);
            isAnalyzingRef.current = false;
            setIsAnalyzing(false);
            currentRequestIdRef.current = null;
          }
          break;

        case "image_generated":
          if (data.requestId === currentRequestIdRef.current) {
            setGeneratedImage(data.imageDataUrl || null);
            setIsGeneratingImage(false);
            currentRequestIdRef.current = null;
          }
          break;

        case "cancelled":
          if (data.requestId === currentRequestIdRef.current) {
            isAnalyzingRef.current = false;
            setIsAnalyzing(false);
            currentRequestIdRef.current = null;
          }
          break;

        case "error":
          if (
            !data.requestId ||
            data.requestId === currentRequestIdRef.current
          ) {
            setError(data.error || "An error occurred");
            isAnalyzingRef.current = false;
            setIsAnalyzing(false);
            setIsGeneratingImage(false);
            setIsModelLoading(false);
            currentRequestIdRef.current = null;
          }
          break;
      }
    };

    // Check browser compatibility
    const browserInfo = detectBrowser();
    const settings = loadAISettings();
    if (!browserInfo.hasFullWebGPU && !settings.browserBannerDismissed) {
      setShowBrowserBanner(true);
    }

    // Load settings
    setAiModeState(settings.aiMode || "auto");

    // Update API usage
    const apiKeyInfo = getActiveApiKey();
    if (apiKeyInfo) {
      setApiUsage(getUsage(apiKeyInfo.isUserKey));
    }

    return () => {
      workerRef.current?.terminate();
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
      }
    };
  }, []);

  // ============================================================================
  // Mode Selection Logic
  // ============================================================================

  const shouldUseAPI = useCallback((): boolean => {
    if (aiMode === "local") {
      return false;
    }
    if (aiMode === "api") {
      return isGeminiAvailable();
    }
    // Auto mode: prefer API if available
    return isGeminiAvailable();
  }, [aiMode]);

  // ============================================================================
  // Analysis Functions
  // ============================================================================

  const analyzeCanvas = useCallback(async () => {
    if (!excalidrawAPI) {
      return;
    }
    if (isAnalyzingRef.current) {
      return;
    }
    if (isModelLoading && !shouldUseAPI()) {
      return;
    }

    // Set analyzing state
    isAnalyzingRef.current = true;
    setIsAnalyzing(true);
    setError(null);
    updateStatus("capturing", "Capturing canvas...");

    // Capture canvas
    const imageDataUrl = await captureCanvas(excalidrawAPI);
    if (!imageDataUrl) {
      isAnalyzingRef.current = false;
      setIsAnalyzing(false);
      updateStatus("idle", "");
      return;
    }

    // Generate hash to check for duplicates
    const canvasHash = await generateCanvasHash(imageDataUrl);
    if (canvasHash === lastCanvasHashRef.current) {
      // Same canvas as last analysis, skip
      isAnalyzingRef.current = false;
      setIsAnalyzing(false);
      updateStatus("idle", "");
      return;
    }
    lastCanvasHashRef.current = canvasHash;

    const requestId = randomId();
    currentRequestIdRef.current = requestId;

    // Decide whether to use API or local
    const useAPI = shouldUseAPI();
    setIsUsingAPI(useAPI);
    updateStatus(
      "processing",
      useAPI ? "Sending to Gemini API..." : "Processing with local model...",
    );

    if (useAPI) {
      // Use Gemini API
      try {
        const result = await analyzeWithGemini(imageDataUrl);

        if (currentRequestIdRef.current !== requestId) {
          return; // Request was cancelled
        }

        if (result.success) {
          setAiResponse(result.response ?? null);
          updateStatus("complete", "Response received!");
          // Update usage
          const apiKeyInfo = getActiveApiKey();
          if (apiKeyInfo) {
            setApiUsage(getUsage(apiKeyInfo.isUserKey));
          }
          // Clear status after delay
          setTimeout(() => updateStatus("idle", ""), 3000);
        } else {
          // API failed, try local if in auto mode
          if (aiMode === "auto" && isQwenReady) {
            updateStatus("processing", "API failed, trying local model...");
            workerRef.current?.postMessage({
              type: "analyze",
              image: imageDataUrl,
              prompt: buildAIPrompt(),
              requestId,
            } as AIWorkerMessage);
            return;
          }
          setError(result.error ?? null);
          updateStatus("error", result.error || "API error");
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "API error";
        setError(errorMsg);
        updateStatus("error", errorMsg);
      }

      isAnalyzingRef.current = false;
      setIsAnalyzing(false);
      currentRequestIdRef.current = null;
    } else {
      // Use local model
      if (!isQwenReady && !isModelLoading) {
        // Initialize models first
        workerRef.current?.postMessage({ type: "init" } as AIWorkerMessage);
        setIsModelLoading(true);
        isAnalyzingRef.current = false;
        setIsAnalyzing(false);
        return;
      }

      workerRef.current?.postMessage({
        type: "analyze",
        image: imageDataUrl,
        prompt: buildAIPrompt(),
        requestId,
      } as AIWorkerMessage);
    }
  }, [
    excalidrawAPI,
    isModelLoading,
    isQwenReady,
    aiMode,
    shouldUseAPI,
    updateStatus,
  ]);

  // ============================================================================
  // Image Generation
  // ============================================================================

  const generateDiagram = useCallback(
    (prompt: string) => {
      if (!isJanusReady) {
        setError("Image generation not available");
        return;
      }

      const requestId = randomId();
      currentRequestIdRef.current = requestId;
      setIsGeneratingImage(true);
      setError(null);

      workerRef.current?.postMessage({
        type: "generate_image",
        prompt,
        requestId,
      } as AIWorkerMessage);
    },
    [isJanusReady],
  );

  // ============================================================================
  // Activity Tracking & Auto-Trigger
  // ============================================================================

  const trackActivity = useCallback(() => {
    if (!aiEnabled) {
      return;
    }
    if (!settingsRef.current?.aiAutoTrigger) {
      return;
    }

    // Clear existing timer
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
    }

    // Set new timer
    const delay = (settingsRef.current?.aiInactivityDelay || 3) * 1000;
    inactivityTimerRef.current = setTimeout(() => {
      if (aiEnabled && !isAnalyzingRef.current) {
        analyzeCanvas();
      }
    }, delay);
  }, [aiEnabled, analyzeCanvas]);

  // ============================================================================
  // Actions
  // ============================================================================

  const initializeModels = useCallback(() => {
    setDownloadState(DOWNLOAD_STATE_INIT);
    setIsModelLoading(true);
    workerRef.current?.postMessage({ type: "init" } as AIWorkerMessage);
  }, []);

  const cancelOperation = useCallback(() => {
    workerRef.current?.postMessage({ type: "cancel" } as AIWorkerMessage);
    currentRequestIdRef.current = null;
    isAnalyzingRef.current = false;
    setIsAnalyzing(false);
    setIsGeneratingImage(false);
  }, []);

  const clearResponse = useCallback(() => {
    setAiResponse(null);
    setGeneratedImage(null);
    setError(null);
  }, []);

  const dismissBrowserBanner = useCallback(() => {
    setShowBrowserBanner(false);
    const settings = loadAISettings();
    saveAISettings({ ...settings, browserBannerDismissed: true });
  }, []);

  const setAIMode = useCallback((mode: AIMode) => {
    setAiModeState(mode);
    const settings = loadAISettings();
    saveAISettings({ ...settings, aiMode: mode });
    settingsRef.current = { ...settings, aiMode: mode };
  }, []);

  const setUserGeminiKey = useCallback((key: string | null) => {
    saveUserApiKey(key);
    // Update usage display
    const apiKeyInfo = getActiveApiKey();
    if (apiKeyInfo) {
      setApiUsage(getUsage(apiKeyInfo.isUserKey));
    } else {
      setApiUsage(null);
    }
  }, []);

  // Refresh API usage state (used after external key changes)
  const refreshApiUsage = useCallback(() => {
    const apiKeyInfo = getActiveApiKey();
    if (apiKeyInfo) {
      setApiUsage(getUsage(apiKeyInfo.isUserKey));
    } else {
      setApiUsage(null);
    }
  }, []);

  // ============================================================================
  // Return
  // ============================================================================

  return {
    // Mode & Settings
    aiMode,
    isUsingAPI,

    // Model States
    isQwenReady,
    isJanusReady,
    downloadState,
    backend,

    // Operation States
    isAnalyzing,
    isGeneratingImage,
    isModelLoading,

    // Results
    aiResponse,
    generatedImage,
    error,

    // API Usage
    apiUsage,

    // UI State
    showBrowserBanner,
    status,

    // Actions
    initializeModels,
    analyzeCanvas,
    generateDiagram,
    cancelOperation,
    clearResponse,
    trackActivity,
    dismissBrowserBanner,
    setAIMode,
    setUserGeminiKey,
    refreshApiUsage,
  };
}
