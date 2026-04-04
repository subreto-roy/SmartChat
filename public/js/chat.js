const socket = io();

let myName = "";
let myLang = "en";
let myId = null;
let activeChatId = null;
let allUsers = [];
let conversations = {};
let unreadCounts = {};
let typingTimeout;

// WebRTC
let localStream = null;
let peerConnection = null;
let currentCallId = null;
let currentCallPeerId = null;

const iceServers = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

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
  socket.emit("load last messages");
  document.getElementById("myNameDisplay").textContent = `${myName} · ${langNames[myLang]}`;
});

function logout() {
  localStorage.removeItem("chatUser");
  window.location.href = "/login.html";
}

// User list
socket.on("user list", (users) => {
  allUsers = users.filter(u => u.username !== myName);
  allUsers.forEach(u => {
    const key = u.id || u.username;
    if (!conversations[key]) {
      socket.emit("load history", { withUsername: u.username });
    }
  });
  renderContacts(allUsers);
});

// Search
document.getElementById("searchInput").addEventListener("input", (e) => {
  const q = e.target.value.toLowerCase();
  renderContacts(allUsers.filter(u => u.username.toLowerCase().includes(q)));
});

function getLastMsg(uid) {
  const convos = conversations[uid] || [];
  return convos[convos.length - 1] || null;
}

