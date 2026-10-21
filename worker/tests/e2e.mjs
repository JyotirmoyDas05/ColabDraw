/**
 * End-to-end check against a running Worker with real local D1 and R2.
 *
 *   node worker/tests/e2e.mjs [baseUrl]
 *
 * Every id carries a per-run suffix, so the script can run repeatedly against
 * the same database without a cleanup step in between. It does leave the rows
 * and objects it created behind; the README shows how to sweep them.
 *
 * Exits 0 when every assertion holds, 1 otherwise.
 */
const base = process.argv[2] ?? "http://localhost:8787";

const runId = Date.now().toString(36);
const roomId = `e2e-${runId}`;
const shareId = `e2e-share-${runId}`;
const fileKey = `e2e-file-${runId}`;

let failures = 0;

const ok = (name, condition, detail) => {
  if (condition) {
    console.log(`ok ${name}`);
  } else {
    failures += 1;
    console.error(`FAIL ${name}${detail ? `: ${detail}` : ""}`);
  }
};

const jsonInit = (method, body) => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const scene = (sceneVersion, ciphertext = "ct1") => ({
  roomId,
  sceneVersion,
  iv: "iv1",
  ciphertext,
});

// 1. CORS preflight
let res = await fetch(`${base}/scenes/x`, { method: "OPTIONS" });
ok("OPTIONS returns 204", res.status === 204, `status ${res.status}`);
ok(
  "OPTIONS sends CORS",
  res.headers.get("access-control-allow-origin") === "*",
  res.headers.get("access-control-allow-origin"),
);

// 2. Missing scene
res = await fetch(`${base}/scenes/${roomId}-absent`);
ok("GET missing scene is 404", res.status === 404, `status ${res.status}`);

// 3. Create
res = await fetch(`${base}/scenes/${roomId}`, jsonInit("PUT", scene(1)));
ok("PUT scene is 204", res.status === 204, `status ${res.status}`);

// 4. Read back
res = await fetch(`${base}/scenes/${roomId}`);
let body = await res.json();
ok(
  "GET scene returns what was stored",
  res.status === 200 && body.sceneVersion === 1 && body.ciphertext === "ct1",
  JSON.stringify(body),
);

// 5. Upsert
res = await fetch(`${base}/scenes/${roomId}`, jsonInit("PUT", scene(2, "ct2")));
ok("PUT scene again is 204", res.status === 204, `status ${res.status}`);
res = await fetch(`${base}/scenes/${roomId}`);
body = await res.json();
ok(
  "second PUT replaced the scene",
  body.sceneVersion === 2 && body.ciphertext === "ct2",
  JSON.stringify(body),
);

// 6. Share links
res = await fetch(
  `${base}/share-links/${shareId}`,
  jsonInit("PUT", { ciphertext: "abc" }),
);
ok("PUT share-link is 201", res.status === 201, `status ${res.status}`);

res = await fetch(
  `${base}/share-links/${shareId}`,
  jsonInit("PUT", { ciphertext: "abc" }),
);
ok("PUT share-link again is 409", res.status === 409, `status ${res.status}`);

res = await fetch(`${base}/share-links/${shareId}`);
body = await res.json();
ok(
  "GET share-link returns the ciphertext",
  res.status === 200 && body.ciphertext === "abc",
  JSON.stringify(body),
);

// 7. Files
const bytes = new TextEncoder().encode("hello");
res = await fetch(`${base}/files/${fileKey}`, {
  method: "PUT",
  headers: { "content-type": "application/octet-stream" },
  body: bytes,
});
ok("PUT file is 204", res.status === 204, `status ${res.status}`);

res = await fetch(`${base}/files/${fileKey}`);
const received = new TextDecoder().decode(await res.arrayBuffer());
ok("GET file returns the bytes", res.status === 200 && received === "hello");
ok(
  "GET file is cached forever",
  (res.headers.get("cache-control") ?? "").includes("immutable"),
  res.headers.get("cache-control"),
);

res = await fetch(`${base}/files/${fileKey}-absent`);
ok(
  "GET missing file is 404 with CORS",
  res.status === 404 && res.headers.get("access-control-allow-origin") === "*",
  `status ${res.status}`,
);

// 8. Per-owner file keys: one file id under two owners keeps both byte sets
const sharedFileId = "d".repeat(40);
const putBytes = (key, text) =>
  fetch(`${base}/files/${key}`, {
    method: "PUT",
    headers: { "content-type": "application/octet-stream" },
    body: new TextEncoder().encode(text),
  });
const getBytes = async (key) =>
  new TextDecoder().decode(
    await (await fetch(`${base}/files/${key}`)).arrayBuffer(),
  );

const roomKey = `${roomId}_${sharedFileId}`;
const shareKey = `${shareId}_${sharedFileId}`;

await putBytes(roomKey, "room-bytes");
await putBytes(shareKey, "share-bytes");

const roomBytes = await getBytes(roomKey);
const shareBytes = await getBytes(shareKey);

ok(
  "one file id under two owners keeps both byte sets",
  roomBytes === "room-bytes" && shareBytes === "share-bytes",
  `${roomBytes} / ${shareBytes}`,
);

// 9. Oversized body, declared
res = await fetch(
  `${base}/scenes/${roomId}`,
  jsonInit("PUT", scene(3, "x".repeat(5 * 1024 * 1024))),
);
ok("PUT oversized scene is 413", res.status === 413, `status ${res.status}`);

// 10. Oversized body, chunked with no content-length, so only the streaming
//     cap can stop it
let chunkedStatus = 0;
try {
  res = await fetch(`${base}/scenes/${roomId}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(1024 * 1024));
        controller.enqueue(new Uint8Array(1024 * 1024));
        controller.close();
      },
    }),
    // Node needs this for a stream body; the Worker does not.
    duplex: "half",
  });
  chunkedStatus = res.status;
} catch (error) {
  chunkedStatus = `threw ${error.message}`;
}

ok(
  "PUT chunked oversized scene is 413",
  chunkedStatus === 413,
  `status ${chunkedStatus}`,
);

if (failures) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}

console.log("\nall assertions passed");
