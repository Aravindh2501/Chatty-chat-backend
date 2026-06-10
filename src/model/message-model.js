import mongoose from "mongoose";
const { Schema, model } = mongoose;

const ContentSchema = new Schema({
  type: { type: String, enum: ["image", "video"], required: true },
  url: { type: String, required: true },
  publicId: { type: String },
});

const MessageSchema = new Schema(
  {
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    receiverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    text: { type: String, default: "" },
    type: { type: String, enum: ["text", "image", "video"], default: "text" },
    content: [ContentSchema],
    isDeleted: { type: Boolean, default: false },
    deletedFor: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    status: {
      type: String,
      enum: ["sent", "delivered", "read"],
      default: "sent",
    },
    replyTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
      default: null,
    },
  },
  { timestamps: true }
);

MessageSchema.virtual("messageId").get(function () {
  return this._id.toString();
});

MessageSchema.set("toJSON", { virtuals: true });

const Message = model("Message", MessageSchema);
export default Message;
