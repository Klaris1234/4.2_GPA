const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'submissions.json');
const SINGPASS_USERS_PATH = path.join(DATA_DIR, 'singpass-users.json');
const ATTEMPT_DURATION_MINUTES = 60;
const RETAKE_LOCK_DAYS = 30;
const QR_SESSION_TTL_MS = 90 * 1000;
require('dotenv').config();


app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));
const qrSessions = new Map();

const TASK_LIBRARY = {
  data_analyst: {
    roleLabel: 'Data Analyst',
    title: 'Retail Sales Performance Analysis',
    instructions: 'Review the dataset below. Identify the top-performing region by total revenue, the weakest category by total units sold, one noteworthy trend, and two practical recommendations. Submit your answer in clear business language.',
    dataset: [
      { region: 'North', category: 'Electronics', revenue: 42000, units: 210, satisfaction: 4.4 },
      { region: 'North', category: 'Home', revenue: 18000, units: 150, satisfaction: 4.0 },
      { region: 'South', category: 'Electronics', revenue: 39000, units: 195, satisfaction: 4.2 },
      { region: 'South', category: 'Home', revenue: 14000, units: 112, satisfaction: 3.8 },
      { region: 'East', category: 'Electronics', revenue: 47000, units: 221, satisfaction: 4.6 },
      { region: 'East', category: 'Home', revenue: 16000, units: 126, satisfaction: 4.1 },
      { region: 'West', category: 'Electronics', revenue: 28000, units: 140, satisfaction: 3.9 },
      { region: 'West', category: 'Home', revenue: 12000, units: 90, satisfaction: 3.6 }
    ],
    evaluationGuidance: {
      expectedTopRegion: 'East',
      expectedWeakestCategory: 'Home',
      expectedTrendKeywords: ['electronics', 'higher revenue', 'east', 'west'],
      expectedRecommendationKeywords: ['improve home', 'west', 'customer satisfaction', 'inventory', 'promotion', 'pricing']
    }
  },
  marketing_associate: {
    roleLabel: 'Marketing Associate',
    title: 'Campaign Recovery Strategy',
    instructions: 'A skincare brand ran a 4-week digital campaign. CTR fell from 3.8% to 2.1%, conversion rate stayed flat at 1.2%, and acquisition cost rose by 28%. Audience feedback shows creative fatigue and weak differentiation. Explain the main issue, propose a revised campaign strategy, define two metrics to track, and write one sample message angle.',
    dataset: [
      { week: 1, ctr: 3.8, conversion: 1.2, cac: 18 },
      { week: 2, ctr: 3.1, conversion: 1.2, cac: 20 },
      { week: 3, ctr: 2.5, conversion: 1.1, cac: 22 },
      { week: 4, ctr: 2.1, conversion: 1.2, cac: 23 }
    ],
    evaluationGuidance: {
      expectedIssueKeywords: ['creative fatigue', 'weak differentiation', 'declining ctr', 'rising acquisition cost'],
      expectedStrategyKeywords: ['refresh creative', 'segment audience', 'test messaging', 'new hooks', 'retargeting'],
      expectedMetricKeywords: ['ctr', 'cac', 'conversion', 'roas', 'engagement']
    }
  },
  product_intern: {
    roleLabel: 'Product Intern',
    title: 'Feature Prioritization Challenge',
    instructions: 'A student budgeting app has three proposed features: (1) receipt scan, (2) shared group budget, (3) subscription reminder. Monthly active users are stagnant, retention is falling, and support tickets mention forgotten recurring payments. Choose one feature to prioritize, justify your decision, describe one risk, and define a simple launch metric.',
    dataset: [
      { feature: 'Receipt Scan', impact: 'Medium', effort: 'High', ticket_relevance: 'Low' },
      { feature: 'Shared Group Budget', impact: 'Medium', effort: 'Medium', ticket_relevance: 'Low' },
      { feature: 'Subscription Reminder', impact: 'High', effort: 'Low', ticket_relevance: 'High' }
    ],
    evaluationGuidance: {
      expectedFeature: 'Subscription Reminder',
      expectedJustificationKeywords: ['retention', 'support tickets', 'low effort', 'high impact', 'recurring payments'],
      expectedRiskKeywords: ['notification fatigue', 'false reminders', 'timing'],
      expectedMetricKeywords: ['retention', 'feature adoption', 'reminder engagement', 'ticket reduction']
    }
  }
};

