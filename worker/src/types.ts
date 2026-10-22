export type Env = {
  DB: D1Database;
  FILES: R2Bucket;
  ROOMS: DurableObjectNamespace;
  GEMINI_API_KEY?: string;
  GEMINI_MODELS?: string;
  AI_TRIAL_PER_DEVICE?: string;
  AI_TRIAL_PER_IP?: string;
  AI_TRIAL_GLOBAL?: string;
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
