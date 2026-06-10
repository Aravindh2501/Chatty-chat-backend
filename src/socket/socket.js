import { Server } from "socket.io";
import {
  handleRegisterUser,
  handleJoinRoom,
  handleSendMessage,
  handleStartTyping,
  handleStopTyping,
  handleDisconnect,
  handleDeleteMessage,
  handleMarkRead,
} from "./socketEvents.js";

let io;
export const onlineUsers = new Map();

const setupSocket = (httpServer) => {
  io = new Server(httpServer, {
    cors: {
      origin: process.env.CLIENT_URL || "*",
      methods: ["GET", "POST"],
      credentials: true,
    },
  });

  io.on("connection", (socket) => {
    console.log("Connected:", socket.id);

    socket.on("register_user", ({ userId }) => {
      handleRegisterUser(socket, userId);
    });

    socket.on("join_room", ({ senderId, receiverId }) => {
      handleJoinRoom(socket, senderId, receiverId);
    });

    socket.on("send_message", (data) => {
      handleSendMessage(data);
    });

    socket.on("start_typing", ({ senderId, receiverId }) => {
      handleStartTyping(socket, senderId, receiverId);
    });

    socket.on("stop_typing", ({ senderId, receiverId }) => {
      handleStopTyping(socket, senderId, receiverId);
    });

    socket.on("delete_message", ({ messageId, senderId, receiverId, isDeleted }) => {
      handleDeleteMessage(messageId, senderId, receiverId, isDeleted);
    });

    socket.on("mark_read", ({ senderId, receiverId }) => {
      handleMarkRead(senderId, receiverId);
    });

    socket.on("disconnect", () => {
      handleDisconnect(socket);
    });
  });

  return io;
};

export { io };
export default setupSocket;
