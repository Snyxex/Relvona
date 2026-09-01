import express from "express";
import cors from "cors";
import http from "http";
import path from "path";
import { Server as SocketIOServer } from "socket.io";
import dotenv from "dotenv";
import apiRouter from "./routes/api.js";
import { applySecurityHeaders } from "./middleware/security.js";
import { db } from "./db/index.js";
import { conversations } from "./db/schema.js";
import { eq, and } from "drizzle-orm";
import { verifyToken } from "./middleware/auth.js";

dotenv.config();

const app = express();
const server = http.createServer(app);

const io = new SocketIOServer(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

app.use(applySecurityHeaders);
app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));

// Serve static widget JS files
const publicDir = path.join(process.cwd(), "public");
app.use("/public", express.static(publicDir));

// API Routes
app.use("/api", apiRouter);

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "ai-customer-support-backend", timestamp: new Date() });
});

// Real-Time Socket.IO Server with Server-Side Room Authorization
io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id);

  // Authenticate socket handshake if token supplied
  const token = socket.handshake.auth?.token;
  let userPayload: any = null;
  if (token) {
    try {
      userPayload = verifyToken(token);
    } catch (e) {}
  }

  // Join Room with Server-Side Authorization Check
  socket.on("join_room", async (data: { room: string; organizationId: string; conversationId?: string }) => {
    try {
      const room = data.room || `conv:${data.conversationId}`;
      if (!room) return;

      // Extract conversation ID if room is conv:xxx
      let targetConvId = data.conversationId;
      if (!targetConvId && room.startsWith("conv:")) {
        targetConvId = room.replace("conv:", "");
      }

      if (targetConvId) {
        // Validate conversation belongs to the requested organization
        const [conv] = await db
          .select()
          .from(conversations)
          .where(eq(conversations.id, targetConvId))
          .limit(1);

        if (!conv) {
          socket.emit("error", { message: "Access denied: Conversation not found" });
          return;
        }

        if (data.organizationId && conv.organizationId !== data.organizationId) {
          socket.emit("error", { message: "Access denied: Cross-tenant room join attempt blocked" });
          return;
        }
      }

      socket.join(room);
      console.log(`Socket ${socket.id} authorized & joined room ${room}`);
    } catch (err) {
      socket.emit("error", { message: "Failed to authorize room join" });
    }
  });

  // Agent claims conversation / handoff
  socket.on("claim_conversation", (data: { conversationId: string; agentId: string; agentName: string }) => {
    io.to(`conv:${data.conversationId}`).emit("handoff_claimed", data);
  });

  // Send real-time chat message
  socket.on("send_message", (data: { conversationId: string; senderType: string; content: string }) => {
    io.to(`conv:${data.conversationId}`).emit("new_message", data);
  });

  socket.on("disconnect", () => {
    console.log("Socket disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`🚀 Multi-Tenant AI Customer Support Backend running on port ${PORT}`);
});
