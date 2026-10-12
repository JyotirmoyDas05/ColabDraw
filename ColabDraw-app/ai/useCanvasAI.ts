/**
 * Smart Canvas AI - React Hook for Hybrid AI Orchestration
 *
 * Manages AI analysis using:
 * - Gemini API (primary, when available)
 * - Local models (Qwen2-VL-2B + Janus-Pro-1B) as fallback
 *
 * State Machine: DISABLED → IDLE → ARMED → RUNNING → COOLDOWN
 * - Prevents infinite loops from AI-originated onChange events
 * - Deduplicates canvas analysis using content signatures
 * - Supports cancellation via AbortController
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { randomId } from "@excalidraw/common";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { INITIAL_DOWNLOAD_STATE as DOWNLOAD_STATE_INIT } from "./types";

import {
  analyzeWithGemini,
  generateImageWithGemini,
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
  AIOutputMode,
  AIRunState,
  AIStatus,
  AIStatusStep,
  AIWorkerMessage,
  AIWorkerResponse,
  DownloadState,
  GeminiUsage,
  UseCanvasAIReturn,
} from "./types";

// ============================================================================
// Constants
// ============================================================================

const COOLDOWN_DURATION_MS = 2000; // 2 seconds cooldown after AI applies result
const DEFAULT_INACTIVITY_DELAY_MS = 3000; // 3 seconds

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

/** Generate signature from text elements for deduplication */
function generateElementsSignature(elements: readonly any[]): string {
  const textElements = elements
    .filter((el) => el.type === "text" && !el.isDeleted)
    .map((el) => `${el.id}:${el.version}:${el.text}`)
    .sort()
    .join("|");
  return textElements;
}

// ============================================================================
// Hook
// ============================================================================

