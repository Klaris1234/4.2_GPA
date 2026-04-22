import {
  getSession,
  setSession,
  api,
  escapeHtml,
  formatDate,
  isValidNric,
  normalizeNric,
  gradeTone,
  clearAssessmentState,
  stopTimers
} from './app.js';

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

initResultPage();