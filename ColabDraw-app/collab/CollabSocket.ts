import type { PresentationSessionInfo } from "../presentation/presentationState";

export type CollabSocketEvents = {
  joined: (payload: {
    first: boolean;
    members: string[];
    presentation: PresentationSessionInfo | null;
    /** false when the deployed room server predates presentation sessions */
    sessionSupported: boolean;
  }) => void;
  members: (ids: string[]) => void;
  newUser: (id: string) => void;
  followers: (ids: string[]) => void;
  unfollowed: () => void;
  presentation: (session: PresentationSessionInfo | null) => void;
  scene: (payload: { opcode: 1 | 2; iv: Uint8Array; data: Uint8Array }) => void;
  status: (status: "connecting" | "open" | "unavailable") => void;
};

/** What this socket is to the room. Only `editor` can draw or save. */
export type CollabPresence = "editor" | "viewer" | "remote";

type SceneOpcode = 1 | 2;

type ServerControl =
  | {
      t: "joined";
      first: boolean;
      members: string[];
      presentation?: PresentationSessionInfo | null;
    }
  | { t: "members"; ids: string[] }
  | { t: "new-user"; id: string }
  | { t: "followers"; ids: string[] }
  | { t: "unfollowed" }
  | { t: "presentation"; presentation: PresentationSessionInfo | null }
  | { t: "pong" };

/** Matches the wire protocol: [1-byte opcode][12-byte IV][ciphertext]. */
const SCENE_OPCODE = 1;
const VOLATILE_OPCODE = 2;
const VOLATILE_TO_FOLLOWERS_OPCODE = 3;
const IV_BYTES = 12;
const FRAME_HEADER_BYTES = 1 + IV_BYTES;

const MAX_BACKOFF_MS = 15_000;
const BASE_BACKOFF_MS = 1_000;
const PING_INTERVAL_MS = 25_000;
const PONG_TIMEOUT_MS = 10_000;

type AnyListener = (...args: never[]) => void;

export class CollabSocket {
  readonly id = crypto.randomUUID();

  private readonly listenerGroups = new Map<
    keyof CollabSocketEvents,
    Set<AnyListener>
  >();

