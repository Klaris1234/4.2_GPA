const STORAGE_KEY = 'znh_candidate_session';

let heartbeatTimer = null;
let countdownTimer = null;
let violationTriggered = false;

function getSession() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch (_) {
    return {};
  }
}

function setSession(next) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...getSession(), ...next }));
}

function normalizeNric(value) {
  return String(value || '').toUpperCase().replace(/\s+/g, '');
}

function isValidNric(value) {
  return /^[A-Z]\d{7}[A-Z]$/.test(normalizeNric(value));
}

function clearAssessmentState() {
  const session = getSession();
  if (session.attemptId) {
    session.lastAttemptId = session.attemptId;
  }
  delete session.attemptId;
  delete session.expiresAt;
  delete session.candidateCode;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

async function api(url, options = {}) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'Request failed');
  }
  return data;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDate(iso) {
  if (!iso) return '-';
  return new Date(iso).toLocaleString();
}

function formatCountdown(ms) {
  if (ms <= 0) return '00:00:00';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
  const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

function renderDatasetTable(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const head = `<tr>${headers.map(header => `<th>${escapeHtml(header)}</th>`).join('')}</tr>`;
  const body = rows
    .map(row => `<tr>${headers.map(header => `<td>${escapeHtml(row[header])}</td>`).join('')}</tr>`)
    .join('');
  return `<thead>${head}</thead><tbody>${body}</tbody>`;
}

function gradeTone(grade) {
  if (grade === 'A' || grade === 'B') return 'success';
  if (grade === 'C') return 'warning';
  return 'danger';
}

async function requestFullscreen() {
  const root = document.documentElement;
  if (document.fullscreenElement) return true;

  try {
    await root.requestFullscreen();
    return true;
  } catch (_) {
    return false;
  }
}

function stopTimers() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (countdownTimer) clearInterval(countdownTimer);
  heartbeatTimer = null;
  countdownTimer = null;
}

async function reportViolation(reason, useBeacon = false) {
  const session = getSession();
  if (!session.attemptId || violationTriggered) return;
  violationTriggered = true;

  const payload = JSON.stringify({ attemptId: session.attemptId, reason });
  if (useBeacon && navigator.sendBeacon) {
    navigator.sendBeacon('/api/violation', new Blob([payload], { type: 'application/json' }));
    return;
  }

  try {
    await api('/api/violation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });
  } catch (_) {
    // Ignore follow-up network failures during disqualification.
  }
}

async function handleAutoZero(reason) {
  const session = getSession();
  if (!session.attemptId) return;
  stopTimers();
  await reportViolation(reason);
  window.location.href = `result.html?attemptId=${encodeURIComponent(session.attemptId)}`;
}

function attachLockdownHandlers() {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) handleAutoZero('Tab switch detected. Automatic zero applied.');
  });

  window.addEventListener('blur', () => {
    handleAutoZero('Window focus lost. Automatic zero applied.');
  });

  document.addEventListener('fullscreenchange', () => {
    const session = getSession();
    if (session.attemptId && !document.fullscreenElement) {
      handleAutoZero('Fullscreen was exited. Automatic zero applied.');
    }
  });

  document.addEventListener('contextmenu', event => {
    event.preventDefault();
  });

  document.addEventListener('keydown', event => {
    const key = event.key.toLowerCase();
    const blockedCtrl = ['r', 't', 'w', 'n', 'p', 's', 'l'];
    const blockedAlt = ['arrowleft', 'arrowright'];

    if (key === 'f5' || (event.ctrlKey || event.metaKey) && blockedCtrl.includes(key) || event.altKey && blockedAlt.includes(key)) {
      event.preventDefault();
    }
  });

  window.addEventListener('beforeunload', event => {
    const session = getSession();
    if (!session.attemptId) return;
    reportViolation('User left or refreshed the page. Automatic zero applied.', true);
    event.preventDefault();
    event.returnValue = '';
  });
}