function normalizeNric(value) {
  return String(value || '').toUpperCase().replace(/\s+/g, '');
}

function isValidNric(value) {
  return /^[A-Z]\d{7}[A-Z]$/.test(normalizeNric(value));
}

function ensureDb() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify({ submissions: [], attempts: [] }, null, 2));
    return;
  }

  const parsed = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
  let changed = false;

  if (!parsed.submissions) {
    parsed.submissions = [];
    changed = true;
  }

  if (!parsed.attempts) {
    parsed.attempts = parsed.submissions.map(submission => ({
      id: submission.id,
      candidateCode: submission.candidateCode,
      nric: normalizeNric(submission.nric),
      name: submission.name || '',
      email: submission.email || '',
      role: submission.role,
      roleLabel: submission.roleLabel,
      answer: submission.answer,
      scores: submission.scores,
      startedAt: submission.createdAt,
      completedAt: submission.createdAt,
      createdAt: submission.createdAt,
      expiresAt: submission.createdAt,
      status: 'submitted',
      disqualifyReason: null,
      violations: [],
      lastHeartbeatAt: submission.createdAt
    }));
    changed = true;
  }

  if (!parsed.shortlisted) {
    parsed.shortlisted = [];
    changed = true;
  }

  for (const attempt of parsed.attempts) {
    const normalized = normalizeNric(attempt.nric);
    if (attempt.nric !== normalized) {
      attempt.nric = normalized;
      changed = true;
    }
  }

  if (changed) {
    fs.writeFileSync(DB_PATH, JSON.stringify(parsed, null, 2));
  }
}

function readDb() {
  ensureDb();
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
}

function readSingpassUsers() {
  if (!fs.existsSync(SINGPASS_USERS_PATH)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(SINGPASS_USERS_PATH, 'utf-8'));
    return Array.isArray(parsed.users) ? parsed.users : [];
  } catch {
    return [];
  }
}

