const socket = io();

let myName = "";
let myLang = "en";
let myId = null;
let activeChatId = null;
let allUsers = [];
let conversations = {};
let unreadCounts = {};
let typingTimeout;

const langNames = {
  en: "English", bn: "বাংলা", de: "Deutsch",
  fr: "French", ar: "Arabic", hi: "Hindi",
  "zh-cn": "Chinese", es: "Spanish"
};

// Check login
const saved = localStorage.getItem("chatUser");
if (!saved) {
  window.location.href = "/login.html";
} else {
  const { username, lang } = JSON.parse(saved);
  myName = username;
  myLang = lang;
}

socket.on("connect", () => {
  myId = socket.id;
  socket.emit("user joined", { username: myName, lang: myLang });
  socket.emit("set language", myLang);
  document.getElementById("myNameDisplay").textContent = `${myName} · ${langNames[myLang]}`;
});

function logout() {
  localStorage.removeItem("chatUser");
  window.location.href = "/login.html";
}

// User list
socket.on("user list", (users) => {
  allUsers = users.filter(u => u.username !== myName);
  renderContacts(allUsers);
});

// Search
document.getElementById("searchInput").addEventListener("input", (e) => {
  const q = e.target.value.toLowerCase();
  renderContacts(allUsers.filter(u => u.username.toLowerCase().includes(q)));
});

function renderContacts(users) {
  const list = document.getElementById("contactList");
  const others = users.filter(u => u.username !== myName);
  if (others.length === 0) {
    list.innerHTML = '<div class="no-contacts">No users found...</div>';
    return;
  }
  list.innerHTML = others.map(u => {
    const uid = u.id || u.username;
    const convos = conversations[uid] || [];
    const last = convos[convos.length - 1];
    const preview = last ? last.text : "Click to chat";
    const unread = unreadCounts[uid] || 0;
    const isActive = activeChatId === uid;
    return `
      <div class="contact ${isActive ? "active" : ""}" onclick="openChat('${uid}', '${u.username}', ${u.online})">
        <div class="avatar" style="position:relative;">
          ${u.username[0].toUpperCase()}
          <span style="
            position:absolute; bottom:1px; right:1px;
            width:10px; height:10px; border-radius:50%;
            background:${u.online ? "#25d366" : "#ccc"};
            border:2px solid white;
          "></span>
        </div>
        <div class="info">
          <div class="name">${u.username} ${u.online ? "" : '<span style="font-size:10px;color:#bbb;">(offline)</span>'}</div>
          <div class="preview">${preview}</div>
        </div>
        ${unread > 0 ? `<div class="badge">${unread}</div>` : ""}
      </div>
    `;
  }).join("");
}

function openChat(userId, username, isOnline) {
  //userid used as username
  const chatKey = userId || username;
  activeChatId = chatKey;
  unreadCounts[chatKey] = 0;

  document.getElementById("chatPlaceholder").style.display = "none";
  document.getElementById("chatWindow").classList.add("active");
  document.getElementById("chatName").textContent = username;
  document.getElementById("chatAvatar").textContent = username[0].toUpperCase();
  document.getElementById("chatStatus").textContent = isOnline
    ? "online · auto-translating"
    : "offline · message will be delivered when online";
  document.getElementById("typingIndicator").textContent = "";

  // all time history load
  socket.emit("load history", { withUsername: username });

  renderMessages(chatKey);
  renderContacts(allUsers);
  document.getElementById("msgInput").focus();
}
function renderMessages(userId) {
  const messages = document.getElementById("messages");
  const convos = conversations[userId] || [];
  messages.innerHTML = convos.map(msg => {
    const isMe = msg.fromUser === myName;
    const showOriginal = msg.original && msg.original !== msg.text;
    return `
      <div class="message ${isMe ? "mine" : "other"}">
        <div class="text">${msg.text}</div>
        <div class="meta">
          ${showOriginal ? `<div class="original">📝 ${msg.original}</div>` : ""}
          <div class="time">${msg.time}</div>
        </div>
      </div>
    `;
  }).join("");
  messages.scrollTop = messages.scrollHeight;
}

function sendMessage() {
  const text = document.getElementById("msgInput").value.trim();
  if (!text || !activeChatId) return;
  socket.emit("private message", { toId: activeChatId, text });
  socket.emit("stop typing", { toId: activeChatId });
  document.getElementById("msgInput").value = "";
}

document.getElementById("sendBtn").addEventListener("click", sendMessage);
document.getElementById("msgInput").addEventListener("keypress", (e) => {
  if (e.key === "Enter") sendMessage();
});

document.getElementById("msgInput").addEventListener("input", () => {
  if (!activeChatId) return;
  socket.emit("typing", { toId: activeChatId });
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    socket.emit("stop typing", { toId: activeChatId });
  }, 1500);
});

socket.on("private message", (msg) => {
  const chatPartnerId = msg.fromId === myId ? msg.toId : msg.fromId;
  if (!conversations[chatPartnerId]) conversations[chatPartnerId] = [];
  conversations[chatPartnerId].push({
    fromUser: msg.username,
    text: msg.text,
    original: msg.original,
    time: msg.time,
  });

  if (activeChatId === chatPartnerId) {
    renderMessages(chatPartnerId);
  } else {
    unreadCounts[chatPartnerId] = (unreadCounts[chatPartnerId] || 0) + 1;
  }
  renderContacts(allUsers);
});

socket.on("chat history", ({ withUsername, messages }) => {
  const user = allUsers.find(u => u.username === withUsername);
  
  const chatKey = (user && user.id) ? user.id : withUsername;
  conversations[chatKey] = messages.map(m => ({
    fromUser: m.from_user,
    text: m.translated,
    original: m.original,
    time: m.time,
  }));
  if (activeChatId === chatKey) {
    renderMessages(chatKey);
  }
});

socket.on("typing", ({ fromId, username }) => {
  if (activeChatId === fromId) {
    document.getElementById("typingIndicator").textContent = `${username} is typing...`;
  }
});

socket.on("stop typing", ({ fromId }) => {
  if (activeChatId === fromId) {
    document.getElementById("typingIndicator").textContent = "";
  }
});