import Message from "../model/message-model.js";
import Conversation from "../model/conversation-model.js";
import User from "../model/user-model.js";
import { io, onlineUsers } from "../socket/socket.js";
import { getRoomName } from "../socket/roomUtils.js";

const findOrCreateConversation = async (senderId, receiverId) => {
  let conv = await Conversation.findOne({
    participants: { $all: [senderId, receiverId] },
  });
  if (!conv) {
    conv = await Conversation.create({
      participants: [senderId, receiverId],
      unreadCount: { [receiverId.toString()]: 0 },
    });
  }
  return conv;
};

// Send message (text or media)
export const sendMessage = async (req, res) => {
  const { senderId, receiverId, text, type, replyTo } = req.body;
  try {
    if (!senderId || !receiverId) {
      return res.status(400).json({ error: "senderId and receiverId required" });
    }

    // Block check
    const sender = await User.findById(senderId).select("blockedUsers");
    if (sender?.blockedUsers?.some((id) => id.toString() === receiverId)) {
      return res.status(403).json({ error: "You have blocked this user" });
    }
    const receiver = await User.findById(receiverId).select("blockedUsers");
    if (receiver?.blockedUsers?.some((id) => id.toString() === senderId)) {
      return res.status(403).json({ error: "You have been blocked by this user" });
    }

    const content = [];
    if (req.files && req.files.length > 0) {
      req.files.forEach((file) => {
        content.push({
          type: file.mimetype.startsWith("video")
            ? "video"
            : file.mimetype.startsWith("audio")
            ? "audio"
            : "image",
          url: file.path,
          publicId: file.filename,
        });
      });
    }

    const msgType =
      content.length > 0
        ? content[0].type
        : "text";

    const newMessage = await Message.create({
      senderId,
      receiverId,
      text: text || "",
      type: type || msgType,
      content,
      replyTo: replyTo || null,
    });

    await newMessage.populate({ path: "replyTo", select: "text type senderId" });

    const conv = await findOrCreateConversation(senderId, receiverId);
    const currentUnread = conv.unreadCount?.get(receiverId.toString()) || 0;
    conv.lastMessage = newMessage._id;
    conv.unreadCount = {
      ...(conv.unreadCount ? Object.fromEntries(conv.unreadCount) : {}),
      [receiverId.toString()]: currentUnread + 1,
    };
    await conv.save();

    res.status(200).json({ message: newMessage });
  } catch (error) {
    console.error("sendMessage error:", error);
    res.status(500).json({ error: "Failed to send message" });
  }
};

// Get conversation with pagination
// GET /api/getConvo/:id?receiver=X&page=1&limit=30
export const getConvo = async (req, res) => {
  const { id } = req.params;
  const { receiver, page = 1, limit = 30 } = req.query;
  try {
    if (!id || !receiver) {
      return res.status(400).json({ error: "Both user IDs required" });
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const total = await Message.countDocuments({
      $or: [
        { senderId: id, receiverId: receiver },
        { senderId: receiver, receiverId: id },
      ],
    });

    const messages = await Message.find({
      $or: [
        { senderId: id, receiverId: receiver },
        { senderId: receiver, receiverId: id },
      ],
    })
      .populate({ path: "replyTo", select: "text type senderId" })
      .sort({ createdAt: -1 }) // newest first for skip, reverse on client
      .skip(skip)
      .limit(parseInt(limit));

    // Return in ascending order for display
    const ordered = messages.reverse();

    // Mark as read
    await Message.updateMany(
      { receiverId: id, senderId: receiver, status: { $ne: "read" } },
      { status: "read" }
    );
    await Conversation.findOneAndUpdate(
      { participants: { $all: [id, receiver] } },
      { [`unreadCount.${id}`]: 0 }
    );

    const roomName = getRoomName(id, receiver);
    if (io) {
      io.to(roomName).emit("messages_read", { readBy: id });
      const senderSocketId = onlineUsers.get(receiver);
      if (senderSocketId) {
        io.to(senderSocketId).emit("messages_read", { readBy: id });
      }
    }

    res.status(200).json({
      messages: ordered,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        hasMore: skip + ordered.length < total,
      },
    });
  } catch (error) {
    console.error("getConvo error:", error);
    res.status(500).json({ error: "Failed to fetch conversation" });
  }
};

// Search messages between two users
// GET /api/messages/search?userId=X&otherUserId=Y&q=hello
export const searchMessages = async (req, res) => {
  const { userId, otherUserId, q } = req.query;
  try {
    if (!userId || !otherUserId || !q?.trim()) {
      return res.status(400).json({ error: "userId, otherUserId, and q required" });
    }

    const messages = await Message.find({
      $or: [
        { senderId: userId, receiverId: otherUserId },
        { senderId: otherUserId, receiverId: userId },
      ],
      text: { $regex: q.trim(), $options: "i" },
      isDeleted: false,
    })
      .populate({ path: "replyTo", select: "text type senderId" })
      .sort({ createdAt: -1 })
      .limit(50);

    res.status(200).json({ messages });
  } catch (error) {
    console.error("searchMessages error:", error);
    res.status(500).json({ error: "Failed to search messages" });
  }
};

