import { google } from "@ai-sdk/google";
import { generateText } from "ai";
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

app.use(express.static("public"));
app.use(express.json({ limit: "50mb" }));
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "*",
    methods: ["GET", "POST"],
    credentials: true,
  }),
);

app.get("/", (req, res) => {
  res.send("Excalidraw collaboration server is up :)");
});

// ============================================================================
// AI API Routes (Server-side to protect API Key and solve 429 error problem)
// ============================================================================

const getGeminiKey = () => process.env.GOOGLE_GENERATIVE_AI_API_KEY;

/**
 * Endpoint for image-to-image/text-to-image generation
 * Follows correct approach with server-side system prompt wrapping
 */
app.post("/api/generate-image", async (req, res) => {
  try {
    const apiKey = getGeminiKey();
    if (!apiKey) {
      return res
        .status(500)
        .json({ success: false, error: "Missing Gemini API Key on server" });
    }

    const { prompt, image_data } = req.body;

    // Validate that we have image data (Selection Only might send null/empty)
    if (!image_data) {
      return res.status(400).json({
        success: false,
        error:
          "No image data provided. Make sure to draw something on the canvas first.",
      });
    }

    // Validate prompt
    if (!prompt?.trim()) {
      return res.status(400).json({
        success: false,
        error: "Missing prompt. Please enter a description.",
      });
    }

    // Note: google() reads GOOGLE_GENERATIVE_AI_API_KEY from env automatically

    // Build message content - Image first, then prompt (like ChalkAI)
    const messageContent: any[] = [];

    // Add reference image - ensure proper data URL format
    const imageDataUrl = image_data.startsWith("data:")
      ? image_data
      : `data:image/png;base64,${image_data}`;
    messageContent.push({ type: "image", image: imageDataUrl });

    // ChalkAI-style: Wrap user prompt in detailed system instructions
    messageContent.push({
      type: "text",
      text: `Generate a clean, high-quality, professional diagram as a PNG image based on the provided reference image and the user's explanation.

IMPORTANT INTERPRETATION RULE:
- Treat the reference image as a rough sketch or visual hint, NOT as a final diagram.
- You are allowed and expected to redraw, correct, and standardize shapes, proportions, and outlines to create a proper textbook-style diagram.

Diagram guidelines:
- Use a clean white background.
- Replace all rough, hand-drawn, or uneven outlines with precise, smooth, and well-proportioned shapes.
- Redraw objects using correct canonical forms (e.g., cylinders, boxes, arrows, tubes) even if the sketch is distorted or incomplete.
- Do NOT trace the sketch. Reconstruct the diagram clearly and accurately.
- Use consistent line thickness and clean geometry.
- Use arrows and connectors to clearly show structure, flow, or relationships.
- Include and clearly label all entities, components, and relationships mentioned in the user's explanation.
- If the sketch is ambiguous, resolve it into the most reasonable and standard diagram based on the explanation.

Text handling:
- Preserve any text or labels from the reference image exactly if they exist.
- Add missing labels ONLY if they are clearly implied by the user's explanation.

Output requirements:
- Output only the generated PNG image.
- Do not include any text, explanations, or captions outside the image.

User explanation:
${prompt}
`,
    });

    console.log("[AI] Generating image with prompt:", prompt.substring(0, 100));

    const { files } = await generateText({
      model: google("gemini-2.5-flash-image"),
      messages: [
        {
          role: "user",
          content: messageContent,
        },
      ],
    });

    // Extract image from generated files (same as ChalkAI)
    const imageFile = files?.find((f) => f.mediaType.startsWith("image/"));

    if (!imageFile) {
      return res.status(500).json({
        success: false,
        error: "No image returned by model. Try a different prompt.",
      });
    }

    // Use base64 property directly if available, otherwise convert uint8Array (ChalkAI approach)
    const base64Image =
      imageFile.base64 ??
      (imageFile.uint8Array
        ? Buffer.from(imageFile.uint8Array).toString("base64")
        : null);

    if (!base64Image) {
      return res.status(500).json({
        success: false,
        error: "Could not extract image data from model response.",
      });
    }

    console.log("[AI] Image generated successfully");
    res.json({ success: true, image_data: base64Image });
  } catch (error: any) {
    console.error("AI Generation Error:", error);

    // Check for rate limit errors
    const isRateLimit =
      error.status === 429 ||
      error.message?.toLowerCase().includes("quota") ||
      error.message?.toLowerCase().includes("rate");

    res.status(isRateLimit ? 429 : 500).json({
      success: false,
      error: error.message || "Failed to generate image",
      rateLimited: isRateLimit,
    });
  }
});

/**
 * Endpoint for canvas analysis (text mode)
 */
app.post("/api/analyze-canvas", async (req, res) => {
  try {
    const apiKey = getGeminiKey();
    if (!apiKey) {
      return res
        .status(500)
        .json({ success: false, error: "Missing Gemini API Key on server" });
    }

    const { prompt, image_data } = req.body;

    // Validate image data
    if (!image_data) {
      return res.status(400).json({
        success: false,
        error: "No image data provided. Make sure to draw something first.",
      });
    }

    const googleProvider = google;

    // Ensure proper data URL format
    const imageDataUrl = image_data.startsWith("data:")
      ? image_data
      : `data:image/png;base64,${image_data}`;

    const messageContent: any[] = [
      {
        type: "image",
        image: imageDataUrl,
      },
      {
        type: "text",
        text: prompt || "Analyze this canvas and describe what you see.",
      },
    ];

    console.log("[AI] Analyzing canvas...");

    const { text } = await generateText({
      model: google("gemini-2.5-flash"),
      messages: [
        {
          role: "user",
          content: messageContent,
        },
      ],
    });

    console.log("[AI] Analysis complete");
    res.json({ success: true, response: text });
  } catch (error: any) {
    console.error("AI Analysis Error:", error);

    const isRateLimit =
      error.status === 429 ||
      error.message?.toLowerCase().includes("quota") ||
      error.message?.toLowerCase().includes("rate");

    res.status(isRateLimit ? 429 : 500).json({
      success: false,
      error: error.message || "Failed to analyze canvas",
      rateLimited: isRateLimit,
    });
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
      origin: process.env.CORS_ORIGIN || "*",
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
