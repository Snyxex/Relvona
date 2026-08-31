import express from "express";
import cors from "cors";
import http from "http";
import { Server as SocketIOServer } from "socket.io";
import dotenv from "dotenv";
import apiRouter from "./routes/api.js";

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: "*",
  },
});

app.use(cors());
app.use(express.json());

// API Routes
app.use("/api", apiRouter);

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date() });
});

// Socket.IO for real-time human agent handoff chat
io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  socket.on("join_ticket", (ticketId) => {
    socket.join(ticketId);
    console.log(`Socket ${socket.id} joined ticket room ${ticketId}`);
  });

  socket.on("send_message", (data) => {
    // Broadcast message to ticket room
    io.to(data.ticketId).emit("new_message", data);
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`AI Customer Support Backend running on port ${PORT}`);
});