// Add / toggle reaction on a message
// POST /api/messages/:id/react  { userId, emoji }
export const reactToMessage = async (req, res) => {
  const { id } = req.params;
  const { userId, emoji } = req.body;
  try {
    if (!id || !userId || !emoji) {
      return res.status(400).json({ error: "messageId, userId, emoji required" });
    }

    const message = await Message.findById(id);
    if (!message) return res.status(404).json({ error: "Message not found" });

    const existingIdx = message.reactions.findIndex(
      (r) => r.userId.toString() === userId
    );

    if (existingIdx !== -1) {
      if (message.reactions[existingIdx].emoji === emoji) {
        // Same emoji → remove (toggle off)
        message.reactions.splice(existingIdx, 1);
      } else {
        // Different emoji → replace
        message.reactions[existingIdx].emoji = emoji;
      }
    } else {
      message.reactions.push({ userId, emoji });
    }

    await message.save();

    // Broadcast reaction update via socket
    if (io) {
      const roomName = getRoomName(
        message.senderId.toString(),
        message.receiverId.toString()
      );
      io.to(roomName).emit("reaction_update", {
        messageId: message._id,
        reactions: message.reactions,
      });
      // Fallback direct emit
      const senderSocket = onlineUsers.get(message.senderId.toString());
      const receiverSocket = onlineUsers.get(message.receiverId.toString());
      const room = io.sockets.adapter.rooms.get(roomName);
      if (senderSocket && room && !room.has(senderSocket)) {
        io.to(senderSocket).emit("reaction_update", { messageId: message._id, reactions: message.reactions });
      }
      if (receiverSocket && room && !room.has(receiverSocket)) {
        io.to(receiverSocket).emit("reaction_update", { messageId: message._id, reactions: message.reactions });
      }
    }

    res.status(200).json({ reactions: message.reactions });
  } catch (error) {
    console.error("reactToMessage error:", error);
    res.status(500).json({ error: "Failed to react to message" });
  }
};

// Mark message as delivered or read
export const markMessageAsDelivered = async (req, res) => {
  const { messageId, status } = req.body;
  try {
    if (!messageId || !status) {
      return res.status(400).json({ error: "messageId and status required" });
    }
    const updated = await Message.findByIdAndUpdate(messageId, { status }, { new: true });
    if (!updated) return res.status(404).json({ error: "Message not found" });

    if (io) {
      const roomName = getRoomName(
        updated.senderId.toString(),
        updated.receiverId.toString()
      );
      io.to(roomName).emit("message_status_update", {
        messageId: updated._id,
        status: updated.status,
      });
      const senderSocketId = onlineUsers.get(updated.senderId.toString());
      if (senderSocketId) {
        io.to(senderSocketId).emit("message_status_update", {
          messageId: updated._id,
          status: updated.status,
        });
      }
    }

    res.status(200).json(updated);
  } catch (error) {
    console.error("markMessageAsDelivered error:", error);
    res.status(500).json({ error: "Failed to update status" });
  }
};

// Soft delete
export const deleteMessage = async (req, res) => {
  const { id } = req.params;
  const { deleteForEveryone, userId } = req.body;
  try {
    if (!id) return res.status(400).json({ error: "Message ID required" });

    const update = deleteForEveryone
      ? { isDeleted: true }
      : { $addToSet: { deletedFor: userId } };

    const message = await Message.findByIdAndUpdate(id, update, { new: true });
    if (!message) return res.status(404).json({ error: "Message not found" });

    res.status(200).json({ success: true, message });
  } catch (error) {
    console.error("deleteMessage error:", error);
    res.status(500).json({ error: "Failed to delete message" });
  }
};

// Block a user
// POST /api/users/block  { blockerId, blockedId }
export const blockUser = async (req, res) => {
  const { blockerId, blockedId } = req.body;
  try {
    if (!blockerId || !blockedId) {
      return res.status(400).json({ error: "blockerId and blockedId required" });
    }
    await User.findByIdAndUpdate(blockerId, {
      $addToSet: { blockedUsers: blockedId },
    });
    res.status(200).json({ success: true, message: "User blocked" });
  } catch (error) {
    console.error("blockUser error:", error);
    res.status(500).json({ error: "Failed to block user" });
  }
};

// Unblock a user
// POST /api/users/unblock  { blockerId, blockedId }
export const unblockUser = async (req, res) => {
  const { blockerId, blockedId } = req.body;
  try {
    if (!blockerId || !blockedId) {
      return res.status(400).json({ error: "blockerId and blockedId required" });
    }
    await User.findByIdAndUpdate(blockerId, {
      $pull: { blockedUsers: blockedId },
    });
    res.status(200).json({ success: true, message: "User unblocked" });
  } catch (error) {
    console.error("unblockUser error:", error);
    res.status(500).json({ error: "Failed to unblock user" });
  }
};

export default {
  sendMessage,
  getConvo,
  searchMessages,
  reactToMessage,
  markMessageAsDelivered,
  deleteMessage,
  blockUser,
  unblockUser,
};
