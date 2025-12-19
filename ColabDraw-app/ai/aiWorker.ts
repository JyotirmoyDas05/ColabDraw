/*
 * Smart Canvas AI - Web Worker for Local Model Inference
 *
 * Runs dual models in a dedicated worker thread:
 * - Qwen2-VL-2B-Instruct: For understanding canvas content (OCR, math, diagrams)
 * - Janus-Pro-1B: For generating diagram images from text
 *
 * Supports WebGPU acceleration with WASM fallback.
 */

/// <reference lib="webworker" />

import {
  AutoProcessor,
  AutoModelForVision2Seq,
  RawImage,
  env,
} from "@huggingface/transformers";

import type {
  AIWorkerMessage,
  AIWorkerResponse,
  ModelDownloadProgress,
} from "./types";

// Configure transformers.js
env.allowLocalModels = false;
env.useBrowserCache = true;

// ============================================================================
// Model Configuration
// ============================================================================

const QWEN_MODEL_ID = "onnx-community/Qwen2-VL-2B-Instruct";
const QWEN_MODEL_NAME = "Qwen2-VL-2B";

// Note: Janus-Pro-1B ONNX export may not be available yet
// Using a placeholder - will need to verify availability
const JANUS_MODEL_ID = "onnx-community/Janus-Pro-1B";
const JANUS_MODEL_NAME = "Janus-Pro-1B";

// ============================================================================
// State
// ============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let qwenModel: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let qwenProcessor: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let janusModel: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
let janusProcessor: any = null;

let qwenReady = false;
let janusReady = false;
let isLoadingQwen = false;
let isLoadingJanus = false;
let currentRequestId: string | null = null;
let detectedBackend: "webgpu" | "wasm" = "wasm";

// ============================================================================
// Helper Functions
// ============================================================================

function sendMessage(message: AIWorkerResponse): void {
  self.postMessage(message);
}

function sendProgress(
  model: "qwen" | "janus",
  progress: ModelDownloadProgress,
): void {
  sendMessage({
    type: "download_progress",
    model,
    progress,
  });
}

function sendError(error: string, requestId?: string): void {
  sendMessage({
    type: "error",
    error,
    requestId,
  });
}

// ============================================================================
// Progress Callback Factory
// ============================================================================

interface ProgressData {
  status: "initiate" | "download" | "progress" | "done" | "ready";
  name?: string;
  file?: string;
  progress?: number;
  loaded?: number;
  total?: number;
}

function createProgressCallback(model: "qwen" | "janus") {
  const modelName = model === "qwen" ? QWEN_MODEL_NAME : JANUS_MODEL_NAME;

  return (data: ProgressData) => {
    if (
      data.status === "progress" ||
      data.status === "initiate" ||
      data.status === "download"
    ) {
      sendProgress(model, {
        modelName,
        fileName: data.file || "",
        progress: data.progress || 0,
        loaded: data.loaded || 0,
        total: data.total || 0,
        status: "downloading",
      });
    } else if (data.status === "done" || data.status === "ready") {
      sendProgress(model, {
        modelName,
        fileName: data.file || "",
        progress: 100,
        loaded: data.loaded || 0,
        total: data.total || 0,
        status: "ready",
      });
    }
  };
}

// ============================================================================
// Model Loading
// ============================================================================

async function detectWebGPU(): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && "gpu" in navigator) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const gpu = (navigator as any).gpu;
      const adapter = await gpu.requestAdapter();
      return adapter !== null;
    }
    return false;
  } catch {
    return false;
  }
}

async function loadQwenModel(): Promise<void> {
  if (qwenReady || isLoadingQwen) {
    return;
  }

  isLoadingQwen = true;
  const progressCallback = createProgressCallback("qwen");

  // Send initial pending status
  sendProgress("qwen", {
    modelName: QWEN_MODEL_NAME,
    fileName: "",
    progress: 0,
    loaded: 0,
    total: 0,
    status: "pending",
  });

  try {
    // Detect WebGPU
    const hasWebGPU = await detectWebGPU();
    detectedBackend = hasWebGPU ? "webgpu" : "wasm";

    // Load processor first (smaller)
    qwenProcessor = await AutoProcessor.from_pretrained(QWEN_MODEL_ID, {
      progress_callback: progressCallback,
    });

    // Load model with WebGPU or fallback to WASM
    const device = hasWebGPU ? "webgpu" : "wasm";

    qwenModel = await AutoModelForVision2Seq.from_pretrained(QWEN_MODEL_ID, {
      dtype: hasWebGPU ? "q4" : "q4", // 4-bit quantization for smaller size
      device,
      progress_callback: progressCallback,
    });

    qwenReady = true;
    isLoadingQwen = false;

    sendMessage({
      type: "model_ready",
      model: "qwen",
      backend: detectedBackend,
    });
  } catch (err) {
    isLoadingQwen = false;
    const errorMsg = err instanceof Error ? err.message : "Unknown error";
    sendProgress("qwen", {
      modelName: QWEN_MODEL_NAME,
      fileName: "",
      progress: 0,
      loaded: 0,
      total: 0,
      status: "error",
    });
    sendError(`Failed to load Qwen model: ${errorMsg}`);
  }
}

