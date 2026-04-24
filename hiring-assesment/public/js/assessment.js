import {
  getSession,
  setSession,
  api,
  escapeHtml,
  formatCountdown,
  renderDatasetTable,
  stopTimers,
  reportViolation
} from './app.js';

let currentDataset = [];
let currentInstructions = '';
let currentRole = '';
let heartbeatTimer = null;
let countdownTimer = null;

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

    currentDataset = data.dataset;
    currentInstructions = data.instructions;
    currentRole = data.roleLabel;
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
    const session = getSession();

    const aiResult = await api('/api/evaluate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        answer: answerInput.value,
        role: session.role, // ✅ FIXED
        instructions: instructionsBox.textContent,
        dataset: currentDataset
      })
    });
    console.log("AI RESULT:", aiResult);

    const total = Math.round(
      (aiResult.correctness +
        aiResult.reasoning +
        aiResult.clarity +
        aiResult.creativity) / 4
    );

    let fraudFlag = "OK";

    if (aiResult.aiLikelihood > 80 && aiResult.specificity < 40) {
      fraudFlag = "⚠️ Possible AI-generated / low originality";
    }

    await api('/api/submit-assessment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        attemptId: session.attemptId,
        answer: answerInput.value,
        aiScores: aiResult
      })
    });

    stopTimers();

    window.location.href = `result.html?attemptId=${encodeURIComponent(session.attemptId)}`;

  } catch (error) {
    submitBtn.disabled = false;
    document.getElementById('assessmentStatusBox').innerHTML =
      `<span class="danger">${escapeHtml(error.message)}</span>`;
  }
});
}

/* ---------------- LOCKDOWN ---------------- */

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
      handleAutoZero('Fullscreen exited. Automatic zero applied.');
    }
  });

  document.addEventListener('contextmenu', e => e.preventDefault());

  document.addEventListener('keydown', event => {
    const key = event.key.toLowerCase();
    const blockedCtrl = ['r', 't', 'w', 'n', 'p', 's', 'l'];
    const blockedAlt = ['arrowleft', 'arrowright'];

    if (
      key === 'f5' ||
      ((event.ctrlKey || event.metaKey) && blockedCtrl.includes(key)) ||
      (event.altKey && blockedAlt.includes(key))
    ) {
      event.preventDefault();
    }
  });

  window.addEventListener('beforeunload', event => {
    const session = getSession();
    if (!session.attemptId) return;

    reportViolation('User left or refreshed. Automatic zero applied.', true);
    event.preventDefault();
    event.returnValue = '';
  });
}

/* ---------------- HEARTBEAT ---------------- */

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
      // ignore
    }
  }, 5000);
}

/* ---------------- COUNTDOWN ---------------- */

function startCountdown(expiresAt) {
  const timerValue = document.getElementById('timerValue');
  if (!timerValue) return;

  const tick = () => {
    const remaining = new Date(expiresAt).getTime() - Date.now();
    timerValue.textContent = formatCountdown(remaining);

    if (remaining <= 0) {
      stopTimers();
      handleAutoZero('Assessment expired.');
    }
  };

  tick();
  countdownTimer = setInterval(tick, 500);
}

/* ---------------- AUTO ZERO ---------------- */

async function handleAutoZero(reason) {
  const session = getSession();
  if (!session.attemptId) return;

  stopTimers();
  await reportViolation(reason);

  window.location.href = `result.html?attemptId=${encodeURIComponent(session.attemptId)}`;
}

/* ---------------- INIT ---------------- */

initAssessmentPage();