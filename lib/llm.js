'use strict';

/**
 * Thin client for an OpenAI-compatible chat-completions endpoint (e.g. vLLM),
 * with a graceful fallback (R3). If the endpoint is not configured or a request
 * fails for any reason, callers receive { available: false, message: "LLM not
 * available at present" } instead of an exception, so the app never breaks.
 */

const FALLBACK_MESSAGE = 'LLM not available at present';

function num(envVal, fallback) {
  const n = Number(envVal);
  return Number.isFinite(n) ? n : fallback;
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
    if (process.env.LLM_API_KEY) {
      headers.Authorization = `Bearer ${process.env.LLM_API_KEY}`;
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
