let currentSession = null;
let countdownTimer = null;
let pollTimer = null;
const STORAGE_KEY = "znh_candidate_session";

const tabButtons = Array.from(document.querySelectorAll(".tab"));
const mobilePanel = document.getElementById("mobilePanel");
const passwordPanel = document.getElementById("passwordPanel");

const qrCanvas = document.getElementById("qrCanvas");
const qrFrame = document.getElementById("qrFrame");
const refreshBtn = document.getElementById("refreshBtn");
const countdownEl = document.getElementById("countdown");
const statusEl = document.getElementById("status");

const passwordForm = document.getElementById("passwordForm");
const singpassIdInput = document.getElementById("singpassId");
const passwordInput = document.getElementById("password");
const togglePasswordBtn = document.getElementById("togglePassword");
const passwordStatus = document.getElementById("passwordStatus");

function normalizeNric(value) {
  return String(value || "").toUpperCase().replace(/\s+/g, "");
}

function getCandidateSession() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function setCandidateSession(next) {
  const current = getCandidateSession();
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...next }));
}

function stopQrTimers() {
  clearInterval(countdownTimer);
  clearInterval(pollTimer);
}

function setActiveTab(tabName) {
  for (const button of tabButtons) {
    const isActive = button.dataset.tab === tabName;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", isActive ? "true" : "false");
  }

  const showMobile = tabName === "mobile";
  mobilePanel.classList.toggle("hidden", !showMobile);
  mobilePanel.hidden = !showMobile;

  passwordPanel.classList.toggle("hidden", showMobile);
  passwordPanel.hidden = showMobile;

  if (showMobile) {
    passwordStatus.textContent = "";
    createQrSession();
  } else {
    stopQrTimers();
  }
}

async function createQrSession() {
  stopQrTimers();

  statusEl.textContent = "Waiting for approval...";
  countdownEl.textContent = "";

  const res = await fetch("/api/qr-session/new");
  if (!res.ok) {
    statusEl.textContent = "Unable to create QR session. Please try again.";
    return;
  }

  const data = await res.json();
  currentSession = data;

  await QRCode.toCanvas(qrCanvas, data.approveUrl, {
    width: 220,
    margin: 1
  });

  startCountdown();
  startPolling();
}

function startCountdown() {
  countdownTimer = setInterval(() => {
    if (!currentSession) return;

    const msLeft = currentSession.expiresAt - Date.now();
    const sec = Math.max(0, Math.ceil(msLeft / 1000));

    countdownEl.textContent = `QR expires in ${sec}s`;

    if (sec <= 0) {
      stopQrTimers();
      statusEl.textContent = "QR expired. Refresh to generate a new code.";
    }
  }, 500);
}

function startPolling() {
  pollTimer = setInterval(async () => {
    if (!currentSession) return;

    const res = await fetch(`/api/qr-session/status/${currentSession.sessionId}`);
    if (!res.ok) return;

    const data = await res.json();

    if (data.status === "approved") {
      stopQrTimers();
      statusEl.textContent = "Approved. Redirecting...";
      setTimeout(() => {
        window.location.href = "/start";
      }, 700);
      return;
    }

    if (data.status === "expired") {
      stopQrTimers();
      statusEl.textContent = "QR expired. Refresh to generate a new code.";
    }
  }, 2000);
}

function togglePasswordVisibility() {
  const showing = passwordInput.type === "text";
  passwordInput.type = showing ? "password" : "text";
  togglePasswordBtn.setAttribute("aria-label", showing ? "Show password" : "Hide password");
}

async function submitPasswordLogin(event) {
  event.preventDefault();

  const singpassId = singpassIdInput.value.trim();
  const password = passwordInput.value.trim();

  if (!singpassId || !password) {
    passwordStatus.style.color = "#b91c1c";
    passwordStatus.textContent = "Please enter both Singpass ID and password.";
    return;
  }

  try {
    const res = await fetch("/api/singpass-login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ singpassId, password })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      passwordStatus.style.color = "#b91c1c";
      passwordStatus.textContent = data.error || "Login failed. Please try again.";
      return;
    }

    passwordStatus.style.color = "#166534";
    passwordStatus.textContent = "Login successful. Redirecting...";
    setCandidateSession({
      singpassId: data.singpassId,
      nric: normalizeNric(data.nric),
      identityLocked: true
    });
  } catch (_) {
    passwordStatus.style.color = "#b91c1c";
    passwordStatus.textContent = "Unable to log in now. Please try again.";
    return;
  }

  setTimeout(() => {
    window.location.href = "/html/index.html";
  }, 700);
}

function openIndexPage() {
  window.location.href = "/html/index.html";
}

function onQrKeydown(event) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    openIndexPage();
  }
}

for (const button of tabButtons) {
  button.addEventListener("click", () => setActiveTab(button.dataset.tab));
}

refreshBtn.addEventListener("click", createQrSession);
qrFrame.addEventListener("click", openIndexPage);
qrFrame.addEventListener("keydown", onQrKeydown);
togglePasswordBtn.addEventListener("click", togglePasswordVisibility);
passwordForm.addEventListener("submit", submitPasswordLogin);

setActiveTab("mobile");
