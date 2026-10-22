import { isClientId } from "./protocol";

import type { Attachment, ClientControl, ServerControl } from "./protocol";
import type { Env } from "./types";

export class Room {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {}

  async fetch(): Promise<Response> {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== "string") {
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(message);
    } catch {
      return;
    }
    if (typeof payload !== "object" || payload === null) {
      return;
    }
    // `join` and `ping` are handled here; other message kinds arrive in later tasks
    if ((payload as ClientControl).t === "ping") {
      this.send(ws, { t: "pong" });
      return;
    }
    if ((payload as ClientControl).t !== "join") {
      return;
    }
    if (!isClientId((payload as { clientId?: unknown }).clientId)) {
      return;
    }

    const clientId = (payload as { clientId: string }).clientId;
    let first = true;
    for (const [socket, attachment] of this.attachments()) {
      if (socket === ws) {
        continue;
      }
      if (attachment.id === clientId) {
        // Same client reconnecting: evict the stale socket rather than count it.
        socket.close(4001, "replaced");
        continue;
      }
      first = false;
    }

    ws.serializeAttachment({
      id: clientId,
      viewOnly: false,
      following: null,
    });
    this.send(ws, {
      t: "joined",
      first,
      members: this.members().sort(),
    });
    if (first) {
      return;
    }
    for (const [socket] of this.attachments()) {
      if (socket === ws) {
        continue;
      }
      this.send(socket, { t: "new-user", id: clientId });
    }
    this.broadcastMembers();
  }

  async webSocketClose(ws: WebSocket) {
    let attachment: Attachment | null;
    try {
      attachment = ws.deserializeAttachment() as Attachment | null;
    } catch {
      // A socket that never joined has no attachment and is not a member.
      return;
    }
    if (!attachment) {
      return;
    }
    this.broadcastMembers(attachment.id);
  }

  /** Sends the room membership, sorted, to every member except `excludeId`. */
  private broadcastMembers(excludeId?: string) {
    const ids = this.members().sort();
    for (const [socket, { id }] of this.attachments()) {
      if (excludeId !== undefined && id === excludeId) {
        continue;
      }
      this.send(socket, { t: "members", ids });
    }
  }

  private attachments(): Array<[WebSocket, Attachment]> {
    const result: Array<[WebSocket, Attachment]> = [];
    for (const socket of this.state.getWebSockets()) {
      try {
        const attachment = socket.deserializeAttachment() as Attachment | null;
        if (attachment && isClientId(attachment.id)) {
          result.push([socket, attachment]);
        }
      } catch {
        // A socket that never joined has no attachment and is not a member.
      }
    }
    return result;
  }

  private members(): string[] {
    return this.attachments().map(([, attachment]) => attachment.id);
  }

  private send(ws: WebSocket, control: ServerControl) {
    ws.send(JSON.stringify(control));
  }
}
