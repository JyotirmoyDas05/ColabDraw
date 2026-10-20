import { startBandMeter } from "./voiceMeter";

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

// some browsers (Brave) expose the on-device speech API but never answer it
const PROBE_TIMEOUT_MS = 2500;

/**
 * Never silently picks cloud recognition: "auto" means on-device or Whisper.
 * Gives up after a moment instead of waiting on a browser that doesn't answer.
 */
export const pickSpeechEngine = async (
  settings: AISettings,
): Promise<SpeechEngine> => {
  const lang = resolveSpeechLang(settings);
  if (settings.speech === "whisper") {
    return "whisper";
  }
  const fallback: SpeechEngine =
    settings.speech === "browser" && getRecognitionClass()
      ? "browser-cloud"
      : "whisper";
  const probe = ensureLocalRecognition(lang).then(
    (ok): SpeechEngine => (ok ? "browser-local" : fallback),
  );
  const timeout = new Promise<SpeechEngine>((resolve) =>
    setTimeout(() => resolve(fallback), PROBE_TIMEOUT_MS),
  );
  return Promise.race([probe, timeout]);
};

const SILENCE_RMS = 0.005;

const rms = (samples: Float32Array) => {
  let sum = 0;
  for (const sample of samples) {
    sum += sample * sample;
  }
  return Math.sqrt(sum / samples.length);
};

let whisperWorker: Worker | null = null;
const downloads = new Map<string, { loaded: number; total: number }>();
let downloadShown = 0;
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
        // several files download at once: show one steady overall percentage
        downloads.set(data.file, { loaded: data.loaded, total: data.total });
        let loaded = 0;
        let total = 0;
        downloads.forEach((file) => {
          loaded += file.loaded;
          total += file.total;
        });
        downloadShown = Math.max(
          downloadShown,
          total ? Math.floor((100 * loaded) / total) : 0,
        );
        // once everything is downloaded the model still takes a moment to start
        onStatus(
          downloadShown >= 100
            ? "Starting the speech model (first time only)…"
            : `Downloading speech model (first time only)… ${downloadShown}%`,
        );
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
  /** the engine currently expected to produce the text (may fall back to whisper) */
  readonly engine: SpeechEngine;
  /** stops listening and resolves with the final transcript */
  stop: () => Promise<string>;
  cancel: () => void;
};

// recognition errors that just mean "nobody spoke yet"
const HARMLESS_ERRORS = ["no-speech", "aborted"];
// how often the on-device model re-reads what you've said so far
const PARTIAL_EVERY_MS = 2500;
const PARTIAL_AFTER_MS = PROBE_TIMEOUT_MS + 500;
const MIN_PARTIAL_SAMPLES = 16000 * 1.5;

/**
 * Listens through the microphone and is ready as soon as the microphone is.
 * It always records the audio too, so when the browser's own speech
 * recognition is missing, blocked or fails (common outside Chrome), the
 * on-device Whisper model transcribes it: live every couple of seconds while
 * you talk, and once more when you stop.
 */
