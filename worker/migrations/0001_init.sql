CREATE TABLE IF NOT EXISTS scenes (
  room_id       TEXT PRIMARY KEY,
  scene_version INTEGER NOT NULL,
  iv            TEXT NOT NULL,
  ciphertext    TEXT NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS share_links (
  id         TEXT PRIMARY KEY,
  ciphertext TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
