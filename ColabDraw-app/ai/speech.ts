import type { AISettings } from "./aiClient";

/**
 * browser-local: the browser's speech recognition, forced on-device (Chrome 139+)
 * browser-cloud: the browser's speech recognition, which may send audio to its vendor
 * whisper: Whisper running in a worker on this device, downloaded once
 */
export type SpeechEngine = "browser-local" | "browser-cloud" | "whisper";

export const isOnDevice = (engine: SpeechEngine) => engine !== "browser-cloud";

const getRecognitionClass = (): any =>
  (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;

export const resolveSpeechLang = (settings: AISettings) =>
  settings.speechLang || navigator.language || "en-US";

const ensureLocalRecognition = async (lang: string) => {
  const Recognition = getRecognitionClass();
  if (!Recognition?.available) {
    return false;
  }
  try {
    const options = { langs: [lang], processLocally: true };
    const status = await Recognition.available(options);
    if (status === "available") {
      return true;
    }
    // installs the language pack; needs the mic click's user activation
    return (
      (status === "downloadable" || status === "downloading") &&
      (await Recognition.install(options))
    );
  } catch {
    return false;
  }
};

/** Never silently picks cloud recognition: "auto" means on-device or Whisper. */
export const pickSpeechEngine = async (
  settings: AISettings,
): Promise<SpeechEngine> => {
  const lang = resolveSpeechLang(settings);
  if (settings.speech === "whisper") {
    return "whisper";
  }
  if (await ensureLocalRecognition(lang)) {
    return "browser-local";
  }
  return settings.speech === "browser" && getRecognitionClass()
    ? "browser-cloud"
    : "whisper";
};

const SILENCE_RMS = 0.005;

const rms = (samples: Float32Array) => {
  let sum = 0;
  for (const sample of samples) {
    sum += sample * sample;
  }
  return Math.sqrt(sum / samples.length);
};

const startLevelMeter = (
  stream: MediaStream,
  onLevel: (level: number) => void,
) => {
  const context = new AudioContext();
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  context.createMediaStreamSource(stream).connect(analyser);
  const samples = new Float32Array(analyser.fftSize);
  let frame = 0;
  const tick = () => {
    analyser.getFloatTimeDomainData(samples);
    onLevel(Math.min(1, rms(samples) * 5));
    frame = requestAnimationFrame(tick);
  };
  tick();
  return () => {
    cancelAnimationFrame(frame);
    onLevel(0);
    context.close();
  };
};

let whisperWorker: Worker | null = null;
let nextRequestId = 0;

const transcribeWithWhisper = (
  audio: Float32Array,
  language: string,
  onStatus: (status: string) => void,
) => {
  whisperWorker ??= new Worker(
    new URL("./whisper.worker.ts", import.meta.url),
    {
      type: "module",
    },
  );
  const worker = whisperWorker;
  const id = nextRequestId++;
  return new Promise<string>((resolve, reject) => {
    const onMessage = ({ data }: MessageEvent) => {
      if (data.type === "progress") {
        onStatus(`Downloading speech model… ${Math.round(data.progress)}%`);
        return;
      }
      if (data.id !== id) {
        return;
      }
      worker.removeEventListener("message", onMessage);
      if (data.type === "result") {
        resolve(data.text);
      } else {
        reject(new Error(data.message));
      }
    };
    worker.addEventListener("message", onMessage);
    worker.postMessage({ id, audio, language }, [audio.buffer]);
  });
};

const decodeTo16kMono = async (blob: Blob) => {
  const context = new AudioContext({ sampleRate: 16000 });
  try {
    const buffer = await context.decodeAudioData(await blob.arrayBuffer());
    return buffer.getChannelData(0);
  } finally {
    context.close();
  }
};

export type ListeningSession = {
  engine: SpeechEngine;
  /** stops listening and resolves with the final transcript */
  stop: () => Promise<string>;
  cancel: () => void;
};

export const startListening = async ({
  settings,
  onPartial,
  onLevel,
  onStatus,
  onEnd,
}: {
  settings: AISettings;
  /** listening ended without stop(), e.g. after a long silence */
  onEnd: () => void;
  onPartial: (text: string) => void;
  onLevel: (level: number) => void;
  onStatus: (status: string) => void;
}): Promise<ListeningSession> => {
  const engine = await pickSpeechEngine(settings);
  const lang = resolveSpeechLang(settings);
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const stopMeter = startLevelMeter(stream, onLevel);
  const release = () => {
    stopMeter();
    stream.getTracks().forEach((track) => track.stop());
  };

  if (engine === "whisper") {
    const recorder = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => chunks.push(event.data);
    recorder.start();
    onPartial("");
    return {
      engine,
      stop: () =>
        new Promise<string>((resolve, reject) => {
          recorder.onstop = async () => {
            release();
            try {
              onStatus("Transcribing on this device…");
              const audio = await decodeTo16kMono(
                new Blob(chunks, { type: recorder.mimeType }),
              );
              // Whisper invents words ("you", "thanks") for silence
              if (rms(audio) < SILENCE_RMS) {
                resolve("");
                return;
              }
              resolve(
                await transcribeWithWhisper(
                  audio,
                  lang.split("-")[0],
                  onStatus,
                ),
              );
            } catch (error) {
              reject(error);
            } finally {
              onStatus("");
            }
          };
          recorder.stop();
        }),
      cancel: () => {
        recorder.onstop = null;
        recorder.stop();
        release();
      },
    };
  }

  const Recognition = getRecognitionClass();
  const recognition = new Recognition();
  recognition.lang = lang;
  recognition.continuous = true;
  recognition.interimResults = true;
  if (engine === "browser-local") {
    recognition.processLocally = true;
  }
  let transcript = "";
  let ended = false;
  // browsers end recognition on their own after silence or errors
  recognition.onend = () => {
    ended = true;
    release();
    onEnd();
  };
  recognition.onresult = (event: any) => {
    transcript = Array.from(event.results as ArrayLike<any>)
      .map((result) => result[0].transcript)
      .join("");
    onPartial(transcript);
  };
  recognition.start();
  return {
    engine,
    stop: () =>
      new Promise<string>((resolve) => {
        if (ended) {
          resolve(transcript.trim());
          return;
        }
        recognition.onend = () => {
          ended = true;
          release();
          resolve(transcript.trim());
        };
        recognition.stop();
      }),
    cancel: () => {
      recognition.onend = null;
      recognition.abort();
      release();
    },
  };
};
