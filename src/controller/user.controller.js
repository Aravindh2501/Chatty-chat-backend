import bcrypt from "bcryptjs";
import User from "../model/user-model.js";
import Conversation from "../model/conversation-model.js";
import Message from "../model/message-model.js";
import { generateToken } from "../utils/token-utils.js";

export const register = async (req, res) => {
  const { username, email, password } = req.body;
  try {
    if (!username || !email || !password) {
      return res.status(400).json({ error: "All fields are required" });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }
    if (await User.findOne({ username })) {
      return res.status(400).json({ error: "Username already taken" });
    }
    if (await User.findOne({ email })) {
      return res.status(400).json({ error: "Email already registered" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({ username, email, password: hashedPassword });
    const token = generateToken(user);

    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.status(201).json({
      user: { _id: user._id, username: user.username, email: user.email, avatar: user.avatar },
      token,
      msg: "Successfully registered",
    });
  } catch (error) {
    console.error("Register error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const login = async (req, res) => {
  const { email, password } = req.body;
  try {
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ error: "User not found" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ error: "Invalid credentials" });

    await User.findByIdAndUpdate(user._id, { status: "online" });
    const token = generateToken(user);

    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.status(200).json({
      user: { _id: user._id, username: user.username, email: user.email, avatar: user.avatar },
      token,
      msg: "Successfully logged in",
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const logout = async (req, res) => {
  try {
    if (req.user?.id) {
      await User.findByIdAndUpdate(req.user.id, {
        status: "offline",
        lastSeen: new Date(),
      });
    }
    res.clearCookie("token");
    res.status(200).json({ msg: "Logged out successfully" });
  } catch (error) {
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const checkAuth = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password");
    if (!user) return res.status(404).json({ error: "User not found" });
    res.status(200).json({ user });
  } catch (error) {
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const getAllUsers = async (req, res) => {
  try {
    const { userId, search } = req.query;
    if (!userId) return res.status(400).json({ msg: "User ID is required" });

    const query = { _id: { $ne: userId } };
    if (search?.trim()) {
      query.username = { $regex: search.trim(), $options: "i" };
    }

    const users = await User.find(query).select("-password").limit(20);
    res.status(200).json({ data: users });
  } catch (error) {
    console.error("getAllUsers error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const getUsersWithConversation = async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ msg: "User ID required" });

    const conversations = await Conversation.find({ participants: userId })
      .populate("lastMessage")
      .populate("participants", "-password")
      .sort({ updatedAt: -1 });

    const result = conversations.map((conv) => {
      const otherUser = conv.participants.find(
        (p) => p._id.toString() !== userId
      );
      const unread = conv.unreadCount?.get(userId) || 0;
      return {
        ...otherUser.toJSON(),
        lastMessage: conv.lastMessage,
        unreadCount: unread,
        conversationId: conv._id,
      };
    });

    res.status(200).json({ data: result });
  } catch (error) {
    console.error("getUsersWithConversation error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const getUserProfile = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findById(id).select("-password");
    if (!user) return res.status(404).json({ error: "User not found" });
    res.status(200).json({ user });
  } catch (error) {
    console.error("getUserProfile error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const getSharedMedia = async (req, res) => {
  try {
    const { userId, otherUserId } = req.query;
    if (!userId || !otherUserId) {
      return res.status(400).json({ error: "Both user IDs required" });
    }

    const messages = await Message.find({
      $or: [
        { senderId: userId, receiverId: otherUserId },
        { senderId: otherUserId, receiverId: userId },
      ],
      type: { $in: ["image", "video"] },
      isDeleted: false,
    })
      .select("content type createdAt senderId")
      .sort({ createdAt: -1 });

    const media = messages.flatMap((msg) =>
      msg.content.map((c) => ({
        url: c.url,
        type: c.type,
        publicId: c.publicId,
        createdAt: msg.createdAt,
        senderId: msg.senderId,
      }))
    );

    res.status(200).json({ media, total: media.length });
  } catch (error) {
    console.error("getSharedMedia error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const updateProfile = async (req, res) => {
  const { id } = req.params;
  const { avatar, username, bio } = req.body;
  try {
    const updateData = {};
    if (username) updateData.username = username;
    if (avatar) updateData.avatar = avatar;
    if (bio !== undefined) updateData.bio = bio;

    if (req.file) {
      updateData.avatar = req.file.path;
    }

    const user = await User.findByIdAndUpdate(id, updateData, {
      new: true,
    }).select("-password");

    if (!user) return res.status(404).json({ message: "User not found" });

    res.status(200).json({ message: "Profile updated successfully", user });
  } catch (error) {
    console.error("updateProfile error:", error);
    res.status(500).json({ message: "Error updating profile" });
  }
};

export default {
  login,
  register,
  logout,
  checkAuth,
  getAllUsers,
  getUsersWithConversation,
  getUserProfile,
  getSharedMedia,
  updateProfile,
};
