'use strict';

/**
 * Thin client for an OpenAI-compatible chat-completions endpoint (e.g. vLLM),
 * with a graceful fallback (R3). If the endpoint is not configured or a request
 * fails for any reason, callers receive { available: false, message: "LLM not
 * available at present" } instead of an exception, so the app never breaks.
 */

const fs = require('fs');
const path = require('path');

// For local runs (`make dev`/`npm start`) a credentials file at the project root
// is auto-detected, so dropping in `.llmcredentials` is enough — no env wiring
// needed. In Docker, LLM_API_KEY_FILE is set explicitly and takes precedence.
const LOCAL_CREDS_FILE = path.join(__dirname, '..', '.llmcredentials');

const FALLBACK_MESSAGE = 'LLM not available at present';

function num(envVal, fallback) {
  const n = Number(envVal);
  return Number.isFinite(n) ? n : fallback;
}

// Resolve the LLM API token. Either LLM_API_KEY (inline) or LLM_API_KEY_FILE
// (path to a file holding the token) may be set; the Docker deployment
// bind-mounts `.llmcredentials` and points LLM_API_KEY_FILE at it. The file may
// include `#` comment / blank lines — the first real line is used. Memoized, so
// rotating the token requires a restart.
let cachedKey;
let keyResolved = false;
function apiKey() {
  if (keyResolved) return cachedKey;
  keyResolved = true;
  const inline = process.env.LLM_API_KEY;
  if (inline && inline.trim()) {
    cachedKey = inline.trim();
    return cachedKey;
  }
  const file = process.env.LLM_API_KEY_FILE
    || (fs.existsSync(LOCAL_CREDS_FILE) ? LOCAL_CREDS_FILE : undefined);
  if (file) {
    try {
      for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
        const t = line.trim();
        if (t && !t.startsWith('#')) { cachedKey = t; break; }
      }
      if (!cachedKey) console.error(`[evaltool] LLM_API_KEY_FILE (${file}) holds no token.`);
    } catch (err) {
      console.error(`[evaltool] cannot read LLM_API_KEY_FILE (${file}): ${err.message}`);
    }
  }
  return cachedKey;
}

/** True when enough is configured to attempt a real call. */
function isConfigured() {
  return Boolean(process.env.LLM_BASE_URL && process.env.LLM_MODEL);
}

/**
 * Run a single system+user completion.
 * @param {{system: string, user: string}} args
 * @returns {Promise<{available: true, text: string} | {available: false, message: string, error?: string}>}
 */
async function complete({ system, user }) {
  if (!isConfigured()) {
    return { available: false, message: FALLBACK_MESSAGE };
  }

  const base = String(process.env.LLM_BASE_URL).replace(/\/+$/, '');
  const url = `${base}/chat/completions`;
  const timeoutMs = num(process.env.LLM_TIMEOUT_MS, 60000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers = { 'Content-Type': 'application/json' };
    const key = apiKey();
    if (key) {
      headers.Authorization = `Bearer ${key}`;
    }
    const res = await fetch(url, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model: process.env.LLM_MODEL,
        temperature: num(process.env.LLM_TEMPERATURE, 0.3),
        max_tokens: num(process.env.LLM_MAX_TOKENS, 800),
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });

    if (!res.ok) {
      return { available: false, message: FALLBACK_MESSAGE, error: `HTTP ${res.status}` };
    }
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content?.trim();
    if (!text) {
      return { available: false, message: FALLBACK_MESSAGE, error: 'empty completion' };
    }
    return { available: true, text };
  } catch (err) {
    const reason = err && err.name === 'AbortError' ? 'timeout' : String((err && err.message) || err);
    return { available: false, message: FALLBACK_MESSAGE, error: reason };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { complete, isConfigured, FALLBACK_MESSAGE };