  private readonly url: string;
  private socket: WebSocket | null = null;
  private isViewOnly: boolean;
  private readonly presence: CollabPresence;
  private closed = false;
  private attempt = 0;
  private following: string | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    baseUrl: string,
    roomId: string,
    options?: { isViewOnly?: boolean; presence?: CollabPresence },
  ) {
    const rawUrl =
      baseUrl ||
      import.meta.env.VITE_APP_BACKEND_URL ||
      "https://colabdraw-backend.jyotimoydas.workers.dev";
    const cleanUrl = (
      rawUrl || "https://colabdraw-backend.jyotimoydas.workers.dev"
    )
      .replace(/\/+$/, "")
      .replace(/^http/, "ws");
    this.url = `${cleanUrl}/rooms/${encodeURIComponent(roomId)}`;
    this.isViewOnly = options?.isViewOnly ?? false;
    this.presence = options?.presence ?? "editor";
  }

  getPresence(): CollabPresence {
    return this.presence;
  }

  /** Asks the room to own a presentation session for this socket. */
  startPresentation(): void {
    this.sendControl({ t: "presentation-start" });
  }

  /** Asks the room to end the session, whether we host it or drive it. */
  endPresentation(): void {
    this.sendControl({ t: "presentation-end" });
  }

  connect(): void {
    if (this.socket || this.closed) {
      return;
    }
    this.emit("status", "connecting");
    const socket = new WebSocket(this.url);
    socket.binaryType = "arraybuffer";
    this.socket = socket;
    socket.addEventListener("open", this.handleOpen);
    socket.addEventListener("message", this.handleMessage);
    socket.addEventListener("close", this.handleClose);
  }

  close(): void {
    this.closed = true;
    this.clearTimers();
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.close();
    }
  }

  sendUpdate(
    data: ArrayBuffer,
    iv: Uint8Array,
    options?: { volatile?: boolean; followersOnly?: boolean },
  ): void {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      return;
    }
    const opcode = options?.followersOnly
      ? VOLATILE_TO_FOLLOWERS_OPCODE
      : options?.volatile
      ? VOLATILE_OPCODE
      : SCENE_OPCODE;
    const frame = new Uint8Array(FRAME_HEADER_BYTES + data.byteLength);
    frame[0] = opcode;
    frame.set(iv.subarray(0, IV_BYTES), 1);
    frame.set(new Uint8Array(data), FRAME_HEADER_BYTES);
    this.socket.send(frame.buffer);
  }

  setFollowing(target: string | null): void {
    if (target === null) {
      const previous = this.following;
      this.following = null;
      if (previous) {
        this.sendControl({ t: "unfollow", target: previous });
      }
      return;
    }
    this.following = target;
    this.sendControl({ t: "follow", target });
  }

  on<K extends keyof CollabSocketEvents>(
    event: K,
    handler: CollabSocketEvents[K],
  ): void {
    let listeners = this.listenerGroups.get(event);
    if (!listeners) {
      listeners = new Set();
      this.listenerGroups.set(event, listeners);
    }
    listeners.add(handler as AnyListener);
  }

  off<K extends keyof CollabSocketEvents>(
    event: K,
    handler: CollabSocketEvents[K],
  ): void {
    this.listenerGroups.get(event)?.delete(handler as AnyListener);
  }

  private sendControl(message: {
    t: string;
    target?: string;
    clientId?: string;
    presence?: CollabPresence;
  }): void {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      return;
    }
    this.socket.send(JSON.stringify(message));
  }

  private handleOpen = (): void => {
    this.attempt = 0;
    this.emit("status", "open");
    this.sendControl({ t: "join", clientId: this.id, presence: this.presence });
    if (this.isViewOnly) {
      this.sendControl({ t: "view-only" });
    }
    this.startHeartbeat();
  };

  private handleMessage = (event: MessageEvent): void => {
    if (typeof event.data === "string") {
      this.handleControl(event.data);
      return;
    }
    if (!(event.data instanceof ArrayBuffer)) {
      return;
    }
    const bytes = new Uint8Array(event.data);
    if (bytes.length < FRAME_HEADER_BYTES) {
      return;
    }
    const opcode = bytes[0];
    if (opcode !== SCENE_OPCODE && opcode !== VOLATILE_OPCODE) {
      return;
    }
    this.emit("scene", {
      opcode: opcode as SceneOpcode,
      iv: bytes.slice(1, FRAME_HEADER_BYTES),
      data: bytes.slice(FRAME_HEADER_BYTES),
    });
  };

  private handleClose = (): void => {
    this.clearTimers();
    this.socket = null;
    if (this.closed) {
      return;
    }
    this.emit("status", "connecting");
    this.attempt += 1;
    if (this.attempt >= 3) {
      this.emit("status", "unavailable");
    }
    const backoff =
      Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** (this.attempt - 1)) *
      (1 + (Math.random() - 0.5) / 2);
    this.reconnectTimer = setTimeout(() => this.connect(), backoff);
  };

  private startHeartbeat(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }
    this.pingInterval = setInterval(() => {
      if (this.socket?.readyState !== WebSocket.OPEN) {
        return;
      }
      this.sendControl({ t: "ping" });
      if (this.pongTimer) {
        clearTimeout(this.pongTimer);
      }
      this.pongTimer = setTimeout(() => {
        this.socket?.close();
      }, PONG_TIMEOUT_MS);
    }, PING_INTERVAL_MS);
  }

  private clearTimers(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.pongTimer) {
      clearTimeout(this.pongTimer);
      this.pongTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private handleControl(text: string): void {
    let control: any;
    try {
      control = JSON.parse(text);
    } catch {
      return;
    }
    if (typeof control !== "object" || control === null) {
      return;
    }
    const c = control as ServerControl;
    switch (c.t) {
      case "joined":
        this.emit("joined", {
          first: c.first === true,
          members: this.filterIds(c.members),
          presentation: this.session(c.presentation),
          sessionSupported: "presentation" in c,
        });
        return;
      case "presentation":
        this.emit("presentation", this.session(c.presentation));
        return;
      case "members":
        this.emit("members", this.filterIds(c.ids));
        return;
      case "new-user":
        if (typeof c.id === "string") {
          this.emit("newUser", c.id);
        }
        return;
      case "followers":
        this.emit("followers", this.filterIds(c.ids));
        return;
      case "unfollowed":
        this.emit("unfollowed");
        return;
      case "pong":
        if (this.pongTimer) {
          clearTimeout(this.pongTimer);
          this.pongTimer = null;
        }
        break;
    }
  }

  private filterIds(ids: unknown): string[] {
    return Array.isArray(ids) ? ids.filter((id) => typeof id === "string") : [];
  }

  /** Narrows an untrusted session payload; anything malformed reads as idle. */
  private session(value: unknown): PresentationSessionInfo | null {
    if (typeof value !== "object" || value === null) {
      return null;
    }
    const candidate = value as {
      sessionId?: unknown;
      hostId?: unknown;
      viewers?: unknown;
      remote?: unknown;
    };
    if (
      typeof candidate.sessionId !== "string" ||
      typeof candidate.hostId !== "string"
    ) {
      return null;
    }
    return {
      sessionId: candidate.sessionId,
      hostId: candidate.hostId,
      viewers:
        typeof candidate.viewers === "number" && candidate.viewers >= 0
          ? candidate.viewers
          : 0,
      remote: candidate.remote === true,
    };
  }

  private emit<K extends keyof CollabSocketEvents>(
    event: K,
    ...args: Parameters<CollabSocketEvents[K]>
  ): void {
    const listeners = this.listenerGroups.get(event);
    if (!listeners) {
      return;
    }
    for (const listener of listeners) {
      (listener as (...args: any[]) => void)(...args);
    }
  }
}
