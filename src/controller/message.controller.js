import Message from "../model/message-model.js";
import Conversation from "../model/conversation-model.js";
import { io, onlineUsers } from "../socket/socket.js";
import { getRoomName } from "../socket/roomUtils.js";

// Helper: find or create conversation between two users
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

    const content = [];
    if (req.files && req.files.length > 0) {
      req.files.forEach((file) => {
        content.push({
          type: file.mimetype.startsWith("video") ? "video" : "image",
          url: file.path,
          publicId: file.filename,
        });
      });
    }

    const msgType =
      content.length > 0
        ? content[0].type === "video"
          ? "video"
          : "image"
        : "text";

    const newMessage = await Message.create({
      senderId,
      receiverId,
      text: text || "",
      type: type || msgType,
      content,
      replyTo: replyTo || null,
    });

    await newMessage.populate({
      path: "replyTo",
      select: "text type senderId",
    });

    // Update conversation
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

// Get conversation between two users
export const getConvo = async (req, res) => {
  const { id } = req.params;      // current user (viewer)
  const { receiver } = req.query; // the other person
  try {
    if (!id || !receiver) {
      return res.status(400).json({ error: "Both user IDs required" });
    }

    const messages = await Message.find({
      $or: [
        { senderId: id, receiverId: receiver },
        { senderId: receiver, receiverId: id },
      ],
    })
      .populate({ path: "replyTo", select: "text type senderId" })
      .sort({ createdAt: 1 });

    // Mark messages as read in DB
    await Message.updateMany(
      { receiverId: id, senderId: receiver, status: { $ne: "read" } },
      { status: "read" }
    );

    // Reset unread count
    await Conversation.findOneAndUpdate(
      { participants: { $all: [id, receiver] } },
      { [`unreadCount.${id}`]: 0 }
    );

    // Notify the sender that messages were read (id = viewer/reader, receiver = sender)
    const roomName = getRoomName(id, receiver);
    if (io) {
      io.to(roomName).emit("messages_read", { readBy: id });
      const senderSocketId = onlineUsers.get(receiver);
      if (senderSocketId) {
        io.to(senderSocketId).emit("messages_read", { readBy: id });
      }
    }

    res.status(200).json({ messages });
  } catch (error) {
    console.error("getConvo error:", error);
    res.status(500).json({ error: "Failed to fetch conversation" });
  }
};

// Mark message as delivered or read
export const markMessageAsDelivered = async (req, res) => {
  const { messageId, status } = req.body;
  try {
    if (!messageId || !status) {
      return res.status(400).json({ error: "messageId and status required" });
    }
    const updated = await Message.findByIdAndUpdate(
      messageId,
      { status },
      { new: true }
    );
    if (!updated) return res.status(404).json({ error: "Message not found" });

    // Emit status update to room
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

export default { sendMessage, getConvo, markMessageAsDelivered, deleteMessage };
