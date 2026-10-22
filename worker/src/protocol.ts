export const MAX_FRAME_BYTES = 4 * 1024 * 1024;
export const MAX_CONTROL_BYTES = 4 * 1024;
export const IV_BYTES = 12;

export type ClientControl =
  | { t: "join"; clientId: string }
  | { t: "view-only" }
  | { t: "follow"; target: string }
  | { t: "unfollow"; target: string }
  | { t: "ping" };

export type ServerControl =
  | { t: "joined"; first: boolean; members: string[] }
  | { t: "members"; ids: string[] }
  | { t: "new-user"; id: string }
  | { t: "followers"; ids: string[] }
  | { t: "unfollowed" }
  | { t: "pong" };

/** Written per socket with `serializeAttachment`; the only source of room state. */
export type Attachment = {
  id: string;
  viewOnly: boolean;
  following: string | null;
};

export const isClientId = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9-]{8,64}$/.test(value);

export const isRoomId = (value: string) => /^[A-Za-z0-9_-]{1,128}$/.test(value);
