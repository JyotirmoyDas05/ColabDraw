import { CANVAS_FUNCTIONS } from "./canvasAgent";
import { startBandMeter } from "./voiceMeter";

import type { FunctionCall } from "./aiClient";

const LIVE_MODEL = "models/gemini-3.8-live";
const LIVE_URL =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";

const INPUT_RATE = 16000;
const OUTPUT_RATE = 24000;
// ~100 ms of audio per message
const INPUT_CHUNK = 1600;

const TOOLS = [
  {
    functionDeclarations: [
      {
        name: "read_canvas",
        description:
          "Returns the board as it is now (selection or what's on screen). Call it before editing if the user may have changed the board.",
      },
      {
        name: "find_library_art",
        description:
          "Searches the public Excalidraw libraries (libraries.excalidraw.com) for ready-made art such as icons or symbols that are not installed yet. Returns library names and item names to use with insert_library_item.",
        parameters: {
          type: "OBJECT",
          properties: {
            query: {
              type: "STRING",
              description: "What to look for, e.g. aws icons, stick figures",
            },
          },
          required: ["query"],
        },
      },
      ...CANVAS_FUNCTIONS,
    ],
  },
];

const CAPTURE_WORKLET = `
class Capture extends AudioWorkletProcessor {
  process(inputs) {
    if (inputs[0][0]) this.port.postMessage(inputs[0][0].slice(0));
    return true;
  }
}
registerProcessor("capture", Capture);
`;

const rms = (samples: Float32Array) => {
  let sum = 0;
  for (const sample of samples) {
    sum += sample * sample;
  }
  return Math.min(1, Math.sqrt(sum / samples.length) * 5);
};

const toBase64PCM = (samples: Float32Array) => {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  samples.forEach((sample, i) =>
    view.setInt16(i * 2, Math.max(-1, Math.min(1, sample)) * 0x7fff, true),
  );
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
};

const fromBase64PCM = (data: string) => {
  const binary = atob(data);
  const view = new DataView(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) {
    view.setUint8(i, binary.charCodeAt(i));
  }
  const samples = new Float32Array(binary.length / 2);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = view.getInt16(i * 2, true) / 0x8000;
  }
  return samples;
};

export type LiveState =
  | "connecting"
  | "listening"
  | "speaking"
  | "working"
  | "closed";

export type LiveSession = { stop: () => void };

/**
 * A realtime voice conversation with Gemini Live that can read and edit the
 * board through tool calls. Needs the user's own key: audio never goes
 * through the shared trial.
 */