function startHeartbeat() {
  stopTimers();

  heartbeatTimer = setInterval(async () => {
    const session = getSession();
    if (!session.attemptId) return;

    try {
      const data = await api('/api/heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attemptId: session.attemptId })
      });

      if (data.status !== 'in_progress') {
        stopTimers();
        window.location.href = `result.html?attemptId=${encodeURIComponent(session.attemptId)}`;
      }
    } catch (_) {
      // Ignore transient heartbeat errors.
    }
  }, 5000);
}

function startCountdown(expiresAt) {
  const timerValue = document.getElementById('timerValue');
  if (!timerValue) return;

  const tick = () => {
    const remaining = new Date(expiresAt).getTime() - Date.now();
    timerValue.textContent = formatCountdown(remaining);
    if (remaining <= 0) {
      stopTimers();
      handleAutoZero('Assessment expired before submission.');
    }
  };

  tick();
  countdownTimer = setInterval(tick, 500);
}

async function initStartPage() {
  const roleSelect = document.getElementById('roleSelect');
  const eligibilityBox = document.getElementById('eligibilityBox');
  const continueBtn = document.getElementById('continueBtn');
  const checkEligibilityBtn = document.getElementById('checkEligibilityBtn');
  const nricInput = document.getElementById('nricInput');

  const roles = await api('/api/roles');
  roleSelect.innerHTML = roles.map(role => `<option value="${role.key}">${role.roleLabel}</option>`).join('');

  const existing = getSession();
  if (existing.nric) nricInput.value = existing.nric;
  if (existing.role) roleSelect.value = existing.role;

  const persistCandidate = () => {
    const nric = normalizeNric(nricInput.value);
    const role = roleSelect.value;
    const roleLabel = roles.find(item => item.key === role)?.roleLabel || '';
    setSession({ nric, role, roleLabel });
    return { nric, role, roleLabel };
  };

  const checkEligibility = async () => {
    const { nric, role } = persistCandidate();

    if (!nric || !role) {
      eligibilityBox.innerHTML = '<span class="warning">Enter your NRIC or FIN and select a role first.</span>';
      return { allowed: false };
    }

    if (!isValidNric(nric)) {
      eligibilityBox.innerHTML = '<span class="warning">Enter a valid NRIC or FIN in the format S1234567D.</span>';
      return { allowed: false };
    }

    try {
      const data = await api(`/api/eligibility?nric=${encodeURIComponent(nric)}&role=${encodeURIComponent(role)}`);
      if (data.allowed) {
        eligibilityBox.innerHTML = '<span class="success">Eligible to start this role now.</span>';
      } else {
        eligibilityBox.innerHTML = `<span class="warning">This role is locked until ${escapeHtml(formatDate(data.nextEligibleAt))}.</span>`;
      }
      return data;
    } catch (error) {
      eligibilityBox.innerHTML = `<span class="danger">${escapeHtml(error.message)}</span>`;
      return { allowed: false };
    }
  };

  checkEligibilityBtn.addEventListener('click', checkEligibility);

  continueBtn.addEventListener('click', async () => {
    const result = await checkEligibility();
    if (!result.allowed) return;
    window.location.href = 'rules.html';
  });
}

async function initRulesPage() {
  const session = getSession();
  const rulesCandidateMeta = document.getElementById('rulesCandidateMeta');
  const rulesStatusBox = document.getElementById('rulesStatusBox');
  const startAssessmentBtn = document.getElementById('startAssessmentBtn');

  if (!session.nric || !session.role) {
    window.location.href = 'start.html';
    return;
  }

  rulesCandidateMeta.textContent = `${session.nric} | ${session.roleLabel || session.role}`;

  startAssessmentBtn.addEventListener('click', async () => {
    try {
      const fullscreenOk = await requestFullscreen();
      if (!fullscreenOk) {
        rulesStatusBox.innerHTML = '<span class="danger">Fullscreen permission is required before the assessment can start.</span>';
        return;
      }

      const data = await api('/api/start-assessment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nric: session.nric, role: session.role })
      });

      setSession({
        attemptId: data.attempt.id,
        lastAttemptId: data.attempt.id,
        expiresAt: data.attempt.expiresAt,
        candidateCode: data.attempt.candidateCode,
        roleLabel: data.attempt.roleLabel
      });

      window.location.href = 'assessment.html';
    } catch (error) {
      rulesStatusBox.innerHTML = `<span class="danger">${escapeHtml(error.message)}</span>`;
    }
  });
}

