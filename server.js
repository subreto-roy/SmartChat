const Groq = require("groq-sdk");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
require("dotenv").config();

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

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
        content: `You are a translator. Translate the user's message to ${langName}. Reply with ONLY the translated text, nothing else.`,
      },
      { role: "user", content: text },
    ],
    model: "llama-3.3-70b-versatile",
  });
  return chat.choices[0].message.content.trim();
}

io.on("connection", (socket) => {
  console.log("A user connected");
  socket.preferredLang = "en";
  socket.username = "User";

  socket.on("user joined", (username) => {
    socket.username = username;
    socket.broadcast.emit("system message", `${username} joined the chat 👋`);
  });

  socket.on("set language", (lang) => {
    socket.preferredLang = lang;
  });

  socket.on("typing", (username) => {
    socket.broadcast.emit("typing", username);
  });

  socket.on("stop typing", () => {
    socket.broadcast.emit("stop typing");
  });

  socket.on("chat message", async (msg) => {
      const timestamp = new Date().toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
    const sockets = await io.fetchSockets();
    for (const s of sockets) {
      const targetLang = s.preferredLang || "en";
      try {
        const translatedText = await translateText(msg.text, targetLang);
        s.emit("chat message", {
          user: msg.user,
          text: translatedText,
          original: msg.text,
          time: timestamp,
        });
      } catch (e) {
        s.emit("chat message", {
          user: msg.user,
          text: msg.text,
          original: msg.text,
          time: timestamp,
        });
      }
    }
  });

  socket.on("disconnect", () => {
    if (socket.username) {
      socket.broadcast.emit("system message", `${socket.username} left the chat 👋`);
    }
  });
});

server.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});