function renderContacts(users) {
  const list = document.getElementById("contactList");
  const others = users
    .filter(u => u.username !== myName)
    .sort((a, b) => {
      const aLast = getLastMsg(a.id || a.username);
      const bLast = getLastMsg(b.id || b.username);
      if (!aLast && !bLast) return 0;
      if (!aLast) return 1;
      if (!bLast) return -1;
      return (bLast.sortKey || 0) - (aLast.sortKey || 0);
    });

  if (others.length === 0) {
    list.innerHTML = '<div class="no-contacts">No users found...</div>';
    return;
  }

  list.innerHTML = others.map(u => {
    const uid = u.id || u.username;
    const last = getLastMsg(uid);
    const preview = last ? last.text : "No messages yet";
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
          <div class="name">${u.username} ${u.online ? "" : '<span style="font-size:10px;color:#bbb;"></span>'}</div>
          <div class="preview">${preview}</div>
        </div>
        ${unread > 0 ? `<div class="badge">${unread}</div>` : ""}
      </div>
    `;
  }).join("");
}

function openChat(userId, username, isOnline) {
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
  document.getElementById("callBtn").style.display = "flex";
  document.getElementById("typingIndicator").textContent = "";

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
    const showOriginal = !isMe && msg.original && msg.original !== msg.text;
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

  const newMsg = {
    fromUser: msg.username,
    text: msg.text,
    original: msg.original,
    time: msg.time,
    sortKey: Date.now(),
  };

  conversations[chatPartnerId].push(newMsg);

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

  // DB থেকে আসা messages
  const historyMsgs = messages.map((m, i) => ({
    fromUser: m.from_user,
    text: m.from_user === myName ? m.original : m.translated,
    original: m.from_user === myName ? m.original : m.original,
    original: m.original,
    time: m.time,
    sortKey: m.id || i,
    dbId: m.id,
  }));

  // আগে যদি নতুন message এসে থাকে সেগুলো রাখো
  const existing = conversations[chatKey] || [];
  const newMsgs = existing.filter(m => !m.dbId);

  conversations[chatKey] = [...historyMsgs, ...newMsgs];

  if (activeChatId === chatKey) {
    renderMessages(chatKey);
  }
  renderContacts(allUsers);
});

socket.on("last messages", (messages) => {
  messages.forEach(m => {
    const partnerUsername = m.from_user === myName ? m.to_user : m.from_user;
    const user = allUsers.find(u => u.username === partnerUsername);
    const chatKey = (user && user.id) ? user.id : partnerUsername;
    if (!conversations[chatKey]) conversations[chatKey] = [];
    if (conversations[chatKey].length === 0) {
      conversations[chatKey].push({
        fromUser: m.from_user,
        text: m.translated,
        original: m.original,
        time: m.time,
        sortKey: m.id,
      });
    }
  });
  renderContacts(allUsers);
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

// ── CALLING ──────────────────────────────────────────

document.getElementById("callBtn").addEventListener("click", () => {
  if (!activeChatId) return;
  socket.emit("call user", { toId: activeChatId });
  showCallUI("outgoing");
});

socket.on("call initiated", ({ callId, toId }) => {
  currentCallId = callId;
  currentCallPeerId = toId;
});

socket.on("incoming call", ({ callId, fromId, username }) => {
  currentCallId = callId;
  currentCallPeerId = fromId;
  document.getElementById("callCallerName").textContent = username;
  showCallUI("incoming");
});

document.getElementById("acceptCallBtn").addEventListener("click", async () => {
  socket.emit("call accepted", { callId: currentCallId, toId: currentCallPeerId });
  await startCall(false);
  showCallUI("active");
});

document.getElementById("rejectCallBtn").addEventListener("click", () => {
  socket.emit("call rejected", { toId: currentCallPeerId });
  hideCallUI();
});

socket.on("call accepted", async ({ callId, fromId }) => {
  currentCallPeerId = fromId;
  await startCall(true);
  showCallUI("active");
});

socket.on("call rejected", () => {
  hideCallUI();
  alert("Call was rejected.");
});

document.getElementById("endCallBtn").addEventListener("click", () => {
  socket.emit("end call", { toId: currentCallPeerId });
  endCall();
});

socket.on("call ended", () => {
  endCall();
});

async function startCall(isCaller) {
  localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  document.getElementById("localAudio").srcObject = localStream;

  peerConnection = new RTCPeerConnection(iceServers);

  localStream.getTracks().forEach(track => {
    peerConnection.addTrack(track, localStream);
  });

  peerConnection.ontrack = (event) => {
    document.getElementById("remoteAudio").srcObject = event.streams[0];
    startCallTimer();
  };

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("webrtc ice candidate", {
        toId: currentCallPeerId,
        candidate: event.candidate,
      });
    }
  };

  if (isCaller) {
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit("webrtc offer", { toId: currentCallPeerId, offer });
  }
}

socket.on("webrtc offer", async ({ fromId, offer }) => {
  if (!peerConnection) return;
  await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);
  socket.emit("webrtc answer", { toId: fromId, answer });
});

socket.on("webrtc answer", async ({ answer }) => {
  if (!peerConnection) return;
  await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
});

socket.on("webrtc ice candidate", async ({ candidate }) => {
  if (!peerConnection) return;
  try {
    await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
  } catch (e) {
    console.log("ICE error:", e);
  }
});

function showCallUI(type) {
  document.getElementById("callOverlay").style.display = "flex";
  document.getElementById("outgoingCall").style.display = type === "outgoing" ? "block" : "none";
  document.getElementById("incomingCall").style.display = type === "incoming" ? "block" : "none";
  document.getElementById("activeCall").style.display = type === "active" ? "block" : "none";
}

function hideCallUI() {
  document.getElementById("callOverlay").style.display = "none";
}

let callTimer = null;
let callSeconds = 0;

function startCallTimer() {
  callSeconds = 0;
  if (callTimer) clearInterval(callTimer);
  callTimer = setInterval(() => {
    callSeconds++;
    const m = String(Math.floor(callSeconds / 60)).padStart(2, "0");
    const s = String(callSeconds % 60).padStart(2, "0");
    document.getElementById("callDuration").textContent = `${m}:${s}`;
  }, 1000);
}

function endCall() {
  if (callTimer) { clearInterval(callTimer); callTimer = null; }
  if (peerConnection) { peerConnection.close(); peerConnection = null; }
  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  currentCallId = null;
  currentCallPeerId = null;
  hideCallUI();
}