export const startLiveSession = async ({
  apiKey,
  systemPrompt,
  onState,
  onLevel,
  onTranscript,
  onToolCalls,
  onError,
}: {
  apiKey: string;
  systemPrompt: string;
  onState: (state: LiveState) => void;
  onLevel: (level: number) => void;
  onTranscript: (role: "user" | "model", text: string) => void;
  /** all calls of one model turn, answered in order */
  onToolCalls: (calls: FunctionCall[]) => Promise<object[]>;
  onError: (message: string) => void;
}): Promise<LiveSession> => {
  onState("connecting");
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
  });
  const input = new AudioContext({ sampleRate: INPUT_RATE });
  const output = new AudioContext({ sampleRate: OUTPUT_RATE });
  input.resume().catch(() => {});
  output.resume().catch(() => {});
  const socket = new WebSocket(`${LIVE_URL}?key=${encodeURIComponent(apiKey)}`);
  const playing = new Set<AudioBufferSourceNode>();
  let playhead = 0;
  let closed = false;

  // frequency bands for the visualizer: what you say, then what the model says
  const micAnalyser = input.createAnalyser();
  micAnalyser.fftSize = 512;
  const outAnalyser = output.createAnalyser();
  outAnalyser.fftSize = 512;
  outAnalyser.connect(output.destination);
  const stopMeters = [
    startBandMeter(micAnalyser, undefined, () => !playing.size),
    startBandMeter(outAnalyser, undefined, () => playing.size > 0),
  ];

  const stop = () => {
    if (closed) {
      return;
    }
    closed = true;
    stopMeters.forEach((stopMeter) => stopMeter());
    stream.getTracks().forEach((track) => track.stop());
    input.close();
    output.close();
    socket.close();
    onLevel(0);
    onState("closed");
  };

  const send = (message: object) => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  };

  const startMicrophone = async () => {
    const url = URL.createObjectURL(
      new Blob([CAPTURE_WORKLET], { type: "application/javascript" }),
    );
    await input.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    const node = new AudioWorkletNode(input, "capture");
    const micSource = input.createMediaStreamSource(stream);
    micSource.connect(node);
    micSource.connect(micAnalyser);
    // some browsers only feed an analyser that reaches the output; silent
    const silent = input.createGain();
    silent.gain.value = 0;
    micAnalyser.connect(silent).connect(input.destination);
    let pending: number[] = [];
    node.port.onmessage = ({ data }: MessageEvent<Float32Array>) => {
      pending.push(...data);
      if (pending.length < INPUT_CHUNK) {
        return;
      }
      const chunk = Float32Array.from(pending);
      pending = [];
      if (!playing.size) {
        onLevel(rms(chunk));
      }
      send({
        realtimeInput: {
          audio: {
            data: toBase64PCM(chunk),
            mimeType: `audio/pcm;rate=${INPUT_RATE}`,
          },
        },
      });
    };
  };

  const play = (data: string) => {
    const samples = fromBase64PCM(data);
    const buffer = output.createBuffer(1, samples.length, OUTPUT_RATE);
    buffer.copyToChannel(samples, 0);
    const source = output.createBufferSource();
    source.buffer = buffer;
    source.connect(outAnalyser);
    playhead = Math.max(playhead, output.currentTime);
    source.start(playhead);
    playhead += buffer.duration;
    playing.add(source);
    onState("speaking");
    onLevel(rms(samples));
    source.onended = () => {
      playing.delete(source);
      if (!playing.size && !closed) {
        onLevel(0);
        onState("listening");
      }
    };
  };

  const interrupt = () => {
    playing.forEach((source) => source.stop());
    playing.clear();
    playhead = 0;
  };

  socket.onopen = () =>
    send({
      setup: {
        model: LIVE_MODEL,
        generationConfig: { responseModalities: ["AUDIO"] },
        systemInstruction: { parts: [{ text: systemPrompt }] },
        tools: TOOLS,
        inputAudioTranscription: {},
        outputAudioTranscription: {},
      },
    });

  socket.onmessage = async ({ data }) => {
    const message = JSON.parse(
      typeof data === "string" ? data : await (data as Blob).text(),
    );
    if (message.setupComplete) {
      await startMicrophone();
      onState("listening");
      return;
    }
    if (message.toolCall) {
      const calls: (FunctionCall & { id: string })[] = (
        message.toolCall.functionCalls ?? []
      ).map((call: any) => ({ ...call, args: call.args ?? {} }));
      let responses: object[];
      onState("working");
      try {
        responses = await onToolCalls(calls);
      } catch (error: any) {
        responses = calls.map(() => ({ error: String(error?.message) }));
      }
      onState("listening");
      send({
        toolResponse: {
          functionResponses: calls.map((call, index) => ({
            id: call.id,
            name: call.name,
            response: responses[index],
          })),
        },
      });
      return;
    }
    const content = message.serverContent;
    if (!content) {
      return;
    }
    if (content.interrupted) {
      interrupt();
    }
    if (content.inputTranscription?.text) {
      onTranscript("user", content.inputTranscription.text);
    }
    if (content.outputTranscription?.text) {
      onTranscript("model", content.outputTranscription.text);
    }
    for (const part of content.modelTurn?.parts ?? []) {
      if (part.inlineData?.data) {
        play(part.inlineData.data);
      }
    }
  };

  socket.onclose = (event) => {
    if (!closed && event.code !== 1000) {
      onError(
        /quota|exhausted/i.test(event.reason)
          ? "Your Gemini key hit its free Live limit."
          : event.reason || "The live session was disconnected.",
      );
    }
    stop();
  };

  return { stop };
};
