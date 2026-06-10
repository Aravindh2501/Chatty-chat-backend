import { getRoomName } from "./roomUtils.js";
import { io, onlineUsers } from "./socket.js";
import User from "../model/user-model.js";

export const handleRegisterUser = async (socket, userId) => {
  if (!userId) {
    console.warn("[socket] handleRegisterUser called with no userId");
    return;
  }

  const wasAlreadyOnline = onlineUsers.has(userId);
  onlineUsers.set(userId, socket.id);
  console.log(`[socket] register_user | userId: ${userId} | socketId: ${socket.id} | wasOnline: ${wasAlreadyOnline}`);

  await User.findByIdAndUpdate(userId, { status: "online" }).catch((e) =>
    console.error("[socket] register_user DB error:", e)
  );

  io.emit("online_users", Array.from(onlineUsers.keys()));
  console.log("[socket] broadcasted online_users →", Array.from(onlineUsers.keys()));

  if (!wasAlreadyOnline) {
    io.emit("user_online", { userId });
    console.log("[socket] broadcasted user_online →", userId);
  }
};

export const handleJoinRoom = (socket, senderId, receiverId) => {
  if (!senderId || !receiverId) {
    console.warn("[socket] handleJoinRoom missing ids", { senderId, receiverId });
    return;
  }
  const roomName = getRoomName(senderId, receiverId);
  socket.join(roomName);
  console.log(`[socket] join_room | ${senderId} joined ${roomName}`);
};

export const handleSendMessage = (data) => {
  const { senderId, receiverId } = data;
  if (!senderId || !receiverId) {
    console.warn("[socket] handleSendMessage missing ids");
    return;
  }

  const roomName = getRoomName(senderId, receiverId);
  const receiverOnline = onlineUsers.has(receiverId);
  data.status = receiverOnline ? "delivered" : "sent";

  console.log(`[socket] send_message | msgId: ${data._id} | room: ${roomName} | receiverOnline: ${receiverOnline} | status: ${data.status}`);

  io.to(roomName).emit("receive_message", data);

  const receiverSocketId = onlineUsers.get(receiverId);
  if (receiverSocketId) {
    const room = io.sockets.adapter.rooms.get(roomName);
    const receiverInRoom = room && room.has(receiverSocketId);
    console.log(`[socket] receiver socket: ${receiverSocketId} | inRoom: ${receiverInRoom}`);
    if (!receiverInRoom) {
      console.log("[socket] receiver not in room → direct emit to socket");
      io.to(receiverSocketId).emit("receive_message", data);
    }
  } else {
    console.log("[socket] receiver is offline, no direct emit");
  }
};

export const handleStartTyping = (socket, senderId, receiverId) => {
  const roomName = getRoomName(senderId, receiverId);
  console.log(`[socket] start_typing | ${senderId} → ${receiverId} | room: ${roomName}`);
  socket.to(roomName).emit("receiver_typing", { senderId, isTyping: true });

  const receiverSocketId = onlineUsers.get(receiverId);
  if (receiverSocketId) {
    const room = io.sockets.adapter.rooms.get(roomName);
    const receiverInRoom = room && room.has(receiverSocketId);
    if (!receiverInRoom) {
      io.to(receiverSocketId).emit("receiver_typing", { senderId, isTyping: true });
    }
  }
};

export const handleStopTyping = (socket, senderId, receiverId) => {
  const roomName = getRoomName(senderId, receiverId);
  socket.to(roomName).emit("receiver_not_typing", { senderId, isTyping: false });

  const receiverSocketId = onlineUsers.get(receiverId);
  if (receiverSocketId) {
    const room = io.sockets.adapter.rooms.get(roomName);
    const receiverInRoom = room && room.has(receiverSocketId);
    if (!receiverInRoom) {
      io.to(receiverSocketId).emit("receiver_not_typing", { senderId, isTyping: false });
    }
  }
};

export const handleDeleteMessage = (messageId, senderId, receiverId, isDeleted) => {
  if (!messageId || !senderId || !receiverId) {
    console.warn("[socket] handleDeleteMessage missing params");
    return;
  }
  const roomName = getRoomName(senderId, receiverId);
  console.log(`[socket] delete_message | msgId: ${messageId} | room: ${roomName}`);

  io.to(roomName).emit("message_deleted", { messageId, isDeleted });

  const senderSocketId = onlineUsers.get(senderId);
  const receiverSocketId = onlineUsers.get(receiverId);
  const room = io.sockets.adapter.rooms.get(roomName);

  if (senderSocketId && room && !room.has(senderSocketId)) {
    io.to(senderSocketId).emit("message_deleted", { messageId, isDeleted });
  }
  if (receiverSocketId && room && !room.has(receiverSocketId)) {
    io.to(receiverSocketId).emit("message_deleted", { messageId, isDeleted });
  }
};

export const handleMarkRead = async (senderId, receiverId) => {
  if (!senderId || !receiverId) {
    console.warn("[socket] handleMarkRead missing ids");
    return;
  }

  const roomName = getRoomName(senderId, receiverId);
  console.log(`[socket] mark_read | senderId: ${senderId} | receiverId: ${receiverId} | room: ${roomName}`);

  io.to(roomName).emit("messages_read", { readBy: receiverId });

  const senderSocketId = onlineUsers.get(senderId);
  if (senderSocketId) {
    const room = io.sockets.adapter.rooms.get(roomName);
    const senderInRoom = room && room.has(senderSocketId);
    console.log(`[socket] sender socket: ${senderSocketId} | inRoom: ${senderInRoom}`);
    if (!senderInRoom) {
      console.log("[socket] sender not in room → direct emit messages_read");
      io.to(senderSocketId).emit("messages_read", { readBy: receiverId });
    }
  }

  // Persist to DB
  try {
    const { default: Message } = await import("../model/message-model.js");
    const { default: Conversation } = await import("../model/conversation-model.js");

    const updated = await Message.updateMany(
      { senderId, receiverId, status: { $ne: "read" } },
      { status: "read" }
    );
    console.log(`[socket] mark_read DB → updated ${updated.modifiedCount} messages`);

    await Conversation.findOneAndUpdate(
      { participants: { $all: [senderId, receiverId] } },
      { [`unreadCount.${receiverId}`]: 0 }
    );
  } catch (err) {
    console.error("[socket] handleMarkRead DB error:", err);
  }
};

export const handleDisconnect = async (socket) => {
  let disconnectedUserId = null;

  onlineUsers.forEach((socketId, userId) => {
    if (socketId === socket.id) {
      disconnectedUserId = userId;
      onlineUsers.delete(userId);
    }
  });

  console.log(`[socket] disconnect | socketId: ${socket.id} | userId: ${disconnectedUserId}`);

  if (disconnectedUserId) {
    const lastSeen = new Date();
    await User.findByIdAndUpdate(disconnectedUserId, { status: "offline", lastSeen }).catch((e) =>
      console.error("[socket] disconnect DB error:", e)
    );

    io.emit("online_users", Array.from(onlineUsers.keys()));
    io.emit("user_offline", { userId: disconnectedUserId, lastSeen });
    console.log(`[socket] broadcasted user_offline → ${disconnectedUserId}`);
  }
};
