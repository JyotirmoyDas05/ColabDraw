export type CollabSocketEvents = {
  joined: (payload: { first: boolean; members: string[] }) => void;
  members: (ids: string[]) => void;
  newUser: (id: string) => void;
  followers: (ids: string[]) => void;
  unfollowed: () => void;
  scene: (payload: { opcode: 1 | 2; iv: Uint8Array; data: Uint8Array }) => void;
  status: (status: "connecting" | "open" | "unavailable") => void;
};

type SceneOpcode = 1 | 2;

type ServerControl =
  | { t: "joined"; first: boolean; members: string[] }
  | { t: "members"; ids: string[] }
  | { t: "new-user"; id: string }
  | { t: "followers"; ids: string[] }
  | { t: "unfollowed" }
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

type AnyListener = (...args: any[]) => void;

export class CollabSocket {
  readonly id = crypto.randomUUID();

  private readonly listenerGroups = new Map<
    keyof CollabSocketEvents,
    Set<AnyListener>
  >();

  private readonly url: string;
  private socket: WebSocket | null = null;
  private isViewOnly: boolean;
  private closed = false;
  private attempt = 0;
  private following: string | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    urlOrBackend: string,
    roomIdOrOptions?: string | { isViewOnly?: boolean },
    options?: { isViewOnly?: boolean },
  ) {
    if (typeof roomIdOrOptions === "string") {
      const baseWsUrl = urlOrBackend
        .replace(/^https:\/\//i, "wss://")
        .replace(/^http:\/\//i, "ws://")
        .replace(/\/+$/, "");
      this.url = `${baseWsUrl}/rooms/${encodeURIComponent(roomIdOrOptions)}`;
      this.isViewOnly = options?.isViewOnly ?? false;
    } else {
      this.url = urlOrBackend;
      this.isViewOnly = roomIdOrOptions?.isViewOnly ?? options?.isViewOnly ?? false;
    }
  }

  open(): void {
    if (this.closed) {
      this.closed = false;
    }
    this.connect();
  }

  connect(): void {
    this.clearTimers();
    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        // WebSocket may already be closing or closed
      }
      this.socket = null;
    }
    try {
      const socket = new WebSocket(this.url);
      socket.binaryType = "arraybuffer";
      socket.onopen = this.handleOpen;
      socket.onclose = this.handleClose;
      socket.onerror = this.handleError;
      socket.onmessage = this.handleMessage;
      this.socket = socket;
    } catch {
      this.scheduleReconnect();
    }
  }

  close(): void {
    this.closed = true;
    this.clearTimers();
    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        // WebSocket may already be closing or closed
      }
      this.socket = null;
    }
  }

  sendUpdate(
    ciphertext: ArrayBuffer,
    iv: Uint8Array,
    options?: { volatile?: boolean; followersOnly?: boolean },
  ): void {
    if (options?.followersOnly) {
      this.broadcastVolatileToFollowers(iv, ciphertext);
    } else if (options?.volatile) {
      this.broadcastVolatile(iv, ciphertext);
    } else {
      this.broadcastScene(iv, ciphertext);
    }
  }

  /**
   * Broadcast a full scene update (opcode 1).
   */
  broadcastScene(iv: Uint8Array, ciphertext: ArrayBuffer): void {
    this.sendBinaryFrame(SCENE_OPCODE, iv, ciphertext);
  }

  /**
   * Broadcast mouse / volatile pointer data (opcode 2).
   */
  broadcastVolatile(iv: Uint8Array, ciphertext: ArrayBuffer): void {
    this.sendBinaryFrame(VOLATILE_OPCODE, iv, ciphertext);
  }

  /**
   * Broadcast mouse position to followers only (opcode 3).
   */
  broadcastVolatileToFollowers(iv: Uint8Array, ciphertext: ArrayBuffer): void {
    this.sendBinaryFrame(VOLATILE_TO_FOLLOWERS_OPCODE, iv, ciphertext);
  }

  private sendBinaryFrame(
    opcode: number,
    iv: Uint8Array,
    data: ArrayBuffer,
  ): void {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      return;
    }
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

  private sendControl(message: { t: string; [key: string]: unknown }): void {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      return;
    }
    this.socket.send(JSON.stringify(message));
  }

  private handleOpen = (): void => {
    this.attempt = 0;
    this.emit("status", "open");
    this.sendControl({ t: "join", clientId: this.id });
    if (this.isViewOnly) {
      this.sendControl({ t: "view-only" });
    }
    this.startHeartbeat();
  };

  private handleClose = (): void => {
    this.clearTimers();
    this.socket = null;
    if (this.closed) {
      return;
    }
    this.scheduleReconnect();
  };

  private handleError = (): void => {
    // Errors are followed by close; let close handle reconnection.
  };

  private handleMessage = (event: MessageEvent): void => {
    if (typeof event.data === "string") {
      this.handleControl(event.data);
      return;
    }
    if (event.data instanceof ArrayBuffer) {
      this.handleBinary(event.data);
    }
  };

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
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
  }

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
    let raw: unknown;
    try {
      raw = JSON.parse(text) as unknown;
    } catch {
      return;
    }
    if (typeof raw !== "object" || raw === null) {
      return;
    }
    const control = raw as Partial<ServerControl> & { ids?: unknown; id?: unknown };
    switch (control.t) {
      case "joined":
        this.emit("joined", {
          first: control.first === true,
          members: this.filterIds(control.members),
        });
        return;
      case "members":
        this.emit("members", this.filterIds(control.ids));
        return;
      case "new-user":
        if (typeof control.id === "string") {
          this.emit("newUser", control.id);
        }
        return;
      case "followers":
        this.emit("followers", this.filterIds(control.ids));
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

  private handleBinary(buffer: ArrayBuffer): void {
    if (buffer.byteLength < FRAME_HEADER_BYTES) {
      return;
    }
    const header = new Uint8Array(buffer, 0, FRAME_HEADER_BYTES);
    const opcode = header[0];
    if (opcode !== SCENE_OPCODE && opcode !== VOLATILE_OPCODE) {
      return;
    }
    const iv = header.subarray(1, FRAME_HEADER_BYTES);
    const data = new Uint8Array(buffer, FRAME_HEADER_BYTES);
    this.emit("scene", { opcode: opcode as SceneOpcode, iv, data });
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
      (listener as (...a: unknown[]) => void)(...args);
    }
  }
}