function writeDb(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function candidateCode() {
  return `C-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

function countMatches(text, keywords) {
  const lower = text.toLowerCase();
  let matches = 0;
  for (const keyword of keywords) {
    if (lower.includes(keyword.toLowerCase())) matches += 1;
  }
  return matches;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

async function callGemini(prompt) {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const API_KEY = process.env.KEY;

  let lastError;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const aiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.3
          }
        })
        }
      );

      const data = await aiRes.json();

      if (!aiRes.ok) {
        console.log("Gemini error:", data);

        if (aiRes.status === 503) {
          await sleep(500 * attempt); // exponential backoff
          continue;
        }

        throw new Error(data?.error?.message || "Gemini API error");
      }

      return data; // ✅ THIS WAS MISSING
    } catch (err) {
      lastError = err;
      console.log(`Retrying Gemini... attempt ${attempt}`);
      await sleep(500 * attempt);
    }
  }

  throw lastError || new Error("Gemini failed after retries");
}

function buildStrengths(scores) {
  const strengths = [];
  if (scores.accuracy >= 40) strengths.push('Strong task accuracy');
  if (scores.reasoning >= 25) strengths.push('Good reasoning depth');
  if (scores.clarity >= 15) strengths.push('Clear communication');
  if (strengths.length === 0) strengths.push('Good baseline submission');
  return strengths;
}

function buildWeaknesses(scores, fallback) {
  const weaknesses = [];
  if (scores.accuracy < 25) weaknesses.push('Missed key task requirements');
  if (scores.reasoning < 20) weaknesses.push('Reasoning needs more depth');
  if (scores.clarity < 10) weaknesses.push('Answer structure can be clearer');
  if (weaknesses.length === 0) weaknesses.push(fallback);
  return weaknesses;
}

function buildZeroScore(reason) {
  return {
    total: 0,
    accuracy: 0,
    reasoning: 0,
    clarity: 0,
    strengths: ['Assessment attempt recorded'],
    weaknesses: [reason]
  };
}

function scoreDataAnalyst(answer, task) {
  const lower = answer.toLowerCase();
  let accuracy = 0;
  let reasoning = 0;
  let clarity = 0;

  if (lower.includes(task.evaluationGuidance.expectedTopRegion.toLowerCase())) accuracy += 35;
  if (lower.includes(task.evaluationGuidance.expectedWeakestCategory.toLowerCase())) accuracy += 25;

  reasoning += Math.min(20, countMatches(answer, task.evaluationGuidance.expectedTrendKeywords) * 5);
  reasoning += Math.min(10, countMatches(answer, task.evaluationGuidance.expectedRecommendationKeywords) * 5);

  const sentences = answer.split(/[.!?]\s+/).filter(Boolean).length;
  if (sentences >= 4) clarity += 10;
  if (answer.length >= 220) clarity += 10;

  const total = clamp(accuracy + reasoning + clarity, 0, 100);
  return {
    total,
    accuracy,
    reasoning,
    clarity,
    strengths: buildStrengths({ accuracy, reasoning, clarity }),
    weaknesses: buildWeaknesses({ accuracy, reasoning, clarity }, 'Include clearer data-backed recommendations and complete all required components.')
  };
}

function scoreMarketing(answer, task) {
  let accuracy = 0;
  let reasoning = 0;
  let clarity = 0;

  accuracy += Math.min(35, countMatches(answer, task.evaluationGuidance.expectedIssueKeywords) * 9);
  reasoning += Math.min(30, countMatches(answer, task.evaluationGuidance.expectedStrategyKeywords) * 6);
  reasoning += Math.min(15, countMatches(answer, task.evaluationGuidance.expectedMetricKeywords) * 5);

  const hasAngle = /".*"|'.*'|angle|message|headline|hook/i.test(answer);
  if (hasAngle) accuracy += 10;

  const sentences = answer.split(/[.!?]\s+/).filter(Boolean).length;
  if (sentences >= 4) clarity += 5;
  if (answer.length >= 250) clarity += 10;

  const total = clamp(accuracy + reasoning + clarity, 0, 100);
  return {
    total,
    accuracy,
    reasoning,
    clarity,
    strengths: buildStrengths({ accuracy, reasoning, clarity }),
    weaknesses: buildWeaknesses({ accuracy, reasoning, clarity }, 'Add sharper diagnosis, stronger KPI choices, and a more specific revised message angle.')
  };
}

function scoreProduct(answer, task) {
  const lower = answer.toLowerCase();
  let accuracy = 0;
  let reasoning = 0;
  let clarity = 0;

  if (lower.includes(task.evaluationGuidance.expectedFeature.toLowerCase())) accuracy += 35;
  reasoning += Math.min(30, countMatches(answer, task.evaluationGuidance.expectedJustificationKeywords) * 6);
  reasoning += Math.min(15, countMatches(answer, task.evaluationGuidance.expectedRiskKeywords) * 5);
  reasoning += Math.min(10, countMatches(answer, task.evaluationGuidance.expectedMetricKeywords) * 5);

  const sentences = answer.split(/[.!?]\s+/).filter(Boolean).length;
  if (sentences >= 4) clarity += 5;
  if (answer.length >= 220) clarity += 10;

  const total = clamp(accuracy + reasoning + clarity, 0, 100);
  return {
    total,
    accuracy,
    reasoning,
    clarity,
    strengths: buildStrengths({ accuracy, reasoning, clarity }),
    weaknesses: buildWeaknesses({ accuracy, reasoning, clarity }, 'Tie the chosen feature more directly to the stated problem and define a clearer launch metric.')
  };
}

function evaluateSubmission(role, answer) {
  const task = TASK_LIBRARY[role];
  if (!task) throw new Error('Invalid role');

  switch (role) {
    case 'data_analyst':
      return scoreDataAnalyst(answer, task);
    case 'marketing_associate':
      return scoreMarketing(answer, task);
    case 'product_intern':
      return scoreProduct(answer, task);
    default:
      throw new Error('No evaluator for role');
  }
}

function gradeFromScore(score) {
  if (score >= 85) return 'A';
  if (score >= 70) return 'B';
  if (score >= 55) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

function getQrSessionStatus(session) {
  if (!session) return 'missing';
  if (Date.now() > session.expiresAt) return 'expired';
  return session.status;
}

function pruneQrSessions() {
  const now = Date.now();
  for (const [sessionId, session] of qrSessions.entries()) {
    if (session.expiresAt < now || session.status === 'approved') {
      qrSessions.delete(sessionId);
    }
  }
}

function finalizedAttempts(db) {
  return (db.attempts || []).filter(attempt => ['submitted', 'disqualified', 'expired', 'abandoned'].includes(attempt.status) && attempt.scores);
}

function percentilesForRole(attempts, role) {
  const filtered = attempts
    .filter(attempt => attempt.role === role)
    .sort((a, b) => b.scores.total - a.scores.total || new Date(a.completedAt || a.createdAt) - new Date(b.completedAt || b.createdAt));

  return filtered.map((attempt, index) => {
    const percentile = filtered.length === 1 ? 100 : Math.round(((filtered.length - index - 1) / (filtered.length - 1)) * 100);
    return { id: attempt.id, percentile, rank: index + 1, totalInRole: filtered.length };
  });
}

function findLatestAttemptForRole(db, nric, role) {
  const normalizedNric = normalizeNric(nric);
  return (db.attempts || [])
    .filter(attempt => attempt.nric === normalizedNric && attempt.role === role)
    .sort((a, b) => new Date(b.startedAt || b.createdAt) - new Date(a.startedAt || a.createdAt))[0] || null;
}

function nextEligibleDate(latestAttempt) {
  if (!latestAttempt) return null;
  const base = new Date(latestAttempt.startedAt || latestAttempt.createdAt);
  base.setDate(base.getDate() + RETAKE_LOCK_DAYS);
  return base.toISOString();
}

function canStartAttempt(db, nric, role) {
  const latest = findLatestAttemptForRole(db, nric, role);
  if (!latest) {
    return { allowed: true, nextEligibleAt: null, latestAttempt: null };
  }

  const eligibleAt = nextEligibleDate(latest);
  const allowed = Date.now() >= new Date(eligibleAt).getTime();
  return { allowed, nextEligibleAt: eligibleAt, latestAttempt: latest };
}

function getAttemptOr404(db, attemptId, res) {
  const attempt = (db.attempts || []).find(item => item.id === attemptId);
  if (!attempt) {
    res.status(404).json({ error: 'Assessment attempt not found' });
    return null;
  }
  return attempt;
}

function disqualifyAttempt(db, attempt, reason, status = 'disqualified') {
  if (['submitted', 'disqualified', 'expired', 'abandoned'].includes(attempt.status)) {
    return attempt;
  }

  attempt.status = status;
  attempt.disqualifyReason = reason;
  attempt.completedAt = new Date().toISOString();
  attempt.scores = buildZeroScore(reason);
  attempt.answer = attempt.answer || '';
  return attempt;
}

function ensureAttemptStillOpen(db, attempt) {
  if (attempt.status !== 'in_progress') {
    return attempt.status;
  }

  if (Date.now() > new Date(attempt.expiresAt).getTime()) {
    disqualifyAttempt(db, attempt, 'Assessment expired before submission.', 'expired');
    return attempt.status;
  }

  return attempt.status;
}

function serializeAttemptResult(db, attempt) {
  const allFinalized = finalizedAttempts(db);
  const percentileInfo = percentilesForRole(allFinalized, attempt.role).find(item => item.id === attempt.id) || {
    percentile: null,
    rank: null,
    totalInRole: null
  };
  const scoreBreakdown = attempt.scores || buildZeroScore('No answer submitted.');

  return {
    id: attempt.id,
    candidateCode: attempt.candidateCode,
    nric: attempt.nric,
    role: attempt.role,
    roleLabel: attempt.roleLabel,
    status: attempt.status,
    score: scoreBreakdown.total,
    grade: gradeFromScore(scoreBreakdown.total),
    scoreBreakdown,
    percentile: percentileInfo.percentile,
    rank: percentileInfo.rank,
    totalInRole: percentileInfo.totalInRole,
    startedAt: attempt.startedAt,
    completedAt: attempt.completedAt,
    createdAt: attempt.createdAt,
    expiresAt: attempt.expiresAt,
    disqualifyReason: attempt.disqualifyReason
  };
}

app.get('/api/roles', (req, res) => {
  const roles = Object.entries(TASK_LIBRARY).map(([key, value]) => ({
    key,
    roleLabel: value.roleLabel,
    title: value.title
  }));
  res.json(roles);
});

app.post('/api/singpass-login', (req, res) => {
  const singpassId = String(req.body?.singpassId || '').trim().toLowerCase();
  const password = String(req.body?.password || '');

  if (!singpassId || !password) {
    return res.status(400).json({ error: 'singpassId and password are required' });
  }

  const users = readSingpassUsers();
  const matched = users.find(user =>
    String(user.singpassId || '').trim().toLowerCase() === singpassId
  );

  if (!matched || String(matched.password || '') !== password) {
    return res.status(401).json({ error: 'Invalid Singpass ID or password.' });
  }

  const nric = normalizeNric(matched.nric);
  if (!isValidNric(nric)) {
    return res.status(500).json({ error: 'Configured account NRIC is invalid.' });
  }

  return res.json({
    singpassId: matched.singpassId,
    nric
  });
});

app.get('/api/qr-session/new', (req, res) => {
  pruneQrSessions();

  const sessionId = crypto.randomUUID();
  const expiresAt = Date.now() + QR_SESSION_TTL_MS;
  const approveUrl = `${req.protocol}://${req.get('host')}/api/qr-session/approve/${sessionId}`;

  qrSessions.set(sessionId, {
    sessionId,
    createdAt: Date.now(),
    expiresAt,
    status: 'pending'
  });

  res.json({ sessionId, approveUrl, expiresAt });
});

