import type { PresentationSettings } from "./presentationState";
export type PresentationSyncMessage =
  | { type: "NAVIGATE_SLIDE"; slideIndex: number }
  | { type: "NEXT_SLIDE" }
  | { type: "PREV_SLIDE" }
  | { type: "STOP_PRESENTATION" }
  | { type: "UPDATE_SETTINGS"; settings: Partial<PresentationSettings> }
  | {
      type: "SYNC_STATE";
      slideIndex: number;
      totalSlides: number;
      slideTitle: string;
      isActive: boolean;
      slideIds?: string[];
    };

const CHANNEL_NAME = "colabdraw_presentation_sync_channel";

export class PresentationSync {
  private channel: BroadcastChannel | null = null;
  private listeners: Set<(msg: PresentationSyncMessage) => void> = new Set();

  constructor() {
    if (typeof window !== "undefined" && "BroadcastChannel" in window) {
      try {
        this.channel = new BroadcastChannel(CHANNEL_NAME);
        this.channel.onmessage = (event) => {
          this.notify(event.data);
        };
      } catch (err) {
        console.warn("BroadcastChannel not available", err);
      }
    }

    if (typeof window !== "undefined") {
      window.addEventListener("storage", (e) => {
        if (e.key === CHANNEL_NAME && e.newValue) {
          try {
            const data = JSON.parse(e.newValue);
            this.notify(data);
          } catch {
            // Ignore parse errors
          }
        }
      });
    }
  }

  public send(msg: PresentationSyncMessage) {
    this.notify(msg);

    if (this.channel) {
      try {
        this.channel.postMessage(msg);
      } catch {
        // Ignore post message errors
      }
    }
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(
          CHANNEL_NAME,
          JSON.stringify({ ...msg, _t: Date.now() }),
        );
      } catch {
        // Ignore local storage errors
      }
    }
  }

  public subscribe(cb: (msg: PresentationSyncMessage) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private notify(msg: PresentationSyncMessage) {
    this.listeners.forEach((cb) => {
      try {
        cb(msg);
      } catch (err) {
        console.error("PresentationSync listener error:", err);
      }
    });
  }
}

export const presentationSync = new PresentationSync();
