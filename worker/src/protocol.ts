export const MAX_FRAME_BYTES = 4 * 1024 * 1024;
export const MAX_CONTROL_BYTES = 4 * 1024;
export const IV_BYTES = 12;

/**
 * How long a presentation outlives the host socket before the room declares it
 * over. Long enough to ride out a reconnect, short enough that a closed tab
 * never leaves an audience staring at a frozen slide.
 */
export const PRESENTATION_END_GRACE_MS = 2_000;

/**
 * What a socket is to the room. Only `editor` is a room member: `viewer` and
 * `remote` are the audience of a presentation, kept out of the collaborator
 * roster and unable to send frames of their own.
 */
export type Presence = "editor" | "viewer" | "remote";

/** The presentation a room is running. Owned by the room, not by a client. */
export type PresentationSession = {
  sessionId: string;
  hostId: string;
  viewers: number;
  remote: boolean;
};

export type ClientControl =
  | { t: "join"; clientId: string; presence?: Presence }
  | { t: "view-only" }
  | { t: "follow"; target: string }
  | { t: "unfollow"; target: string }
  | { t: "presentation-start" }
  | { t: "presentation-end" }
  | { t: "ping" };

export type ServerControl =
  | {
      t: "joined";
      first: boolean;
      members: string[];
      presentation: PresentationSession | null;
    }
  | { t: "members"; ids: string[] }
  | { t: "new-user"; id: string }
  | { t: "followers"; ids: string[] }
  | { t: "unfollowed" }
  | { t: "presentation"; presentation: PresentationSession | null }
  | { t: "pong" };

/** Written per socket with `serializeAttachment`; the only source of room state. */
export type Attachment = {
  id: string;
  viewOnly: boolean;
  presence: Presence;
  following: string | null;
};

export const isClientId = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9-]{8,64}$/.test(value);

export const isPresence = (value: unknown): value is Presence =>
  value === "editor" || value === "viewer" || value === "remote";

export const isRoomId = (value: string) => /^[A-Za-z0-9_-]{1,128}$/.test(value);