app.get('/api/qr-session/status/:sessionId', (req, res) => {
  const session = qrSessions.get(req.params.sessionId);
  const status = getQrSessionStatus(session);

  if (status === 'missing') {
    return res.status(404).json({ status: 'missing' });
  }

  if (status === 'expired') {
    qrSessions.delete(req.params.sessionId);
    return res.json({ status: 'expired' });
  }

  return res.json({ status });
});

app.get('/api/qr-session/approve/:sessionId', (req, res) => {
  const session = qrSessions.get(req.params.sessionId);
  const status = getQrSessionStatus(session);

  if (status === 'missing') {
    return res.status(404).send('QR session not found. Please generate a new QR code.');
  }

  if (status === 'expired') {
    qrSessions.delete(req.params.sessionId);
    return res.status(410).send('This QR code has expired. Please generate a new one.');
  }

  session.status = 'approved';
  session.approvedAt = Date.now();

  return res.send('Login approved. You can return to the browser that showed the QR code.');
});

app.get('/api/task/:role', (req, res) => {
  const task = TASK_LIBRARY[req.params.role];
  if (!task) return res.status(404).json({ error: 'Role not found' });

  res.json({
    role: req.params.role,
    roleLabel: task.roleLabel,
    title: task.title,
    instructions: task.instructions,
    dataset: task.dataset,
    durationMinutes: ATTEMPT_DURATION_MINUTES,
    retakeLockDays: RETAKE_LOCK_DAYS
  });
});

