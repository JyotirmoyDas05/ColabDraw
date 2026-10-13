import { pipeline } from "@huggingface/transformers";

// multilingual; downloaded once and cached by the browser after the first download
const MODEL = "onnx-community/whisper-base";

let transcriber: Promise<any> | null = null;
const lastPercent: Record<string, number> = {};

const load = () => {
  if (!transcriber) {
    const webgpu = "gpu" in navigator;
    transcriber = pipeline("automatic-speech-recognition", MODEL, {
      device: webgpu ? "webgpu" : "wasm",
      dtype: webgpu
        ? { encoder_model: "fp32", decoder_model_merged: "q4" }
        : "q8",
      progress_callback: (event: any) => {
        const percent = Math.floor(event.progress);
        if (
          event.status === "progress" &&
          lastPercent[event.file] !== percent
        ) {
          lastPercent[event.file] = percent;
          self.postMessage({
            type: "progress",
            file: event.file,
            progress: percent,
          });
        }
      },
    } as any);
    transcriber.catch(() => (transcriber = null));
  }
  return transcriber;
};

self.onmessage = async (
  event: MessageEvent<{ id: number; audio: Float32Array; language?: string }>,
) => {
  const { id, audio, language } = event.data;
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
