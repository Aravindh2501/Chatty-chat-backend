import express from "express";
import userController from "../controller/user.controller.js";
import messageController from "../controller/message.controller.js";
import { protect } from "../middleware/auth.middleware.js";
import upload from "../utils/upload.js";

const {
  login,
  register,
  logout,
  checkAuth,
  getAllUsers,
  getUsersWithConversation,
  getUserProfile,
  getSharedMedia,
  updateProfile,
} = userController;

const { sendMessage, getConvo, markMessageAsDelivered, deleteMessage } =
  messageController;

const router = express.Router();

// Auth routes
router.post("/register", register);
router.post("/login", login);
router.post("/logout", protect, logout);
router.get("/check-auth", protect, checkAuth);

// User routes
router.get("/users", protect, getAllUsers);
router.get("/getConvoUser", protect, getUsersWithConversation);
router.get("/user/:id", protect, getUserProfile);
router.get("/shared-media", protect, getSharedMedia);
router.put("/profile-update/:id", protect, upload.single("avatar"), updateProfile);

// Message routes
router.post("/sendMsg", protect, upload.array("files", 5), sendMessage);
router.get("/getConvo/:id", protect, getConvo);
router.post("/messages/update-status", protect, markMessageAsDelivered);
router.put("/messages/:id/delete-message", protect, deleteMessage);

export default router;
