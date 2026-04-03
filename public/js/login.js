function showTab(tab) {
  document.getElementById("loginForm").style.display = tab === "login" ? "block" : "none";
  document.getElementById("registerForm").style.display = tab === "register" ? "block" : "none";
  document.getElementById("loginTab").classList.toggle("active", tab === "login");
  document.getElementById("registerTab").classList.toggle("active", tab === "register");
  document.getElementById("errorMsg").style.display = "none";
}

function showError(msg) {
  const el = document.getElementById("errorMsg");
  el.textContent = msg;
  el.style.display = "block";
}

async function register() {
  const username = document.getElementById("regUsername").value.trim();
  const password = document.getElementById("regPassword").value.trim();
  const lang = document.getElementById("regLang").value;
  if (!username || !password) return showError("Please fill all fields");

  const res = await fetch("/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password, lang }),
  });
  const data = await res.json();
  if (!data.success) return showError(data.message);

  showTab("login");
  document.getElementById("loginUsername").value = username;
  alert("Registered successfully! Please login.");
}

async function login() {
  const username = document.getElementById("loginUsername").value.trim();
  const password = document.getElementById("loginPassword").value.trim();
  if (!username || !password) return showError("Please fill all fields");

  const res = await fetch("/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  if (!data.success) return showError(data.message);

  localStorage.setItem("chatUser", JSON.stringify({
    username: data.username,
    lang: data.lang,
  }));

  window.location.href = "/index.html";
}

// Auto redirect if already logged in
const saved = localStorage.getItem("chatUser");
if (saved) window.location.href = "/index.html";