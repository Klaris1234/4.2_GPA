import { api, getSession, setSession, normalizeNric, isValidNric } from './app.js';

async function initStartPage() {
  const query = new URLSearchParams(window.location.search);
  const queryNric = normalizeNric(query.get('nric'));
  const queryLocked = query.get('locked') === '1';
  if (queryLocked && isValidNric(queryNric)) {
    setSession({ nric: queryNric, identityLocked: true });
    window.history.replaceState({}, '', window.location.pathname);
  }

  const roleSelect = document.getElementById('roleSelect');
  const nricInput = document.getElementById('nricInput');
  const eligibilityBox = document.getElementById('eligibilityBox');
  const checkBtn = document.getElementById('checkEligibilityBtn');
  const continueBtn = document.getElementById('continueBtn');

  // safety check
  if (!roleSelect || !nricInput || !eligibilityBox) {
    console.error("Missing DOM elements");
    return;
  }

  // =====================
  // LOAD ROLES
  // =====================
  let roles = [];

  try {
    roles = await api('/api/roles');

    roleSelect.innerHTML = roles
      .map(r => `<option value="${r.key}">${r.roleLabel}</option>`)
      .join('');

  } catch (err) {
    console.error("Failed loading roles:", err);
    eligibilityBox.textContent = "Failed to load roles.";
    return;
  }

  // =====================
  // RESTORE SESSION
  // =====================
  const session = getSession();
  const sessionNric = normalizeNric(session.nric);
  const lockedNric = session.identityLocked && isValidNric(sessionNric)
    ? sessionNric
    : '';

  if (isValidNric(sessionNric)) nricInput.value = sessionNric;
  if (session.role) roleSelect.value = session.role;

  if (lockedNric) {
    nricInput.value = lockedNric;
    nricInput.readOnly = true;
    nricInput.classList.add('locked-input');
    nricInput.title = 'NRIC/FIN is locked from your login identity.';
    eligibilityBox.textContent = 'NRIC/FIN is auto-filled from your login and cannot be changed here.';
  }

  function persist() {
    const nric = lockedNric || normalizeNric(nricInput.value);
    const role = roleSelect.value;

    const roleLabel =
      roles.find(r => r.key === role)?.roleLabel || role;

    setSession({ nric, role, roleLabel, identityLocked: Boolean(lockedNric) });

    return { nric, role };
  }

  // =====================
  // CHECK ELIGIBILITY
  // =====================
  checkBtn.addEventListener('click', async () => {
    const { nric, role } = persist();

    if (!nric || !role) {
      eligibilityBox.textContent = "Enter NRIC and select a role.";
      return;
    }

    if (!isValidNric(nric)) {
      eligibilityBox.textContent = "Invalid NRIC format (S1234567D).";
      return;
    }

    try {
      const data = await api(
        `/api/eligibility?nric=${encodeURIComponent(nric)}&role=${encodeURIComponent(role)}`
      );

      eligibilityBox.textContent = data.allowed
        ? "✅ Eligible to start"
        : `❌ Locked until ${new Date(data.nextEligibleAt).toLocaleString()}`;

    } catch (err) {
      eligibilityBox.textContent = err.message;
    }
  });

  // =====================
  // CONTINUE
  // =====================
  continueBtn.addEventListener('click', async () => {
    const { nric, role } = persist();

    if (!nric || !role) return;

    try {
      const result = await api(
        `/api/eligibility?nric=${encodeURIComponent(nric)}&role=${encodeURIComponent(role)}`
      );

      if (!result.allowed) {
        eligibilityBox.textContent = "Not eligible yet.";
        return;
      }

      window.location.href = 'rules.html';

    } catch (err) {
      eligibilityBox.textContent = err.message;
    }
  });
}

document.addEventListener('DOMContentLoaded', initStartPage);
