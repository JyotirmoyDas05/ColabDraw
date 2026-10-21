export type Env = {
  DB: D1Database;
  FILES: R2Bucket;
};

export type SceneRecord = {
  room_id: string;
  scene_version: number;
  iv: string;
  ciphertext: string;
};

export type ShareLinkRecord = {
  id: string;
  ciphertext: string;
};