app.get('/api/eligibility', (req, res) => {
  const nric = normalizeNric(req.query.nric);
  const role = String(req.query.role || '').trim();

  if (!nric || !role) return res.status(400).json({ error: 'nric and role are required' });
  if (!isValidNric(nric)) return res.status(400).json({ error: 'Enter a valid NRIC or FIN.' });
  if (!TASK_LIBRARY[role]) return res.status(404).json({ error: 'Role not found' });

  const db = readDb();
  const eligibility = canStartAttempt(db, nric, role);
  res.json(eligibility);
});

app.post('/api/start-assessment', (req, res) => {
  const nric = normalizeNric(req.body?.nric);
  const role = String(req.body?.role || '').trim();

  if (!nric || !role) {
    return res.status(400).json({ error: 'nric and role are required' });
  }
  if (!isValidNric(nric)) return res.status(400).json({ error: 'Enter a valid NRIC or FIN.' });
  if (!TASK_LIBRARY[role]) return res.status(404).json({ error: 'Role not found' });

  const db = readDb();
  const eligibility = canStartAttempt(db, nric, role);
  if (!eligibility.allowed) {
    return res.status(403).json({
      error: `This role can only be attempted once every ${RETAKE_LOCK_DAYS} days.`,
      nextEligibleAt: eligibility.nextEligibleAt
    });
  }

  const activeAttempt = (db.attempts || []).find(
    attempt => attempt.nric === nric && attempt.role === role && attempt.status === 'in_progress'
  );
  if (activeAttempt) {
    return res.status(409).json({
      error: 'There is already an active assessment attempt for this role.',
      attemptId: activeAttempt.id,
      expiresAt: activeAttempt.expiresAt
    });
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + ATTEMPT_DURATION_MINUTES * 60 * 1000);
  const attempt = {
    id: crypto.randomUUID(),
    candidateCode: candidateCode(),
    nric,
    name: '',
    email: '',
    role,
    roleLabel: TASK_LIBRARY[role].roleLabel,
    answer: '',
    scores: null,
    startedAt: now.toISOString(),
    completedAt: null,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    status: 'in_progress',
    disqualifyReason: null,
    violations: [],
    lastHeartbeatAt: now.toISOString()
  };

  db.attempts.push(attempt);
  writeDb(db);

  res.json({
    message: 'Assessment started',
    attempt: {
      id: attempt.id,
      candidateCode: attempt.candidateCode,
      nric: attempt.nric,
      role: attempt.role,
      roleLabel: attempt.roleLabel,
      startedAt: attempt.startedAt,
      expiresAt: attempt.expiresAt,
      durationMinutes: ATTEMPT_DURATION_MINUTES
    }
  });
});

