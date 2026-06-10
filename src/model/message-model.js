import mongoose from "mongoose";
const { Schema, model } = mongoose;

const ContentSchema = new Schema({
  type: { type: String, enum: ["image", "video", "audio"], required: true },
  url: { type: String, required: true },
  publicId: { type: String },
  duration: { type: Number }, // for audio messages
});

const ReactionSchema = new Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  emoji: { type: String, required: true },
});

const MessageSchema = new Schema(
  {
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    receiverId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    text: { type: String, default: "" },
    type: { type: String, enum: ["text", "image", "video", "audio"], default: "text" },
    content: [ContentSchema],
    isDeleted: { type: Boolean, default: false },
    deletedFor: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    status: { type: String, enum: ["sent", "delivered", "read"], default: "sent" },
    replyTo: { type: mongoose.Schema.Types.ObjectId, ref: "Message", default: null },
    reactions: [ReactionSchema],
  },
  { timestamps: true }
);

MessageSchema.virtual("messageId").get(function () {
  return this._id.toString();
});
MessageSchema.set("toJSON", { virtuals: true });

const Message = model("Message", MessageSchema);
export default Message;
