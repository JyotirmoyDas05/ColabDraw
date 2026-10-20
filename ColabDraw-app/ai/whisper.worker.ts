import { pipeline } from "@huggingface/transformers";

// multilingual; downloaded once and cached by the browser after the first download
const MODEL = "onnx-community/whisper-base";

let transcriber: Promise<any> | null = null;
const lastPercent: Record<string, number> = {};

const create = (device: "webgpu" | "wasm") =>
  pipeline("automatic-speech-recognition", MODEL, {
    device,
    dtype:
      device === "webgpu"
        ? { encoder_model: "fp32", decoder_model_merged: "q4" }
        : "q8",
    progress_callback: (event: any) => {
      const percent = Math.floor(event.progress);
      if (event.status === "progress" && lastPercent[event.file] !== percent) {
        lastPercent[event.file] = percent;
        self.postMessage({
          type: "progress",
          file: event.file,
          loaded: event.loaded,
          total: event.total,
        });
      }
    },
  } as any);

// "gpu" in navigator only says the API exists; many browsers have no adapter behind it
const hasGpuAdapter = async () => {
  try {
    return !!(await (navigator as any).gpu?.requestAdapter());
  } catch {
    return false;
  }
};

const load = () => {
  if (!transcriber) {
    transcriber = (async () => {
      if (await hasGpuAdapter()) {
        try {
          return await create("webgpu");
        } catch (error) {
          // fall through to the CPU, which works everywhere
          console.warn("WebGPU speech model failed, using the CPU:", error);
        }
      }
      return create("wasm");
    })();
    transcriber.catch(() => (transcriber = null));
  }
  return transcriber;
};

const transcribeOne = async ({
  id,
  audio,
  language,
}: {
  id: number;
  audio: Float32Array;
  language?: string;
}) => {
  try {
    const transcribe = await load();
    const output = await transcribe(audio, {
      language: language || null,
      task: "transcribe",
      chunk_length_s: 30,
    });
    self.postMessage({ type: "result", id, text: output.text.trim() });
  } catch (error: any) {
    self.postMessage({ type: "error", id, message: String(error?.message) });
  }
};

// one at a time: a live pass can still be running when the final one arrives,
// and the model can't run two at once
let queue = Promise.resolve();
self.onmessage = (
  event: MessageEvent<{ id: number; audio: Float32Array; language?: string }>,
) => {
  queue = queue.then(() => transcribeOne(event.data));
};
