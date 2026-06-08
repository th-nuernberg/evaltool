'use strict';

require('dotenv').config();

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const QRCode = require('qrcode');

const { computeTerm } = require('./lib/term');
const { loadQuestionSets, loadPrompts } = require('./lib/config');
const llm = require('./lib/llm');

// ── Configuration loaded once at startup (fails fast on misconfiguration) ─────
const PORT = Number(process.env.PORT) || 3000;
const HOST_KEY = (process.env.HOST_KEY || '').trim();
const PUBLIC_DIR = path.join(__dirname, 'public');

// URL prefix for hosting behind a reverse proxy (e.g. https://host/evaltool).
// Configurable via BASE_PATH; defaults to "evaltool". Normalised to "" (root)
// or "/evaltool" (leading slash, no trailing slash). The reverse proxy must
// forward the prefix to the app — it is NOT stripped.
function normalizeBasePath(raw) {
  const p = String(raw == null ? 'evaltool' : raw).trim().replace(/^\/+|\/+$/g, '');
  return p ? `/${p}` : '';
}
const BASE_PATH = normalizeBasePath(process.env.BASE_PATH);

let QUESTION_SETS;
let PROMPTS;
try {
  QUESTION_SETS = loadQuestionSets();
  PROMPTS = loadPrompts();
} catch (err) {
  console.error('[evaltool] Configuration error:', err.message);
  process.exit(1);
}
console.log(
  `[evaltool] Loaded ${QUESTION_SETS.size} question set(s): ${[...QUESTION_SETS.keys()].join(', ')}`
);
console.log(`[evaltool] LLM ${llm.isConfigured() ? 'configured' : 'NOT configured (fallback active)'}`);
console.log(`[evaltool] base path: ${BASE_PATH || '/'} (set BASE_PATH to change)`);

// ── Ephemeral, in-memory session registry ────────────────────────────────────
// A session holds the poll CONFIG and a live participant COUNT only. Response
// content is never stored here — it is relayed straight to the host's browser
// (R5 / "no server side cache"). `seen` holds opaque responseIds for idempotent
// counting; these are random ids, not personal data, and are dropped on close.
const sessions = new Map(); // sessionId -> session

const MAX_FREEFORM = 5000;
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // sweep abandoned sessions after 8h

function newSessionId() {
  let id;
  do {
    id = crypto.randomBytes(6).toString('hex');
  } while (sessions.has(id));
  return id;
}

function hostKeyOk(provided) {
  if (!HOST_KEY) return true; // open instance (dev)
  return typeof provided === 'string' && provided === HOST_KEY;
}

function sessionHasHost(s) {
  return s && s.hosts.size > 0;
}

/**
 * Validate & sanitise a submitted answer set against a session's questions.
 * Returns a cleaned object containing only known questions with valid values,
 * or null if the payload is structurally invalid. This both protects the host
 * browser from injected payloads and keeps stored data well-formed.
 */
function cleanAnswers(answers, questions) {
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return null;
  const out = {};
  for (const q of questions) {
    if (!(q.id in answers)) continue;
    const v = answers[q.id];
    if (v === null || v === undefined || v === '') continue;
    if (q.type === 'likert') {
      const idx = Number(v);
      if (!Number.isInteger(idx) || idx < 0 || idx >= q.labels.length) return null;
      out[q.id] = idx;
    } else if (q.type === 'freeform') {
      if (typeof v !== 'string') return null;
      const text = v.trim();
      if (text) out[q.id] = text.slice(0, MAX_FREEFORM);
    }
  }
  return out;
}

