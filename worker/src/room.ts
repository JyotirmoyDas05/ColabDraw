import { isClientId, MAX_CONTROL_BYTES, MAX_FRAME_BYTES } from "./protocol";

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
      if (message.byteLength > MAX_FRAME_BYTES) {
        this.closeOversize(ws);
        return;
      }
      this.relay(ws, message);
      return;
    }
    if (message.length > MAX_CONTROL_BYTES) {
      this.closeOversize(ws);
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
    const control = payload as ClientControl;
    if (control.t === "ping") {
      this.send(ws, { t: "pong" });
      return;
    }
    if (
      control.t === "view-only" ||
      control.t === "follow" ||
      control.t === "unfollow"
    ) {
      this.updateMembershipState(ws, control);
      return;
    }
    if (control.t !== "join") {
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
        // Same client reconnecting: evict the stale socket. Closing it is
        // enough — it stops being `OPEN` immediately, so `attachments()`
        // leaves it out of every membership computation below.
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
    if (!first) {
      for (const [socket] of this.attachments()) {
        if (socket === ws) {
          continue;
        }
        this.send(socket, { t: "new-user", id: clientId });
      }
    }
    this.broadcastMembers();
  }

  async webSocketClose(ws: WebSocket) {
    const attachment = ws.deserializeAttachment() as Attachment | null;
    if (!attachment) {
      return;
    }
    // Follower state is settled before the membership broadcast so that a
    // member who followed the departing socket sees `unfollowed` first.
    this.clearFollowersOf(attachment.id);
    if (attachment.following !== null) {
      this.sendFollowers(attachment.following);
    }
    this.broadcastMembers(attachment.id);
  }

  /** Applies `view-only`, `follow` and `unfollow` from a joined member. */
  private updateMembershipState(ws: WebSocket, control: ClientControl) {
    const attachment = ws.deserializeAttachment() as Attachment | null;
    if (!attachment) {
      return;
    }
    if (control.t === "follow" || control.t === "unfollow") {
      if (!isClientId(control.target)) {
        return;
      }
      ws.serializeAttachment({
        ...attachment,
        following: control.t === "follow" ? control.target : null,
      });
      this.sendFollowers(control.target);
      return;
    }
    ws.serializeAttachment({ ...attachment, viewOnly: true });
  }

  /**
   * Relays a binary scene frame to `opcode` (1, 2 or 3) recipients: everyone
   * but the sender for 1 and 2, only members following the sender for 3 (sent
   * with opcode 2, the confirm-once opcode). Dropped for view-only senders.
   */
  private relay(ws: WebSocket, message: ArrayBuffer) {
    const sender = ws.deserializeAttachment() as Attachment | null;
    if (!sender || sender.viewOnly) {
      return;
    }
    const opcode = new Uint8Array(message)[0];
    if (opcode !== 1 && opcode !== 2 && opcode !== 3) {
      return;
    }
    let frame = message;
    if (opcode === 3) {
      frame = message.slice(0);
      new Uint8Array(frame)[0] = 2;
    }
    for (const [socket, attachment] of this.attachments()) {
      if (socket === ws) {
        continue;
      }
      if (opcode === 3 && attachment.following !== sender.id) {
        continue;
      }
      this.send(socket, frame);
    }
  }

  /** Sends the target its remaining follower ids, or `unfollowed` when none. */
  private sendFollowers(targetId: string) {
    const target = this.attachments().find(([, { id }]) => id === targetId);
    if (!target) {
      return;
    }
    const ids = this.attachments()
      .filter(([, { following }]) => following === targetId)
      .map(([, { id }]) => id)
      .sort();
    this.send(
      target[0],
      ids.length === 0 ? { t: "unfollowed" } : { t: "followers", ids },
    );
  }

  /** Clears following state on every member of `targetId` and notifies them. */
  private clearFollowersOf(targetId: string) {
    for (const [socket, attachment] of this.attachments()) {
      if (attachment.following !== targetId) {
        continue;
      }
      socket.serializeAttachment({ ...attachment, following: null });
      this.send(socket, { t: "unfollowed" });
    }
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

  /**
   * Every socket that is both `OPEN` and attached: a server-initiated close
   * (`4001`, `1009`) fires no `webSocketClose` handler and its socket lingers
   * in `getWebSockets()`, so non-`OPEN` sockets must be dropped here or they
   * would remain members forever.
   */
  private attachments(): Array<[WebSocket, Attachment]> {
    const result: Array<[WebSocket, Attachment]> = [];
    for (const socket of this.state.getWebSockets()) {
      if (socket.readyState !== WebSocket.OPEN) {
        continue;
      }
      const attachment = socket.deserializeAttachment() as Attachment | null;
      if (attachment && isClientId(attachment.id)) {
        result.push([socket, attachment]);
      }
    }
    return result;
  }

  /** Every attached socket's id, in accept order. */
  private members(): string[] {
    return this.attachments().map(([, attachment]) => attachment.id);
  }

  /** Closes an oversize frame and, if the socket had joined, tells the room. */
  private closeOversize(ws: WebSocket) {
    ws.close(1009, "frame too large");
    const attachment = ws.deserializeAttachment() as Attachment | null;
    if (attachment) {
      // A server-initiated close fires no `webSocketClose`, so the departure
      // must be broadcast here for the members to drop the ghost in time.
      this.broadcastMembers(attachment.id);
    }
  }

  /** Sends a control frame as JSON, or a scene frame as-is, to an open socket. */
  private send(ws: WebSocket, control: ServerControl | ArrayBuffer) {
    if (ws.readyState !== WebSocket.OPEN) {
      // A socket evicted mid-broadcast is closing; sending on it would throw.
      return;
    }
    ws.send(control instanceof ArrayBuffer ? control : JSON.stringify(control));
  }
}