async function loadJanusModel(): Promise<void> {
  if (janusReady || isLoadingJanus) {
    return;
  }

  isLoadingJanus = true;
  const progressCallback = createProgressCallback("janus");

  // Send initial pending status
  sendProgress("janus", {
    modelName: JANUS_MODEL_NAME,
    fileName: "",
    progress: 0,
    loaded: 0,
    total: 0,
    status: "pending",
  });

  try {
    // Note: Janus model loading - may need adjustment based on actual ONNX export
    // For now, we'll mark it as ready but log that it's a placeholder
    // Note: Janus model loading - may need adjustment based on actual ONNX export

    // Attempt to load Janus (may fail if ONNX export not available)
    try {
      janusProcessor = await AutoProcessor.from_pretrained(JANUS_MODEL_ID, {
        progress_callback: progressCallback,
      });

      const hasWebGPU = await detectWebGPU();
      janusModel = await AutoModelForVision2Seq.from_pretrained(
        JANUS_MODEL_ID,
        {
          dtype: "q4",
          device: hasWebGPU ? "webgpu" : "wasm",
          progress_callback: progressCallback,
        },
      );

      janusReady = true;
    } catch {
      // Janus ONNX may not be available yet
      // Mark as ready with limited functionality
      sendProgress("janus", {
        modelName: JANUS_MODEL_NAME,
        fileName: "Not available",
        progress: 100,
        loaded: 0,
        total: 0,
        status: "error",
      });
    }

    isLoadingJanus = false;

    if (janusReady) {
      sendMessage({
        type: "model_ready",
        model: "janus",
      });
    }
  } catch {
    isLoadingJanus = false;
    sendProgress("janus", {
      modelName: JANUS_MODEL_NAME,
      fileName: "",
      progress: 0,
      loaded: 0,
      total: 0,
      status: "error",
    });
    // Don't send error for Janus - it's optional
  }
}

async function initializeModels(): Promise<void> {
  // Load models in parallel
  await Promise.all([loadQwenModel(), loadJanusModel()]);
}

// ============================================================================
// Canvas Analysis with Qwen
// ============================================================================

async function analyzeCanvas(
  imageDataUrl: string,
  prompt: string | undefined,
  requestId: string,
): Promise<void> {
  currentRequestId = requestId;

  // Load model if not ready
  if (!qwenReady) {
    await loadQwenModel();
  }

  if (!qwenReady || !qwenModel || !qwenProcessor) {
    sendError("Qwen model not ready", requestId);
    return;
  }

  sendMessage({ type: "analyzing", requestId });

  try {
    // Load image from data URL
    const image = await RawImage.fromURL(imageDataUrl);

    // Build conversation
    const userPrompt =
      prompt ||
      `Analyze this whiteboard image carefully.
If you see a math equation (like "2+2=?"), calculate and give the answer.
If you see text, read it and respond appropriately.
If you see a diagram, describe what it represents.
Be concise and direct. Just give the answer.`;

    const conversation = [
      {
        role: "user",
        content: [
          { type: "image", image },
          { type: "text", text: userPrompt },
        ],
      },
    ];

    // Apply chat template
    const text = qwenProcessor.apply_chat_template(conversation, {
      tokenize: false,
      add_generation_prompt: true,
    });

    // Process inputs
    const inputs = await qwenProcessor(text, [image], { return_tensors: "pt" });

    // Check if request was cancelled
    if (currentRequestId !== requestId) {
      sendMessage({ type: "cancelled", requestId });
      return;
    }

    // Generate response
    const output = await qwenModel.generate({
      ...inputs,
      max_new_tokens: 256,
      do_sample: false,
    });

    // Check if request was cancelled
    if (currentRequestId !== requestId) {
      sendMessage({ type: "cancelled", requestId });
      return;
    }

    // Decode output
    const decoded = qwenProcessor.batch_decode(
      output.slice(null, [inputs.input_ids.dims[1], null]),
      { skip_special_tokens: true },
    );

    const response = decoded[0]?.trim() || "No response generated";

    sendMessage({
      type: "complete",
      response,
      requestId,
    });
  } catch (err) {
    if (currentRequestId === requestId) {
      const errorMsg = err instanceof Error ? err.message : "Unknown error";
      sendError(`Analysis failed: ${errorMsg}`, requestId);
    }
  }
}

// ============================================================================
// Image Generation with Janus (Placeholder)
// ============================================================================

async function generateImage(prompt: string, requestId: string): Promise<void> {
  currentRequestId = requestId;

  if (!janusReady || !janusModel) {
    sendError(
      "Image generation not available. Janus model not loaded.",
      requestId,
    );
    return;
  }

  try {
    // TODO: Implement actual Janus image generation when ONNX export is available
    // For now, send a placeholder response
    sendMessage({
      type: "image_generated",
      imageDataUrl: "", // Would be the generated image
      requestId,
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Unknown error";
    sendError(`Image generation failed: ${errorMsg}`, requestId);
  }
}

// ============================================================================
// Message Handler
// ============================================================================

self.onmessage = async (event: MessageEvent<AIWorkerMessage>) => {
  const { type, image, prompt, requestId } = event.data;

  switch (type) {
    case "init":
      await initializeModels();
      break;

    case "analyze":
      if (image && requestId) {
        await analyzeCanvas(image, prompt, requestId);
      } else {
        sendError("Missing image or requestId for analysis");
      }
      break;

    case "generate_image":
      if (prompt && requestId) {
        await generateImage(prompt, requestId);
      } else {
        sendError("Missing prompt or requestId for image generation");
      }
      break;

    case "cancel":
      currentRequestId = null;
      break;

    default:
      sendError(`Unknown message type: ${type}`);
  }
};