export const startListening = async ({
  settings,
  onPartial,
  onLevel,
  onStatus,
  onEngine,
}: {
  settings: AISettings;
  onPartial: (text: string) => void;
  onLevel: (level: number) => void;
  onStatus: (status: string) => void;
  /** the engine in use changed, e.g. fell back to whisper */
  onEngine: (engine: SpeechEngine) => void;
}): Promise<ListeningSession> => {
  const lang = resolveSpeechLang(settings);
  const whisperLang = lang.split("-")[0];
  // first, so a blocked or missing microphone is reported straight away
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
  });

  let context: AudioContext | null = null;
  let stopMeter = () => {};
  let recorder: MediaRecorder;
  const chunks: Blob[] = [];
  try {
    context = new AudioContext();
    // browsers can start a context suspended; the click that began listening allows resuming
    context.resume().catch(() => {});
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.6;
    context.createMediaStreamSource(stream).connect(analyser);
    // some browsers only feed an analyser that reaches the output; silent, so nothing is heard
    const silent = context.createGain();
    silent.gain.value = 0;
    analyser.connect(silent).connect(context.destination);
    stopMeter = startBandMeter(analyser, onLevel);

    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (event) => chunks.push(event.data);
    // a chunk every second, so what's been said so far can be read while recording
    recorder.start(1000);
  } catch (error) {
    // don't leave the microphone switched on after a failed start
    stopMeter();
    stream.getTracks().forEach((track) => track.stop());
    context?.close();
    throw error;
  }

  const startedAt = Date.now();
  // the on-device model until the browser proves it can do better
  let engine: SpeechEngine = "whisper";
  let recognition: any = null;
  let committed = "";
  let current = "";
  let listening = true;
  const transcript = () => `${committed} ${current}`.trim();

  const fallBackToWhisper = () => {
    if (engine !== "whisper") {
      engine = "whisper";
      onEngine("whisper");
    }
  };

  const startRecognition = () => {
    const Recognition = getRecognitionClass();
    const start = () => {
      recognition = new Recognition();
      recognition.lang = lang;
      recognition.continuous = true;
      recognition.interimResults = true;
      if (engine === "browser-local") {
        recognition.processLocally = true;
      }
      recognition.onresult = (event: any) => {
        current = Array.from(event.results as ArrayLike<any>)
          .map((result) => result[0].transcript)
          .join("");
        onPartial(transcript());
      };
      recognition.onerror = (event: any) => {
        if (!HARMLESS_ERRORS.includes(event?.error)) {
          // blocked, offline, language not installed...: keep recording, use whisper
          console.warn("speech recognition failed:", event?.error);
          recognition = null;
          fallBackToWhisper();
        }
      };
      recognition.onend = () => {
        // browsers end recognition after a pause; carry on while listening
        committed = transcript();
        current = "";
        if (listening && recognition) {
          try {
            start();
          } catch {
            recognition = null;
            fallBackToWhisper();
          }
        }
      };
      recognition.start();
    };
    try {
      start();
    } catch {
      recognition = null;
      fallBackToWhisper();
    }
  };

  // choose in the background: the microphone is already live
  if (settings.speech !== "whisper") {
    pickSpeechEngine(settings).then((picked) => {
      if (listening && picked !== "whisper") {
        engine = picked;
        onEngine(picked);
        startRecognition();
      }
    });
  }

  // live text from the on-device model, every couple of seconds
  let partialBusy = false;
  const partialTimer = setInterval(async () => {
    if (
      !listening ||
      engine !== "whisper" ||
      partialBusy ||
      Date.now() - startedAt < PARTIAL_AFTER_MS
    ) {
      return;
    }
    partialBusy = true;
    try {
      const audio = await decodeTo16kMono(
        new Blob(chunks, { type: recorder.mimeType }),
      );
      if (audio.length < MIN_PARTIAL_SAMPLES || rms(audio) < SILENCE_RMS) {
        return;
      }
      const text = await transcribeWithWhisper(audio, whisperLang, onStatus);
      if (listening && engine === "whisper") {
        onPartial(text);
        onStatus("");
      }
    } catch {
      // keep recording; the final pass reports a real failure
    } finally {
      partialBusy = false;
    }
  }, PARTIAL_EVERY_MS);

  const release = () => {
    listening = false;
    clearInterval(partialTimer);
    stopMeter();
    stream.getTracks().forEach((track) => track.stop());
    context?.close();
  };

  /** stops recognition and waits briefly for its last words */
  const stopRecognition = () =>
    new Promise<void>((resolve) => {
      const active = recognition;
      recognition = null;
      if (!active) {
        resolve();
        return;
      }
      const onEnd = active.onend;
      active.onend = () => {
        onEnd?.call(active);
        resolve();
      };
      setTimeout(resolve, 700);
      try {
        active.stop();
      } catch {
        resolve();
      }
    });

  const stopRecording = () =>
    new Promise<Blob>((resolve) => {
      recorder.onstop = () =>
        resolve(new Blob(chunks, { type: recorder.mimeType }));
      if (recorder.state === "inactive") {
        resolve(new Blob(chunks, { type: recorder.mimeType }));
      } else {
        recorder.stop();
      }
    });

  return {
    get engine() {
      return engine;
    },
    stop: async () => {
      // from here on, late live text from an earlier pass must not overwrite the result
      listening = false;
      await stopRecognition();
      const browserText = engine !== "whisper" ? transcript() : "";
      const recording = await stopRecording();
      release();
      if (browserText) {
        return browserText;
      }
      try {
        onStatus("Transcribing on this device…");
        const audio = await decodeTo16kMono(recording);
        // Whisper invents words ("you", "thanks") for silence
        if (rms(audio) < SILENCE_RMS) {
          return "";
        }
        return await transcribeWithWhisper(audio, whisperLang, onStatus);
      } finally {
        onStatus("");
      }
    },
    cancel: () => {
      listening = false;
      recorder.onstop = null;
      stopRecognition();
      if (recorder.state !== "inactive") {
        recorder.stop();
      }
      release();
    },
  };
};
