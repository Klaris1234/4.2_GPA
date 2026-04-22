// =====================
// SESSION
// =====================
const STORAGE_KEY = 'znh_candidate_session';

export function getSession() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

export function setSession(next) {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ ...getSession(), ...next })
  );
}

export function clearAssessmentState() {
  const session = getSession();

  if (session.attemptId) {
    session.lastAttemptId = session.attemptId;
  }

  delete session.attemptId;
  delete session.expiresAt;
  delete session.candidateCode;

  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

// =====================
// API
// =====================
export async function api(url, options = {}) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error || 'Request failed');
  }

  return data;
}

// =====================
// VALIDATION
// =====================
export function normalizeNric(value) {
  return String(value || '').toUpperCase().replace(/\s+/g, '');
}

export function isValidNric(value) {
  return /^[A-Z]\d{7}[A-Z]$/.test(normalizeNric(value));
}

// =====================
// FORMATTERS
// =====================
export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function formatDate(iso) {
  if (!iso) return '-';
  return new Date(iso).toLocaleString();
}

export function formatCountdown(ms) {
  if (ms <= 0) return '00:00:00';

  const totalSeconds = Math.floor(ms / 1000);
  const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
  const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
  const seconds = String(totalSeconds % 60).padStart(2, '0');

  return `${hours}:${minutes}:${seconds}`;
}

export function renderDatasetTable(rows) {
  if (!rows.length) return '';

  const headers = Object.keys(rows[0]);

  const head = `
    <tr>
      ${headers.map(h => `<th>${escapeHtml(h)}</th>`).join('')}
    </tr>
  `;

  const body = rows
    .map(row => `
      <tr>
        ${headers.map(h => `<td>${escapeHtml(row[h])}</td>`).join('')}
      </tr>
    `)
    .join('');

  return `<thead>${head}</thead><tbody>${body}</tbody>`;
}

export function gradeTone(grade) {
  if (grade === 'A' || grade === 'B') return 'success';
  if (grade === 'C') return 'warning';
  return 'danger';
}

// =====================
// TIMERS
// =====================
let heartbeatTimer = null;
let countdownTimer = null;
let violationTriggered = false;

export function stopTimers() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (countdownTimer) clearInterval(countdownTimer);

  heartbeatTimer = null;
  countdownTimer = null;
}

// =====================
// VIOLATION
// =====================
export async function reportViolation(reason, useBeacon = false) {
  const session = getSession();

  if (!session.attemptId || violationTriggered) return;
  violationTriggered = true;

  const payload = JSON.stringify({
    attemptId: session.attemptId,
    reason
  });

  if (useBeacon && navigator.sendBeacon) {
    navigator.sendBeacon(
      '/api/violation',
      new Blob([payload], { type: 'application/json' })
    );
    return;
  }

  try {
    await api('/api/violation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });
  } catch (_) {}
}

// =====================
// FULLSCREEN
// =====================
export async function requestFullscreen() {
  const root = document.documentElement;

  if (document.fullscreenElement) return true;

  try {
    await root.requestFullscreen();
    return true;
  } catch {
    return false;
  }
}