app.get('/api/assessment/:attemptId', (req, res) => {
  const db = readDb();
  const attempt = getAttemptOr404(db, req.params.attemptId, res);
  if (!attempt) return;

  const status = ensureAttemptStillOpen(db, attempt);
  if (status !== 'in_progress') {
    writeDb(db);
    return res.status(409).json({ error: `This assessment is already ${attempt.status}.` });
  }

  const task = TASK_LIBRARY[attempt.role];
  if (!task) return res.status(404).json({ error: 'Role not found' });

  writeDb(db);
  res.json({
    attemptId: attempt.id,
    candidateCode: attempt.candidateCode,
    nric: attempt.nric,
    role: attempt.role,
    roleLabel: attempt.roleLabel,
    title: task.title,
    instructions: task.instructions,
    dataset: task.dataset,
    startedAt: attempt.startedAt,
    expiresAt: attempt.expiresAt,
    durationMinutes: ATTEMPT_DURATION_MINUTES
  });
});

app.post('/api/heartbeat', (req, res) => {
  const { attemptId } = req.body || {};
  if (!attemptId) return res.status(400).json({ error: 'attemptId is required' });

  const db = readDb();
  const attempt = getAttemptOr404(db, attemptId, res);
  if (!attempt) return;

  const status = ensureAttemptStillOpen(db, attempt);
  if (status !== 'in_progress') {
    writeDb(db);
    return res.json({ status: attempt.status, expiresAt: attempt.expiresAt });
  }

  attempt.lastHeartbeatAt = new Date().toISOString();
  writeDb(db);
  res.json({ status: attempt.status, expiresAt: attempt.expiresAt });
});

app.post('/api/violation', (req, res) => {
  const { attemptId, reason } = req.body || {};
  if (!attemptId || !reason) return res.status(400).json({ error: 'attemptId and reason are required' });

  const db = readDb();
  const attempt = getAttemptOr404(db, attemptId, res);
  if (!attempt) return;

  if (attempt.status === 'in_progress') {
    attempt.violations.push({ reason, at: new Date().toISOString() });
    disqualifyAttempt(db, attempt, reason, 'disqualified');
    writeDb(db);
  }

  res.json({ message: 'Attempt marked as disqualified', status: attempt.status });
});