export function useCanvasAI(
  excalidrawAPI: ExcalidrawImperativeAPI | null,
  aiEnabled: boolean,
): UseCanvasAIReturn {
  // ============================================================================
  // State Machine
  // ============================================================================
  const [runState, setRunState] = useState<AIRunState>("DISABLED");

  // Mode & Settings
  const [aiMode, setAiModeState] = useState<AIMode>("auto");
  const [outputMode, setOutputModeState] = useState<AIOutputMode>("text");
  const [isUsingAPI, setIsUsingAPI] = useState(false);
  const [autoRunEnabled, setAutoRunEnabledState] = useState(false);
  const [selectionOnly, setSelectionOnlyState] = useState(false);

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
  const [partialResponse, setPartialResponse] = useState<string | null>(null);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // API Usage
  const [apiUsage, setApiUsage] = useState<GeminiUsage | null>(null);

  // UI State
  const [showBrowserBanner, setShowBrowserBanner] = useState(false);

  // Refs
  const workerRef = useRef<Worker | null>(null);
  const inactivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cooldownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentRequestIdRef = useRef<string | null>(null);
  const settingsRef = useRef(loadAISettings());
  const lastCanvasHashRef = useRef<string | null>(null);
  const lastElementsSignatureRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Guard: Set to true before applying AI results to canvas
  const isApplyingAIRef = useRef(false);

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
  // State Machine Transitions
  // ============================================================================

  // Sync runState with aiEnabled
  useEffect(() => {
    if (!aiEnabled) {
      setRunState("DISABLED");
      // Clear any pending timers
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
        inactivityTimerRef.current = null;
      }
      if (cooldownTimerRef.current) {
        clearTimeout(cooldownTimerRef.current);
        cooldownTimerRef.current = null;
      }
    } else if (runState === "DISABLED") {
      setRunState("IDLE");
    }
  }, [aiEnabled, runState]);

  // Transition to IDLE after cooldown
  const startCooldown = useCallback(() => {
    setRunState("COOLDOWN");
    if (cooldownTimerRef.current) {
      clearTimeout(cooldownTimerRef.current);
    }
    cooldownTimerRef.current = setTimeout(() => {
      setRunState("IDLE");
      cooldownTimerRef.current = null;
    }, COOLDOWN_DURATION_MS);
  }, []);

  // ============================================================================
  // Worker Setup
  // ============================================================================

  useEffect(() => {
    // Web Workers are unavailable in some environments (e.g. jsdom in tests)
    if (typeof Worker === "undefined") {
      return;
    }

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
            setPartialResponse((prev) => (prev || "") + data.token);
          }
          break;

        case "complete":
          if (data.requestId === currentRequestIdRef.current) {
            setAiResponse(data.response || null);
            setPartialResponse(null);
            setIsAnalyzing(false);
            currentRequestIdRef.current = null;
            updateStatus("complete", "Response received!");
            // Start cooldown after completion
            startCooldown();
            // Clear status after delay
            setTimeout(() => updateStatus("idle", ""), 3000);
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
            setIsAnalyzing(false);
            setPartialResponse(null);
            currentRequestIdRef.current = null;
            setRunState((prev) => (prev === "RUNNING" ? "IDLE" : prev));
          }
          break;

        case "error":
          if (
            !data.requestId ||
            data.requestId === currentRequestIdRef.current
          ) {
            setError(data.error || "An error occurred");
            setIsAnalyzing(false);
            setIsGeneratingImage(false);
            setIsModelLoading(false);
            setPartialResponse(null);
            currentRequestIdRef.current = null;
            setRunState((prev) => (prev === "RUNNING" ? "IDLE" : prev));
            updateStatus("error", data.error || "An error occurred");
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
    setAutoRunEnabledState(settings.aiAutoTrigger ?? false);

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
      if (cooldownTimerRef.current) {
        clearTimeout(cooldownTimerRef.current);
      }
    };
  }, [startCooldown, updateStatus]);

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

  const analyzeCanvas = useCallback(
    async (customPrompt?: string) => {
      if (!excalidrawAPI) {
        return;
      }
      if (runState === "RUNNING" || runState === "COOLDOWN") {
        return;
      }
      if (isModelLoading && !shouldUseAPI()) {
        return;
      }

      // Transition to RUNNING
      setRunState("RUNNING");
      setIsAnalyzing(true);
      setError(null);
      setPartialResponse(null);
      updateStatus("capturing", "Capturing canvas...");

      // Create abort controller for this request
      abortControllerRef.current = new AbortController();

      // Capture canvas (selection only if enabled)
      const imageDataUrl = await captureCanvas(excalidrawAPI, selectionOnly);
      if (!imageDataUrl) {
        setIsAnalyzing(false);
        setRunState("IDLE");
        updateStatus("idle", "");
        return;
      }

      // Deduplication: Check canvas hash
      const canvasHash = await generateCanvasHash(imageDataUrl);
      if (!customPrompt && canvasHash === lastCanvasHashRef.current) {
        // Same canvas as last analysis, skip
        setIsAnalyzing(false);
        setRunState("IDLE");
        updateStatus("idle", "");
        return;
      }

      // Also check elements signature for text-based dedup
      const elements = excalidrawAPI.getSceneElements();
      const elementsSignature = generateElementsSignature(elements);
      if (
        !customPrompt &&
        elementsSignature === lastElementsSignatureRef.current
      ) {
        setIsAnalyzing(false);
        setRunState("IDLE");
        updateStatus("idle", "");
        return;
      }

      lastCanvasHashRef.current = canvasHash;
      lastElementsSignatureRef.current = elementsSignature;

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
          // Branch based on output mode
          if (outputMode === "image") {
            // Image generation mode
            updateStatus("processing", "Generating refined diagram...");
            const result = await generateImageWithGemini(
              imageDataUrl,
              customPrompt || undefined,
            );

            // Check if aborted
            if (abortControllerRef.current?.signal.aborted) {
              setIsAnalyzing(false);
              setRunState("IDLE");
              return;
            }

            if (currentRequestIdRef.current !== requestId) {
              return; // Request was cancelled
            }

            if (result.success && result.imageData) {
              setGeneratedImage(result.imageData);
              updateStatus("complete", "Diagram generated!");
              // Update usage
              const apiKeyInfo = getActiveApiKey();
              if (apiKeyInfo) {
                setApiUsage(getUsage(apiKeyInfo.isUserKey));
              }
              // Start cooldown
              startCooldown();
              // Clear status after delay
              setTimeout(() => updateStatus("idle", ""), 3000);
            } else {
              setError(result.error ?? "Failed to generate image");
              updateStatus("error", result.error || "Image generation failed");
              setRunState("IDLE");
            }
          } else {
            // Text analysis mode (existing flow)
            const result = await analyzeWithGemini(
              imageDataUrl,
              customPrompt || undefined,
            );

            // Check if aborted
            if (abortControllerRef.current?.signal.aborted) {
              setIsAnalyzing(false);
              setRunState("IDLE");
              return;
            }

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
              // Start cooldown
              startCooldown();
              // Clear status after delay
              setTimeout(() => updateStatus("idle", ""), 3000);
            } else {
              // API failed, try local if in auto mode
              if (aiMode === "auto" && isQwenReady) {
                updateStatus("processing", "API failed, trying local model...");
                workerRef.current?.postMessage({
                  type: "analyze",
                  image: imageDataUrl,
                  prompt: customPrompt || buildAIPrompt(),
                  requestId,
                } as AIWorkerMessage);
                return;
              }
              setError(result.error ?? null);
              updateStatus("error", result.error || "API error");
              setRunState("IDLE");
            }
          }
        } catch (err) {
          if (abortControllerRef.current?.signal.aborted) {
            setIsAnalyzing(false);
            setRunState("IDLE");
            return;
          }
          const errorMsg = err instanceof Error ? err.message : "API error";
          setError(errorMsg);
          updateStatus("error", errorMsg);
          setRunState("IDLE");
        }

        setIsAnalyzing(false);
        currentRequestIdRef.current = null;
      } else {
        // Use local model
        if (!isQwenReady && !isModelLoading) {
          // Initialize models first
          workerRef.current?.postMessage({ type: "init" } as AIWorkerMessage);
          setIsModelLoading(true);
          setIsAnalyzing(false);
          setRunState("IDLE");
          return;
        }

        workerRef.current?.postMessage({
          type: "analyze",
          image: imageDataUrl,
          prompt: customPrompt || buildAIPrompt(),
          requestId,
        } as AIWorkerMessage);
      }
    },
    [
      excalidrawAPI,
      runState,
      isModelLoading,
      isQwenReady,
      aiMode,
      outputMode,
      selectionOnly,
      shouldUseAPI,
      updateStatus,
      startCooldown,
    ],
  );

  // ============================================================================
  // Run with custom prompt (for AI Panel)
  // ============================================================================

  const runWithPrompt = useCallback(
    async (prompt: string) => {
      await analyzeCanvas(prompt);
    },
    [analyzeCanvas],
  );

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
    // Guard: Ignore AI-originated changes
    if (isApplyingAIRef.current) {
      // Reset the flag for next onChange
      isApplyingAIRef.current = false;
      return;
    }

    // Don't track if disabled or in cooldown
    if (runState === "DISABLED" || runState === "COOLDOWN") {
      return;
    }

    // Cancel current request if running
    if (runState === "RUNNING") {
      abortControllerRef.current?.abort();
      workerRef.current?.postMessage({ type: "cancel" } as AIWorkerMessage);
      currentRequestIdRef.current = null;
      setIsAnalyzing(false);
      setPartialResponse(null);
      updateStatus("idle", "Cancelled - user activity detected");
    }

    // Only arm if auto-run is enabled
    if (!autoRunEnabled) {
      setRunState("IDLE");
      return;
    }

    // Transition to ARMED and start/reset inactivity timer
    setRunState("ARMED");

    // Clear existing timer
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
    }

    // Set new timer
    const delay =
      (settingsRef.current?.aiInactivityDelay || 3) * 1000 ||
      DEFAULT_INACTIVITY_DELAY_MS;
    inactivityTimerRef.current = setTimeout(() => {
      // Only trigger if still armed
      if (runState === "ARMED" || runState === "IDLE") {
        analyzeCanvas();
      }
    }, delay);
  }, [runState, autoRunEnabled, analyzeCanvas, updateStatus]);

  // ============================================================================
  // Actions
  // ============================================================================

  const initializeModels = useCallback(() => {
    setDownloadState(DOWNLOAD_STATE_INIT);
    setIsModelLoading(true);
    workerRef.current?.postMessage({ type: "init" } as AIWorkerMessage);
  }, []);

  const cancelOperation = useCallback(() => {
    abortControllerRef.current?.abort();
    workerRef.current?.postMessage({ type: "cancel" } as AIWorkerMessage);
    currentRequestIdRef.current = null;
    setIsAnalyzing(false);
    setIsGeneratingImage(false);
    setPartialResponse(null);
    setRunState((prev) =>
      prev === "RUNNING" || prev === "ARMED" ? "IDLE" : prev,
    );
    updateStatus("idle", "");
  }, [updateStatus]);

  const clearResponse = useCallback(() => {
    setAiResponse(null);
    setPartialResponse(null);
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

  // Toggle auto-run
  const setAutoRun = useCallback((enabled: boolean) => {
    setAutoRunEnabledState(enabled);
    const settings = loadAISettings();
    saveAISettings({ ...settings, aiAutoTrigger: enabled });
    settingsRef.current = { ...settings, aiAutoTrigger: enabled };
  }, []);

  // Toggle selection-only mode
  const setSelectionOnly = useCallback((val: boolean) => {
    setSelectionOnlyState(val);
  }, []);

  // Set applying AI flag (called by App.tsx before updateScene)
  const setApplyingAI = useCallback((val: boolean) => {
    isApplyingAIRef.current = val;
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

    // New: State Machine & AI Panel
    runState,
    runWithPrompt,
    autoRunEnabled,
    setAutoRun,
    partialResponse,
    selectionOnly,
    setSelectionOnly,
    setApplyingAI,

    // Output Mode
    outputMode,
    setOutputMode: (mode: AIOutputMode) => setOutputModeState(mode),
    clearGeneratedImage: () => setGeneratedImage(null),
    acceptGeneratedImage: () => {
      // The actual image placement is handled by App.tsx useEffect
      // This just signals that the image was accepted
      // generatedImage stays set - App.tsx will consume it and clear after placement
    },
    rejectGeneratedImage: () => {
      // Clear without applying to canvas
      setGeneratedImage(null);
    },
  };
}
