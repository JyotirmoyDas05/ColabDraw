import { fail, json, readJson } from "./http";

import type { Env, SceneRecord } from "./types";

type SceneBody = {
  roomId?: unknown;
  sceneVersion?: unknown;
  iv?: unknown;
  ciphertext?: unknown;
};

const isSceneBody = (
  body: SceneBody | null,
): body is { sceneVersion: number; iv: string; ciphertext: string } =>
  !!body &&
  typeof body.sceneVersion === "number" &&
  Number.isFinite(body.sceneVersion) &&
  typeof body.iv === "string" &&
  body.iv.length > 0 &&
  typeof body.ciphertext === "string" &&
  body.ciphertext.length > 0;

export const getScene = async (env: Env, roomId: string): Promise<Response> => {
  const row = await env.DB.prepare(
    "SELECT scene_version, iv, ciphertext FROM scenes WHERE room_id = ?",
  )
    .bind(roomId)
    .first<Pick<SceneRecord, "scene_version" | "iv" | "ciphertext">>();

  if (!row) {
    return fail(404, "not_found");
  }

  return json({
    roomId,
    sceneVersion: row.scene_version,
    iv: row.iv,
    ciphertext: row.ciphertext,
  });
};

/**
 * Upsert: the client has already merged what it read with what it drew, so the
 * Worker never has to distinguish "create" from "update".
 */
export const putScene = async (
  env: Env,
  roomId: string,
  request: Request,
): Promise<Response> => {
  const body = await readJson<SceneBody>(request);

  if (!isSceneBody(body)) {
    return fail(400, "bad_request");
  }

  await env.DB.prepare(
    `INSERT INTO scenes (room_id, scene_version, iv, ciphertext, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(room_id) DO UPDATE SET
       scene_version = excluded.scene_version,
       iv = excluded.iv,
       ciphertext = excluded.ciphertext,
       updated_at = excluded.updated_at`,
  )
    .bind(roomId, body.sceneVersion, body.iv, body.ciphertext, Date.now())
    .run();

  return new Response(null, { status: 204 });
};