app.post('/api/submit-assessment', (req, res) => {
  const { attemptId, answer, aiScores } = req.body || {};
  if (!attemptId) {
    return res.status(400).json({ error: 'attemptId is required' });
  }

  const db = readDb();
  const attempt = getAttemptOr404(db, attemptId, res);
  if (!attempt) return;

  const status = ensureAttemptStillOpen(db, attempt);
  if (status !== 'in_progress') {
    writeDb(db);
    return res.status(409).json({ error: `This assessment is already ${attempt.status}.` });
  }

  const cleanAnswer = String(answer || '').trim();
  let scores;

  if (!cleanAnswer) {
    scores = buildZeroScore('No answer submitted.');
  } else {
    const rule = evaluateSubmission(attempt.role, cleanAnswer);

    if (aiScores) {
      const aiAvg =
        (aiScores.correctness +
          aiScores.reasoning +
          aiScores.clarity +
          aiScores.creativity) / 4;

      let hybridTotal =
      rule.total * 0.6 +
      aiAvg * 0.25 +
      aiScores.specificity * 0.1 -
      aiScores.aiLikelihood * 0.05;

    hybridTotal = Math.round(hybridTotal);

      if (aiScores.aiLikelihood > 80) hybridTotal -= 5;
      if (aiScores.aiLikelihood > 90) hybridTotal -= 10;
      if (aiScores.specificity < 30) hybridTotal -= 5;

      hybridTotal = Math.max(0, Math.min(100, hybridTotal));

      scores = {
        ...rule,
        ai: aiScores,
        total: hybridTotal
      };
    } else {
      scores = rule;
    }
  }

  attempt.answer = cleanAnswer;
  attempt.scores = scores;
  attempt.status = 'submitted';
  attempt.completedAt = new Date().toISOString();
  writeDb(db);

  res.json({
    message: 'Submission received',
    submission: serializeAttemptResult(db, attempt)
  });
});

app.get('/api/result/:attemptId', (req, res) => {
  const db = readDb();
  const attempt = getAttemptOr404(db, req.params.attemptId, res);
  if (!attempt) return;

  ensureAttemptStillOpen(db, attempt);
  writeDb(db);

  if (!attempt.scores) {
    return res.status(409).json({ error: 'Assessment is still in progress.' });
  }

  res.json(serializeAttemptResult(db, attempt));
});

app.get('/api/leaderboard/:role', (req, res) => {
  const role = req.params.role;
  if (!TASK_LIBRARY[role]) return res.status(404).json({ error: 'Role not found' });

  const db = readDb();
  const finalAttempts = finalizedAttempts(db);
  const enriched = percentilesForRole(finalAttempts, role).map(info => {
    const attempt = finalAttempts.find(item => item.id === info.id);
    return {
      candidateCode: attempt.candidateCode,
      roleLabel: attempt.roleLabel,
      score: attempt.scores.total,
      grade: gradeFromScore(attempt.scores.total),
      percentile: info.percentile,
      rank: info.rank,
      strengths: attempt.scores.strengths,
      submittedAt: attempt.completedAt || attempt.createdAt,
      status: attempt.status
    };
  });

  res.json(enriched);
});

app.get('/api/recruiter/:role', (req, res) => {
  const role = req.params.role;
  if (!TASK_LIBRARY[role]) return res.status(404).json({ error: 'Role not found' });

  const db = readDb();
  const finalAttempts = finalizedAttempts(db);
  const enriched = percentilesForRole(finalAttempts, role).map(info => {
    const attempt = finalAttempts.find(item => item.id === info.id);
    return {
      candidateCode: attempt.candidateCode,
      roleLabel: attempt.roleLabel,
      score: attempt.scores.total,
      grade: gradeFromScore(attempt.scores.total),
      percentile: info.percentile,
      strengths: attempt.scores.strengths,
      weaknesses: attempt.scores.weaknesses,
      scoreBreakdown: attempt.scores,
      submittedAt: attempt.completedAt || attempt.createdAt,
      status: attempt.status,
      disqualifyReason: attempt.disqualifyReason
    };
  });

  res.json(enriched);
});

app.get('/api/my-submissions', (req, res) => {
  const nric = normalizeNric(req.query.nric);
  if (!nric) return res.status(400).json({ error: 'nric is required' });

  const db = readDb();
  const finalAttempts = finalizedAttempts(db);
  const matched = finalAttempts.filter(attempt => attempt.nric === nric);

  const payload = matched
    .map(attempt => serializeAttemptResult(db, attempt))
    .sort((a, b) => new Date(b.completedAt || b.createdAt) - new Date(a.completedAt || a.createdAt));

  res.json(payload);
});