async function initAssessmentPage() {
  attachLockdownHandlers();

  const session = getSession();
  if (!session.attemptId) {
    window.location.href = 'start.html';
    return;
  }

  const title = document.getElementById('assessmentTitle');
  const meta = document.getElementById('assessmentMeta');
  const statusBox = document.getElementById('assessmentStatusBox');
  const instructionsBox = document.getElementById('instructionsBox');
  const datasetTable = document.getElementById('datasetTable');
  const answerInput = document.getElementById('answerInput');
  const submitBtn = document.getElementById('submitAssessmentBtn');

  try {
    const data = await api(`/api/assessment/${encodeURIComponent(session.attemptId)}`);
    title.textContent = data.title;
    meta.textContent = `${data.roleLabel} | Candidate ${data.candidateCode} | ${data.nric}`;
    instructionsBox.textContent = data.instructions;
    datasetTable.innerHTML = renderDatasetTable(data.dataset);
    setSession({
      expiresAt: data.expiresAt,
      roleLabel: data.roleLabel,
      candidateCode: data.candidateCode,
      nric: data.nric
    });
    statusBox.innerHTML = '<span class="success">Assessment verified. Questions are now visible.</span>';

    startHeartbeat();
    startCountdown(data.expiresAt);
  } catch (error) {
    statusBox.innerHTML = `<span class="danger">${escapeHtml(error.message)}</span>`;
    return;
  }

  submitBtn.addEventListener('click', async () => {
    submitBtn.disabled = true;

    try {
      await api('/api/submit-assessment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attemptId: session.attemptId, answer: answerInput.value })
      });
      stopTimers();
      violationTriggered = false;
      window.location.href = `result.html?attemptId=${encodeURIComponent(session.attemptId)}`;
    } catch (error) {
      submitBtn.disabled = false;
      statusBox.innerHTML = `<span class="danger">${escapeHtml(error.message)}</span>`;
    }
  });
}

function resultMarkup(result) {
  const breakdown = result.scoreBreakdown || { accuracy: 0, reasoning: 0, clarity: 0, strengths: [], weaknesses: [] };
  return `
    <div class="status-box ${result.status === 'submitted' ? 'success' : 'warning'}">Status: ${escapeHtml(result.status)}</div>
    <p><strong>Candidate code:</strong> ${escapeHtml(result.candidateCode || '-')}</p>
    <p><strong>NRIC / FIN:</strong> ${escapeHtml(result.nric || '-')}</p>
    <p><strong>Role:</strong> ${escapeHtml(result.roleLabel || result.role || '-')}</p>
    <p><strong>Completed:</strong> ${escapeHtml(formatDate(result.completedAt || result.startedAt))}</p>
    <div class="metric-grid">
      <div class="metric-card">
        <span>Grade</span>
        <strong class="${gradeTone(result.grade)}">${escapeHtml(result.grade || 'F')}</strong>
      </div>
      <div class="metric-card">
        <span>Total score</span>
        <strong>${escapeHtml(result.score ?? '0')}</strong>
      </div>
      <div class="metric-card">
        <span>Rank</span>
        <strong>${result.rank ? `${result.rank}/${result.totalInRole}` : '-'}</strong>
      </div>
    </div>
    <div class="metric-grid">
      <div class="metric-card"><span>Percentile</span><strong>${result.percentile ?? '-'}</strong></div>
      <div class="metric-card"><span>Accuracy</span><strong>${breakdown.accuracy}</strong></div>
      <div class="metric-card"><span>Reasoning</span><strong>${breakdown.reasoning}</strong></div>
    </div>
    <div class="metric-grid single-row-grid">
      <div class="metric-card"><span>Clarity</span><strong>${breakdown.clarity}</strong></div>
    </div>
    ${result.disqualifyReason ? `<p class="danger"><strong>Reason:</strong> ${escapeHtml(result.disqualifyReason)}</p>` : ''}
    <div class="rules-box">
      <strong>Strengths</strong>
      <ul class="rules-list">${(breakdown.strengths || []).map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
    </div>
    <div class="rules-box space-top">
      <strong>Weaknesses</strong>
      <ul class="rules-list">${(breakdown.weaknesses || []).map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
    </div>
  `;
}

