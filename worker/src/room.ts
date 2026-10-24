import {
  isClientId,
  isPresence,
  MAX_CONTROL_BYTES,
  MAX_FRAME_BYTES,
  PRESENTATION_END_GRACE_MS,
} from "./protocol";

import type {
  Attachment,
  ClientControl,
  PresentationSession,
  ServerControl,
} from "./protocol";
import type { Env } from "./types";

export class Room {
  /**
   * The live presentation. Deliberately in memory: a Durable Object that
   * hibernates closes its sockets, so every participant reconnects and the
   * host re-asserts the session — there is nothing to persist.
   */
  private presentation: { sessionId: string; hostId: string } | null = null;
  private presentationEndTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {}

  async fetch(request?: Request): Promise<Response> {
    if (request) {
      const url = new URL(request.url);
      if (url.pathname === "/ai-proxy") {
        const { model, apiKey, body } = (await request.json()) as {
          model: string;
          apiKey: string;
          body: unknown;
        };
        return fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": apiKey,
            },
            body: JSON.stringify(body),
          },
        );
      }
    }
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
    if (control.t === "presentation-start") {
      this.startPresentation(ws);
      return;
    }
    if (control.t === "presentation-end") {
      this.endPresentationBy(ws);
      return;
    }
    if (control.t !== "join") {
      return;
    }
    if (!isClientId((payload as { clientId?: unknown }).clientId)) {
      return;
    }

    const clientId = (payload as { clientId: string }).clientId;
    const presence = isPresence((payload as { presence?: unknown }).presence)
      ? (payload as { presence: Attachment["presence"] }).presence
      : "editor";
    const isEditor = presence === "editor";
    // Only an editor can take the "first in the room" slot: it is the one who
    // pushes its scene to the room, and an audience must never do that.
    let first = isEditor;
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
      if (isEditor && attachment.presence === "editor") {
        first = false;
      }
    }

    ws.serializeAttachment({
      id: clientId,
      viewOnly: false,
      presence,
      following: null,
    });
    this.send(ws, {
      t: "joined",
      first,
      members: this.members().sort(),
      presentation: this.snapshot(),
    });
    if (!isEditor) {
      // The audience changes the session's shape, not the room's membership.
      this.broadcastPresentation();
      return;
    }
    if (!first) {
      for (const [socket, attachment] of this.attachments()) {
        if (socket === ws || attachment.presence !== "editor") {
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
    if (attachment.presence === "editor") {
      this.broadcastMembers(attachment.id);
      if (this.presentation?.hostId === attachment.id) {
        this.schedulePresentationEnd();
      }
      return;
    }
    // A viewer or a remote leaving changes how many are watching.
    this.broadcastPresentation();
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
   * Starts (or re-asserts) the room's presentation. An editor owns the
   * session; the newest start wins, so a second editor taking over replaces
   * the host rather than opening a second session.
   */
  private startPresentation(ws: WebSocket) {
    const attachment = ws.deserializeAttachment() as Attachment | null;
    if (!attachment || attachment.presence !== "editor") {
      return;
    }
    if (this.presentation?.hostId === attachment.id) {
      // Rejoin and reconnect both land here; keep the session id stable so
      // clients can tell a re-assert from a new presentation.
      this.broadcastPresentation();
      return;
    }
    this.clearPresentationEndTimer();
    this.presentation = {
      sessionId: crypto.randomUUID(),
      hostId: attachment.id,
    };
    this.broadcastPresentation();
  }

  /** Ends the session for the room. Only the host or the remote may ask. */
  private endPresentationBy(ws: WebSocket) {
    const attachment = ws.deserializeAttachment() as Attachment | null;
    if (!attachment || !this.presentation) {
      return;
    }
    if (
      this.presentation.hostId !== attachment.id &&
      attachment.presence !== "remote"
    ) {
      return;
    }
    this.endPresentation();
  }

  /**
   * The host's socket is gone: give it the grace period to reconnect before
   * telling the room the presentation is over.
   */
  private schedulePresentationEnd() {
    if (this.presentationEndTimer !== null) {
      return;
    }
    this.presentationEndTimer = setTimeout(() => {
      this.presentationEndTimer = null;
      if (!this.presentation || this.hasPresentationHost()) {
        return;
      }
      this.endPresentation();
    }, PRESENTATION_END_GRACE_MS);
  }

  private clearPresentationEndTimer() {
    if (this.presentationEndTimer !== null) {
      clearTimeout(this.presentationEndTimer);
      this.presentationEndTimer = null;
    }
  }

  /** Drops the session and tells every socket, including the audience. */
  private endPresentation() {
    if (!this.presentation) {
      return;
    }
    this.presentation = null;
    this.clearPresentationEndTimer();
    for (const [socket] of this.attachments()) {
      this.send(socket, { t: "presentation", presentation: null });
    }
  }

  private hasPresentationHost() {
    const hostId = this.presentation?.hostId;
    return (
      hostId !== undefined &&
      this.attachments().some(([, { id }]) => id === hostId)
    );
  }

  /** The live session with its current audience, or null when idle. */
  private snapshot(): PresentationSession | null {
    if (!this.presentation) {
      return null;
    }
    let viewers = 0;
    let remote = false;
    for (const [, attachment] of this.attachments()) {
      if (attachment.presence === "viewer") {
        viewers++;
      } else if (attachment.presence === "remote") {
        remote = true;
      }
    }
    return { ...this.presentation, viewers, remote };
  }

  /** Broadcasts the live session. Silent when there is nothing to present. */
  private broadcastPresentation() {
    if (!this.presentation) {
      return;
    }
    const presentation = this.snapshot();
    for (const [socket] of this.attachments()) {
      this.send(socket, { t: "presentation", presentation });
    }
  }

  /**
   * Relays a binary scene frame to `opcode` (1, 2 or 3) recipients: everyone
   * but the sender for 1 and 2, only members following the sender for 3 (sent
   * with opcode 2, the confirm-once opcode).
   *
   * Read-only links send nothing, the presentation audience sends nothing, and
   * the remote control may only send volatile frames — its presentation
   * commands ride opcode 2, while scene edits stay a presenter's privilege.
   */
  private relay(ws: WebSocket, message: ArrayBuffer) {
    const sender = ws.deserializeAttachment() as Attachment | null;
    if (!sender || sender.viewOnly || sender.presence === "viewer") {
      return;
    }
    const opcode = new Uint8Array(message)[0];
    if (opcode !== 1 && opcode !== 2 && opcode !== 3) {
      return;
    }
    if (sender.presence !== "editor" && opcode !== 2) {
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

  /** Every attached editor's id, in accept order. The audience is not a peer. */
  private members(): string[] {
    return this.attachments()
      .filter(([, attachment]) => attachment.presence === "editor")
      .map(([, attachment]) => attachment.id);
  }

  /** Closes an oversize frame and, if the socket had joined, tells the room. */
  private closeOversize(ws: WebSocket) {
    ws.close(1009, "frame too large");
    const attachment = ws.deserializeAttachment() as Attachment | null;
    if (attachment?.presence === "editor") {
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