app.get('/api/employer-feed', (req, res) => {
  const db = readDb();

  const valid = (db.attempts || [])
    .filter(a =>
      a.status === 'submitted' &&
      a.scores &&
      typeof a.scores.total === 'number' &&
      a.scores.total >= 40 &&                 // remove low quality
      a.answer &&
      a.answer.trim().length > 30             // remove junk answers
    );

  valid.sort((a, b) => b.scores.total - a.scores.total);

  const result = valid.slice(0, 10).map(a => ({
    id: a.id,
    candidateCode: a.candidateCode,
    role: a.roleLabel,
    score: a.scores?.total ?? 0,
    grade: gradeFromScore(a.scores?.total ?? 0),
    answer: a.answer
  }));

  res.json(result);
});

app.post('/api/shortlist', (req, res) => {
  const { attemptId } = req.body;

  if (!attemptId) {
    return res.status(400).json({ error: 'attemptId is required' });
  }

  const db = readDb();

  const attempt = db.attempts.find(a => a.id === attemptId);
  if (!attempt) {
    return res.status(404).json({ error: 'Candidate not found' });
  }

  if (!db.shortlisted.includes(attemptId)) {
    db.shortlisted.push(attemptId);
  }

  writeDb(db);

  res.json({ message: 'Candidate shortlisted' });
});

app.get('/api/shortlisted', (req, res) => {
  const db = readDb();

  const shortlisted = (db.shortlisted || [])
    .map(id => db.attempts.find(a => a.id === id))
    .filter(Boolean)
    .map(a => ({
    id: a.id,
    candidateCode: a.candidateCode,
    role: a.roleLabel,
    score: a.scores?.total ?? 0,
    grade: gradeFromScore(a.scores?.total ?? 0),
    answer: a.answer
  }));

  res.json(shortlisted);
});

app.post('/api/evaluate', async (req, res) => {
  const { answer, role, instructions, dataset } = req.body;

  if (!answer || typeof answer !== "string") {
    return res.status(400).json({ error: "answer is required" });
  }

  try {
    const API_KEY = process.env.KEY;

    const prompt = `
    You are evaluating a candidate's answer.

    ROLE:
    ${role}

    TASK:
    ${instructions}

    DATASET:
    ${JSON.stringify(dataset, null, 2)}

    CANDIDATE ANSWER:
    ${answer}

    Score from 0–100:
    - correctness (did they answer the task correctly?)
    - reasoning (quality of thinking)
    - clarity (structured, readable)
    - creativity (insightfulness)

    Also estimate:
    - aiLikelihood (0–100)
    - specificity (0–100)

    Return ONLY valid JSON.
    No markdown.
    No backticks.
    No explanation.
    No extra text before or after.
    {
      "correctness": number,
      "reasoning": number,
      "clarity": number,
      "creativity": number,
      "aiLikelihood": number,
      "specificity": number,
      "summary": "short feedback"
    }



`;

  const data = await callGemini(prompt);

    const rawText =
      data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    
    let parsed;

    try {
      const rawText =
        data.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!rawText) {
        throw new Error("Empty AI response");
      }

      parsed = JSON.parse(rawText);

    } catch (e) {
      console.log("FULL AI RESPONSE:\n", JSON.stringify(data, null, 2));

      parsed = {
        correctness: 50,
        reasoning: 50,
        clarity: 50,
        creativity: 50,
        aiLikelihood: 50,
        specificity: 50,
        summary: "AI response parsing failed"
      };
    }
    const clamp = (v) => Math.max(0, Math.min(100, Number(v) || 0));

    res.json({
      correctness: clamp(parsed.correctness),
      reasoning: clamp(parsed.reasoning),
      clarity: clamp(parsed.clarity),
      creativity: clamp(parsed.creativity),
      aiLikelihood: clamp(parsed.aiLikelihood),
      specificity: clamp(parsed.specificity),
      summary: parsed.summary || ""
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/html/login.html'));
});

app.get('/start', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/html/start.html'));
});

app.get('/employer', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/html/employer.html'));
});


ensureDb();
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