async function initResultPage() {
  stopTimers();

  const sessionBeforeClear = getSession();
  const resultBox = document.getElementById('resultBox');
  const historyNricInput = document.getElementById('historyNricInput');
  const loadHistoryBtn = document.getElementById('loadHistoryBtn');
  const historyBox = document.getElementById('historyBox');
  const urlAttemptId = new URLSearchParams(window.location.search).get('attemptId');
  const lastAttemptId = urlAttemptId || sessionBeforeClear.attemptId || sessionBeforeClear.lastAttemptId;

  clearAssessmentState();

  if (sessionBeforeClear.nric) {
    historyNricInput.value = sessionBeforeClear.nric;
  }

  if (lastAttemptId) {
    try {
      const result = await api(`/api/result/${encodeURIComponent(lastAttemptId)}`);
      resultBox.innerHTML = resultMarkup(result);
      setSession({ lastAttemptId: result.id, nric: result.nric, role: result.role, roleLabel: result.roleLabel });
    } catch (error) {
      resultBox.innerHTML = `<span class="danger">${escapeHtml(error.message)}</span>`;
    }
  } else {
    resultBox.innerHTML = '<span class="warning">No recent attempt found in this browser.</span>';
  }

  loadHistoryBtn.addEventListener('click', async () => {
    const nric = normalizeNric(historyNricInput.value);
    if (!nric) {
      historyBox.innerHTML = '<span class="warning">Enter your NRIC or FIN to load history.</span>';
      return;
    }

    if (!isValidNric(nric)) {
      historyBox.innerHTML = '<span class="warning">Enter a valid NRIC or FIN in the format S1234567D.</span>';
      return;
    }

    try {
      const items = await api(`/api/my-submissions?nric=${encodeURIComponent(nric)}`);
      if (!items.length) {
        historyBox.innerHTML = '<span class="warning">No submissions found for that NRIC or FIN.</span>';
        return;
      }

      historyBox.innerHTML = items.map(item => `
        <div class="history-card">
          <div><strong>${escapeHtml(item.roleLabel)}</strong></div>
          <div class="muted">${escapeHtml(item.candidateCode)} | ${escapeHtml(formatDate(item.completedAt || item.startedAt))}</div>
          <div class="muted">Grade ${escapeHtml(item.grade)} | Score ${escapeHtml(item.score ?? 0)} | Rank ${item.rank ? `${item.rank}/${item.totalInRole}` : '-'} | Percentile ${item.percentile ?? '-'}</div>
          ${item.disqualifyReason ? `<div class="danger">${escapeHtml(item.disqualifyReason)}</div>` : ''}
        </div>
      `).join('');
    } catch (error) {
      historyBox.innerHTML = `<span class="danger">${escapeHtml(error.message)}</span>`;
    }
  });
}

(async function init() {
  const page = document.body.dataset.page;
  if (page === 'start') await initStartPage();
  if (page === 'rules') await initRulesPage();
  if (page === 'assessment') await initAssessmentPage();
  if (page === 'result') await initResultPage();
})();
