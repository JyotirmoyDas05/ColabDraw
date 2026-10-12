import cors from "cors";
import debug from "debug";
import express from "express";
import http from "http";
import { Server as SocketIO } from "socket.io";

type UserToFollow = {
  socketId: string;
  username: string;
};
type OnUserFollowedPayload = {
  userToFollow: UserToFollow;
  action: "FOLLOW" | "UNFOLLOW";
};

const serverDebug = debug("server");
const ioDebug = debug("io");
const socketDebug = debug("socket");

require("dotenv").config(
  process.env.NODE_ENV !== "development"
    ? { path: ".env.production" }
    : { path: ".env.development" },
);

const app = express();
const port =
  process.env.PORT || (process.env.NODE_ENV !== "development" ? 80 : 3002); // default port to listen

// CORS_ORIGIN accepts "*" or a comma-separated list of origins
const corsOrigin =
  process.env.CORS_ORIGIN && process.env.CORS_ORIGIN !== "*"
    ? process.env.CORS_ORIGIN.split(",").map((origin) => origin.trim())
    : "*";

app.set("trust proxy", 1);
app.use(express.static("public"));
app.use(express.json({ limit: "256kb" }));
app.use(
  cors({
    origin: corsOrigin,
    methods: ["GET", "POST"],
    credentials: true,
  }),
);

app.get("/", (req, res) => {
  res.send("Excalidraw collaboration server is up :)");
});

// ============================================================================
// AI free trial: proxies text-only Gemini requests with the server's key so
// first-time users can try AI before adding their own key.
// ============================================================================

declare const fetch: (url: string, init?: any) => Promise<any>;

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
const TRIAL_LIMITS = {
  device: Number(process.env.AI_TRIAL_PER_DEVICE || 20),
  ip: Number(process.env.AI_TRIAL_PER_IP || 40),
  global: Number(process.env.AI_TRIAL_GLOBAL || 400),
};
const MAX_TRIAL_REQUEST_CHARS = 40_000;

// ponytail: in-memory counters reset on server restart; persist them
// (e.g. Appwrite) if the trial gets abused
let usageDay = "";
const usage = new Map<string, number>();

// Gemini free-tier quotas reset at midnight Pacific
const today = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });

const trialKeys = (deviceId: string, ip: string) => ({
  device: `device:${deviceId}`,
  ip: `ip:${ip}`,
  global: "global",
});

const getTrialRemaining = (deviceId: string, ip: string) => {
  if (usageDay !== today()) {
    usageDay = today();
    usage.clear();
  }
  const keys = trialKeys(deviceId, ip);
  return Math.max(
    0,
    Math.min(
      TRIAL_LIMITS.device - (usage.get(keys.device) || 0),
      TRIAL_LIMITS.ip - (usage.get(keys.ip) || 0),
      TRIAL_LIMITS.global - (usage.get(keys.global) || 0),
    ),
  );
};

const addTrialUsage = (deviceId: string, ip: string, delta: 1 | -1) => {
  for (const key of Object.values(trialKeys(deviceId, ip))) {
    usage.set(key, (usage.get(key) || 0) + delta);
  }
};

const isValidDeviceId = (deviceId: unknown): deviceId is string =>
  typeof deviceId === "string" && /^[\w-]{8,64}$/.test(deviceId);

app.get("/api/ai/trial", (req, res) => {
  const { deviceId } = req.query;
  if (!isValidDeviceId(deviceId)) {
    return res.status(400).json({ error: "invalid_device_id" });
  }
  res.json({
    enabled: !!process.env.GEMINI_API_KEY,
    remaining: getTrialRemaining(deviceId, req.ip),
    limit: TRIAL_LIMITS.device,
  });
});

