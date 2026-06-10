import express from "express";
import userController from "../controller/user.controller.js";
import messageController from "../controller/message.controller.js";
import { protect } from "../middleware/auth.middleware.js";
import upload from "../utils/upload.js";

const {
  login, register, logout, checkAuth,
  getAllUsers, getUsersWithConversation,
  getUserProfile, getSharedMedia, updateProfile,getBlockedUsers,   
} = userController;

const {
  sendMessage, getConvo, searchMessages,
  reactToMessage, markMessageAsDelivered,
  deleteMessage, blockUser, unblockUser,
} = messageController;

const router = express.Router();

// Auth
router.post("/register", register);
router.post("/login", login);
router.post("/logout", protect, logout);
router.get("/check-auth", protect, checkAuth);

// Users
router.get("/users", protect, getAllUsers);
router.get("/getConvoUser", protect, getUsersWithConversation);
router.get("/user/:id", protect, getUserProfile);
router.get("/shared-media", protect, getSharedMedia);
router.put("/profile-update/:id", protect, upload.single("avatar"), updateProfile);
router.get("/users/blocked/:userId", protect, getBlockedUsers); // ← add this

// Block / Unblock
router.post("/users/block", protect, blockUser);
router.post("/users/unblock", protect, unblockUser);

// Messages
router.post("/sendMsg", protect, upload.array("files", 5), sendMessage);
router.get("/getConvo/:id", protect, getConvo);
router.get("/messages/search", protect, searchMessages);
router.post("/messages/:id/react", protect, reactToMessage);
router.post("/messages/update-status", protect, markMessageAsDelivered);
router.put("/messages/:id/delete-message", protect, deleteMessage);

export default router;
