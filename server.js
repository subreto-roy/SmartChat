const Groq = require("groq-sdk");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const { v4: uuidv4 } = require("uuid");
require("dotenv").config();

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static("public"));

const db = new Database("chat.db");
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT,
    lang TEXT DEFAULT 'en'
  );
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_user TEXT,
    to_user TEXT,
    original TEXT,
    translated TEXT,
    time TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

const onlineUsers = {};

const LANGUAGES = {
  en: "English",
  bn: "Bengali",
  de: "German",
  fr: "French",
  ar: "Arabic",
  hi: "Hindi",
  "zh-cn": "Chinese",
  es: "Spanish",
};

async function translateText(text, targetLang) {
  const langName = LANGUAGES[targetLang] || "English";
  const chat = await groq.chat.completions.create({
    messages: [
      {
        role: "system",
        content: `You are a translator. Translate the user's message to ${langName}. If the message is already in ${langName}, return the original text exactly as is, without any explanation or comment. Reply with ONLY the translated text, nothing else.`,
      },
      { role: "user", content: text },
    ],
    model: "llama-3.3-70b-versatile",
  });
  return chat.choices[0].message.content.trim();
}

function broadcastUserList() {
  const allRegistered = db.prepare("SELECT username FROM users").all();
  const userList = allRegistered.map(u => {
    const onlineEntry = Object.entries(onlineUsers).find(([id, o]) => o.username === u.username);
    return {
      id: onlineEntry ? onlineEntry[0] : null,
      username: u.username,
      online: !!onlineEntry,
    };
  });
  io.emit("user list", userList);
}

function getHistory(user1, user2) {
  return db.prepare(`
    SELECT * FROM messages
    WHERE (from_user = ? AND to_user = ?) OR (from_user = ? AND to_user = ?)
    ORDER BY id ASC
  `).all(user1, user2, user2, user1);
}

function getLastMessages(username) {
  return db.prepare(`
    SELECT m.* FROM messages m
    INNER JOIN (
      SELECT
        CASE WHEN from_user = ? THEN to_user ELSE from_user END as partner,
        MAX(id) as max_id
      FROM messages
      WHERE from_user = ? OR to_user = ?
      GROUP BY partner
    ) latest ON m.id = latest.max_id
    ORDER BY m.id DESC
  `).all(username, username, username);
}

// REST API
app.post("/register", async (req, res) => {
  const { username, password, lang } = req.body;
  if (!username || !password) return res.json({ success: false, message: "Username and password required" });
  const existing = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
  if (existing) return res.json({ success: false, message: "Username already taken" });
  const hashed = bcrypt.hashSync(password, 10);
  db.prepare("INSERT INTO users (username, password, lang) VALUES (?, ?, ?)").run(username, hashed, lang || "en");
  res.json({ success: true });
});

app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.json({ success: false, message: "Username and password required" });
  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
  if (!user) return res.json({ success: false, message: "User not found" });
  const valid = bcrypt.compareSync(password, user.password);
  if (!valid) return res.json({ success: false, message: "Wrong password" });
  res.json({ success: true, username: user.username, lang: user.lang });
});

io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  socket.on("user joined", ({ username, lang }) => {
    onlineUsers[socket.id] = { username, lang };
    broadcastUserList();
  });

  socket.on("set language", (lang) => {
    if (onlineUsers[socket.id]) onlineUsers[socket.id].lang = lang;
  });

  socket.on("load history", ({ withUsername }) => {
    const me = onlineUsers[socket.id];
    if (!me) return;
    const history = getHistory(me.username, withUsername);
    socket.emit("chat history", { withUsername, messages: history });
  });

  socket.on("load last messages", () => {
    const me = onlineUsers[socket.id];
    if (!me) return;
    const lastMsgs = getLastMessages(me.username);
    socket.emit("last messages", lastMsgs);
  });

  socket.on("typing", ({ toId }) => {
    const from = onlineUsers[socket.id];
    if (from) io.to(toId).emit("typing", { fromId: socket.id, username: from.username });
  });

  socket.on("stop typing", ({ toId }) => {
    io.to(toId).emit("stop typing", { fromId: socket.id });
  });

  socket.on("private message", async ({ toId, text }) => {
    const sender = onlineUsers[socket.id];
    const receiver = onlineUsers[toId];
    if (!sender) return;

    const timestamp = new Date().toLocaleTimeString("en-GB", {
      hour: "2-digit", minute: "2-digit", hour12: false,
    });

    let receiverText = text;
    if (receiver) {
      try {
        receiverText = await translateText(text, receiver.lang);
      } catch (e) {
        console.log("Translation error:", e.message);
      }
    }

    db.prepare(`
      INSERT INTO messages (from_user, to_user, original, translated, time)
      VALUES (?, ?, ?, ?, ?)
    `).run(sender.username, receiver ? receiver.username : toId, text, receiverText, timestamp);

    if (receiver) {
      io.to(toId).emit("private message", {
        fromId: socket.id,
        toId,
        username: sender.username,
        text: receiverText,
        original: text,
        time: timestamp,
      });
    }

    // Sender নিজে যা লিখেছে সেটাই দেখবে
    socket.emit("private message", {
      fromId: socket.id,
      toId,
      username: sender.username,
      text: text,
      original: text,
      time: timestamp,
    });
  });

  // ── CALLING ──────────────────────────────────────────

  socket.on("call user", ({ toId }) => {
    const caller = onlineUsers[socket.id];
    if (!caller) return;
    const callId = uuidv4();
    io.to(toId).emit("incoming call", {
      callId,
      fromId: socket.id,
      username: caller.username,
    });
    socket.emit("call initiated", { callId, toId });
  });

  socket.on("call accepted", ({ callId, toId }) => {
    io.to(toId).emit("call accepted", { callId, fromId: socket.id });
  });

  socket.on("call rejected", ({ toId }) => {
    io.to(toId).emit("call rejected");
  });

  socket.on("webrtc offer", ({ toId, offer }) => {
    io.to(toId).emit("webrtc offer", { fromId: socket.id, offer });
  });

  socket.on("webrtc answer", ({ toId, answer }) => {
    io.to(toId).emit("webrtc answer", { fromId: socket.id, answer });
  });

  socket.on("webrtc ice candidate", ({ toId, candidate }) => {
    io.to(toId).emit("webrtc ice candidate", { fromId: socket.id, candidate });
  });

  socket.on("end call", ({ toId }) => {
    io.to(toId).emit("call ended");
  });

  // ─────────────────────────────────────────────────────

  socket.on("disconnect", () => {
    const user = onlineUsers[socket.id];
    if (user) {
      delete onlineUsers[socket.id];
      broadcastUserList();
    }
  });
});

server.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});