// ── HTML pages: render once with the base path baked in ───────────────────────
// Root-absolute asset/link URLs ("/css", "/js", "/socket.io", "/host", …) get the
// prefix; the base path is exposed to client scripts via window.BASE_PATH.
const PAGES = {};
for (const file of ['index.html', 'host.html', 'privacy.html', 'eval.html']) {
  let html = fs.readFileSync(path.join(PUBLIC_DIR, file), 'utf8');
  if (BASE_PATH) html = html.replace(/(href|src)="\//g, `$1="${BASE_PATH}/`);
  html = html.replace(
    '</head>',
    `  <script>window.BASE_PATH=${JSON.stringify(BASE_PATH)};</script>\n</head>`
  );
  PAGES[file] = html;
}
function sendPage(res, file) {
  res.type('html').send(PAGES[file]);
}

// ── Express app ───────────────────────────────────────────────────────────────
const app = express();
app.set('trust proxy', true); // honour X-Forwarded-* from the reverse proxy
app.use(express.json({ limit: '256kb' }));

// All routes live on a router mounted under BASE_PATH, so the whole app can sit
// behind a reverse-proxy sub-path (e.g. https://host/evaltool).
const router = express.Router();

// Clean page routes (HTML rendered with the prefix; other assets via static below).
router.get('/', (req, res) => sendPage(res, 'index.html'));
router.get('/host', (req, res) => sendPage(res, 'host.html'));
router.get('/privacy', (req, res) => sendPage(res, 'privacy.html'));
router.get('/eval/:sessionId', (req, res) => sendPage(res, 'eval.html'));

// Metadata for the host dashboard: default term, available question sets, flags.
router.get('/api/meta', (req, res) => {
  res.json({
    today: new Date().toISOString().slice(0, 10),
    defaultTerm: computeTerm(new Date()),
    hostKeyRequired: Boolean(HOST_KEY),
    llmConfigured: llm.isConfigured(),
    questionSets: [...QUESTION_SETS.values()].map((s) => ({
      id: s.id,
      title: s.title,
      description: s.description,
    })),
    // Default system prompts so the dashboard can show (and let the lecturer
    // edit) the prompt next to each AI summary. These are didactic defaults,
    // not secrets (they also live in config/prompts.yaml).
    prompts: Object.fromEntries([...PROMPTS].map(([k, v]) => [k, v.system])),
  });
});

// Validate a host key without side effects — lets the dashboard "unlock" up
// front and give immediate feedback before a poll is created (R1).
router.post('/api/verify-key', (req, res) => {
  res.json({ valid: hostKeyOk((req.body || {}).hostKey) });
});

// Create a poll session. Guarded by HOST_KEY when configured (R1 anti-abuse).
router.post('/api/session', (req, res) => {
  const { title, term, questionSetId, hostKey } = req.body || {};
  if (!hostKeyOk(hostKey)) {
    return res.status(403).json({ error: 'Ungültiger oder fehlender Zugangsschlüssel.' });
  }
  if (!title || typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ error: 'Bitte einen Namen für die Evaluation angeben.' });
  }
  const set = QUESTION_SETS.get(String(questionSetId));
  if (!set) {
    return res.status(400).json({ error: 'Unbekannter Fragebogen.' });
  }

  const sessionId = newSessionId();
  const hostToken = crypto.randomBytes(24).toString('hex');
  const resolvedTerm =
    term && typeof term === 'string' && term.trim() ? term.trim() : computeTerm(new Date());

  sessions.set(sessionId, {
    sessionId,
    hostToken,
    title: title.trim(),
    term: resolvedTerm,
    questionSetId: set.id,
    questions: set.questions,
    open: true,
    count: 0,
    seen: new Set(),
    hosts: new Set(),
    createdAt: Date.now(),
    lastActivity: Date.now(),
  });

  res.json({
    sessionId,
    hostToken,
    title: title.trim(),
    term: resolvedTerm,
    questionSetTitle: set.title,
    questions: set.questions,
  });
});

// Render a QR code (PNG data URL) for an arbitrary string (the student link).
router.get('/api/qr', async (req, res) => {
  const data = req.query.data;
  if (!data || typeof data !== 'string') {
    return res.status(400).json({ error: 'missing data' });
  }
  try {
    const dataUrl = await QRCode.toDataURL(data, { margin: 1, width: 320 });
    res.json({ dataUrl });
  } catch (err) {
    res.status(500).json({ error: 'qr failed' });
  }
});

// LLM proxy: inject the server-side system prompt for :promptKey (R3/R6).
router.post('/api/llm/:promptKey', async (req, res) => {
  const { input, hostKey, system } = req.body || {};
  if (!hostKeyOk(hostKey)) {
    return res.status(403).json({ error: 'Ungültiger oder fehlender Zugangsschlüssel.' });
  }
  const prompt = PROMPTS.get(req.params.promptKey);
  if (!prompt) {
    return res.status(404).json({ error: 'Unbekannter Prompt.' });
  }
  if (typeof input !== 'string' || !input.trim()) {
    // Nothing to summarise — report gracefully rather than calling the LLM.
    return res.json({ available: false, message: 'Keine auswertbaren Antworten vorhanden.' });
  }
  // Use the lecturer's edited prompt when supplied, otherwise the configured default.
  const sys = typeof system === 'string' && system.trim() ? system.slice(0, 20000) : prompt.system;
  const result = await llm.complete({ system: sys, user: input.slice(0, 60000) });
  res.json(result);
});

router.use(express.static(PUBLIC_DIR));
router.use((req, res) => res.status(404).send('Not found'));

// Mount everything under the prefix. A bare "/" redirects into the app so the
// root still works when reached directly (not via the proxy sub-path).
app.use(BASE_PATH || '/', router);
if (BASE_PATH) {
  app.get('/', (req, res) => res.redirect(`${BASE_PATH}/`));
  app.use((req, res) => res.status(404).send('Not found'));
}

// ── Socket.io: synchronous live relay (no response content retained) ──────────
const server = http.createServer(app);
const io = new Server(server, { path: `${BASE_PATH}/socket.io` });

io.on('connection', (socket) => {
  let role = null; // 'host' | 'student'
  let joinedSession = null;

  socket.on('host-attach', ({ sessionId, hostToken } = {}) => {
    const s = sessions.get(sessionId);
    if (!s || s.hostToken !== hostToken) {
      socket.emit('host-attach-failed', { reason: 'not-found' });
      return;
    }
    role = 'host';
    joinedSession = sessionId;
    const wasUnhosted = !sessionHasHost(s);
    s.hosts.add(socket.id);
    s.lastActivity = Date.now();
    socket.join(`host:${sessionId}`);
    socket.emit('host-attached', { count: s.count, open: s.open });
    if (wasUnhosted && s.open) {
      io.to(`students:${sessionId}`).emit('eval-resumed');
    }
  });

  socket.on('host-end', ({ sessionId, hostToken } = {}) => {
    const s = sessions.get(sessionId);
    if (!s || s.hostToken !== hostToken) return;
    s.open = false;
    io.to(`students:${sessionId}`).emit('eval-closed');
    socket.emit('host-ended', { count: s.count });
    // Drop config + ids; nothing of substance remains.
    sessions.delete(sessionId);
  });

  // Student participation is intentionally UNAUTHENTICATED — the poll page
  // (/eval/:sessionId) must never be gated by HOST_KEY. Anyone with the link can
  // answer anonymously; HOST_KEY only guards host actions (create poll, LLM,
  // verify-key). Do NOT add a hostKeyOk() check to student-join/submit-response.
  socket.on('student-join', ({ sessionId } = {}) => {
    const s = sessions.get(sessionId);
    role = 'student';
    joinedSession = sessionId;
    socket.join(`students:${sessionId}`);
    if (!s || !s.open) {
      socket.emit('eval-unavailable', { reason: 'closed' });
      return;
    }
    if (!sessionHasHost(s)) {
      socket.emit('eval-unavailable', { reason: 'paused' });
      return;
    }
    socket.emit('eval-config', {
      title: s.title,
      term: s.term,
      questions: s.questions,
      count: s.count,
    });
  });

  socket.on('submit-response', ({ sessionId, responseId, answers } = {}, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    const s = sessions.get(sessionId);
    if (!s || !s.open) return reply({ ok: false, reason: 'closed' });
    if (!sessionHasHost(s)) return reply({ ok: false, reason: 'paused' });
    if (typeof responseId !== 'string' || responseId.length < 1 || responseId.length > 64) {
      return reply({ ok: false, reason: 'bad-id' });
    }
    if (s.seen.has(responseId)) {
      // Idempotent: a retransmit of an already-counted response.
      return reply({ ok: true, duplicate: true });
    }
    const clean = cleanAnswers(answers, s.questions);
    if (clean === null) return reply({ ok: false, reason: 'invalid' });

    s.seen.add(responseId);
    s.count += 1;
    s.lastActivity = Date.now();
    // Relay to the host browser, which persists it to localStorage. The server
    // keeps no copy of `clean` beyond this synchronous emit.
    io.to(`host:${sessionId}`).emit('new-response', {
      responseId,
      answers: clean,
      at: new Date().toISOString(),
    });
    io.to(`students:${sessionId}`).to(`host:${sessionId}`).emit('participant-count', { count: s.count });
    reply({ ok: true });
  });

  socket.on('disconnect', () => {
    if (role === 'host' && joinedSession) {
      const s = sessions.get(joinedSession);
      if (s) {
        s.hosts.delete(socket.id);
        if (!sessionHasHost(s) && s.open) {
          io.to(`students:${joinedSession}`).emit('eval-paused');
        }
      }
    }
  });
});

// Start the server (and the cleanup sweep) only when run directly, so the
// module can be required in tests without binding a port.
if (require.main === module) {
  // Periodically sweep abandoned sessions so memory cannot grow unbounded.
  setInterval(() => {
    const now = Date.now();
    for (const [id, s] of sessions) {
      if (now - s.lastActivity > SESSION_TTL_MS) sessions.delete(id);
    }
  }, 30 * 60 * 1000).unref();

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[evaltool] Port ${PORT} is already in use. Stop the other process, or pick another port: PORT=3001 make dev`);
    } else {
      console.error('[evaltool] Server error:', err.message);
    }
    process.exit(1);
  });
  server.listen(PORT, () => {
    console.log(`[evaltool] listening on http://localhost:${PORT}${BASE_PATH}/`);
    // Probe the LLM once we're up (advisory — never blocks startup or crashes).
    if (llm.isConfigured()) {
      llm.checkHealth().then((h) => {
        if (h.ok) {
          console.log(`[evaltool] LLM reachable — ${h.model} @ ${h.url}`);
        } else {
          console.error('[evaltool] LLM NOT reachable — AI summaries will use the fallback until this is fixed:');
          console.error(`[evaltool]   endpoint: ${h.url}`);
          console.error(`[evaltool]   model:    ${h.model}`);
          console.error(`[evaltool]   auth:     ${h.hasKey ? 'bearer token sent' : 'NO token sent (set LLM_API_KEY or provide .llmcredentials)'}`);
          console.error(`[evaltool]   error:    ${h.error}`);
        }
      });
    }
  });
}

module.exports = { app, cleanAnswers }; // exported for tests