app.post("/api/ai/trial/generate", async (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: "trial_disabled" });
  }

  const { deviceId, request } = req.body || {};
  if (!isValidDeviceId(deviceId) || !request?.contents) {
    return res.status(400).json({ error: "invalid_request" });
  }
  // the trial is text-only: audio/images must use the user's own key
  const parts = [request.contents, request.systemInstruction].flat(2);
  const hasMedia = JSON.stringify(parts).match(/"(inlineData|fileData)"/);
  if (hasMedia) {
    return res.status(415).json({ error: "media_not_allowed" });
  }
  if (JSON.stringify(request).length > MAX_TRIAL_REQUEST_CHARS) {
    return res.status(413).json({ error: "request_too_large" });
  }

  if (getTrialRemaining(deviceId, req.ip) <= 0) {
    return res.status(429).json({ error: "trial_exhausted" });
  }
  addTrialUsage(deviceId, req.ip, 1);

  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          contents: request.contents,
          systemInstruction: request.systemInstruction,
          generationConfig: request.generationConfig,
        }),
      },
    );
    const data = await geminiRes.json();
    if (!geminiRes.ok) {
      addTrialUsage(deviceId, req.ip, -1);
      // the shared free-tier key ran out of quota for everyone
      const error = geminiRes.status === 429 ? "trial_busy" : "upstream_error";
      return res.status(geminiRes.status === 429 ? 429 : 502).json({ error });
    }
    res.set("X-Trial-Remaining", String(getTrialRemaining(deviceId, req.ip)));
    res.json(data);
  } catch (error: any) {
    addTrialUsage(deviceId, req.ip, -1);
    serverDebug(`trial generate failed: ${error.message}`);
    res.status(502).json({ error: "upstream_error" });
  }
});

const server = http.createServer(app);

server.listen(port, () => {
  serverDebug(`listening on port: ${port}`);
});

try {
  const io = new SocketIO(server, {
    transports: ["websocket", "polling"],
    cors: {
      allowedHeaders: ["Content-Type", "Authorization"],
      origin: corsOrigin,
      credentials: true,
    },
    allowEIO3: true,
  });

  io.on("connection", (socket) => {
    ioDebug("connection established!");
    io.to(`${socket.id}`).emit("init-room");
    socket.on("join-room", async (roomID) => {
      socketDebug(`${socket.id} has joined ${roomID}`);
      await socket.join(roomID);
      const sockets = await io.in(roomID).fetchSockets();
      if (sockets.length <= 1) {
        io.to(`${socket.id}`).emit("first-in-room");
      } else {
        socketDebug(`${socket.id} new-user emitted to room ${roomID}`);
        socket.broadcast.to(roomID).emit("new-user", socket.id);
      }

      io.in(roomID).emit(
        "room-user-change",
        sockets.map((socket) => socket.id),
      );
    });

    socket.on(
      "server-broadcast",
      (roomID: string, encryptedData: ArrayBuffer, iv: Uint8Array) => {
        socketDebug(`${socket.id} sends update to ${roomID}`);
        socket.broadcast.to(roomID).emit("client-broadcast", encryptedData, iv);
      },
    );

    socket.on(
      "server-volatile-broadcast",
      (roomID: string, encryptedData: ArrayBuffer, iv: Uint8Array) => {
        socketDebug(`${socket.id} sends volatile update to ${roomID}`);
        socket.volatile.broadcast
          .to(roomID)
          .emit("client-broadcast", encryptedData, iv);
      },
    );

    socket.on("user-follow", async (payload: OnUserFollowedPayload) => {
      const roomID = `follow@${payload.userToFollow.socketId}`;

      switch (payload.action) {
        case "FOLLOW": {
          await socket.join(roomID);

          const sockets = await io.in(roomID).fetchSockets();
          const followedBy = sockets.map((socket) => socket.id);

          io.to(payload.userToFollow.socketId).emit(
            "user-follow-room-change",
            followedBy,
          );

          break;
        }
        case "UNFOLLOW": {
          await socket.leave(roomID);

          const sockets = await io.in(roomID).fetchSockets();
          const followedBy = sockets.map((socket) => socket.id);

          io.to(payload.userToFollow.socketId).emit(
            "user-follow-room-change",
            followedBy,
          );

          break;
        }
      }
    });

    socket.on("disconnecting", async () => {
      socketDebug(`${socket.id} has disconnected`);
      for (const roomID of Array.from(socket.rooms)) {
        const otherClients = (await io.in(roomID).fetchSockets()).filter(
          (_socket) => _socket.id !== socket.id,
        );

        const isFollowRoom = roomID.startsWith("follow@");

        if (!isFollowRoom && otherClients.length > 0) {
          socket.broadcast.to(roomID).emit(
            "room-user-change",
            otherClients.map((socket) => socket.id),
          );
        }

        if (isFollowRoom && otherClients.length === 0) {
          const socketId = roomID.replace("follow@", "");
          io.to(socketId).emit("broadcast-unfollow");
        }
      }
    });

    socket.on("disconnect", () => {
      socket.removeAllListeners();
      socket.disconnect();
    });
  });
} catch (error) {
  console.error(error);
}
