import { getSession, api, requestFullscreen, setSession, escapeHtml } from './app.js';

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

initRulesPage();