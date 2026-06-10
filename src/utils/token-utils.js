import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "changeme_secret_key";

export const generateToken = (user) => {
  return jwt.sign(
    { id: user._id, username: user.username, email: user.email },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
};

export const verifyToken = (token) => {
  return jwt.verify(token, JWT_SECRET);
};
