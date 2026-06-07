'use strict';

// ── Client-only persistence (R5) ─────────────────────────────────────────────
// All collected responses live here, in the instructor's browser localStorage.
// Exposed as a global `Store`.

window.Store = (function () {
  const PREFIX = 'evaltool:session:';
  const keyOf = (id) => PREFIX + id;

  function saveSession(s) {
    localStorage.setItem(keyOf(s.sessionId), JSON.stringify(s));
  }
  function loadSession(id) {
    const raw = localStorage.getItem(keyOf(id));
    return raw ? JSON.parse(raw) : null;
  }
  function deleteSession(id) {
    localStorage.removeItem(keyOf(id));
  }
  function listSessions() {
    const out = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX)) {
        try {
          const s = JSON.parse(localStorage.getItem(k));
          out.push({
            sessionId: s.sessionId,
            title: s.title,
            term: s.term,
            createdAt: s.createdAt,
            closedAt: s.closedAt || null,
            count: (s.responses || []).length,
          });
        } catch (_) { /* ignore corrupt entry */ }
      }
    }
    return out.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  /** Append a response unless its responseId is already present. Returns count. */
  function addResponse(id, response) {
    const s = loadSession(id);
    if (!s) return 0;
    s.responses = s.responses || [];
    if (!s.responses.some((r) => r.responseId === response.responseId)) {
      s.responses.push(response);
      saveSession(s);
    }
    return s.responses.length;
  }

  // ── CSV export ──────────────────────────────────────────────────────────────
  function csvCell(v) {
    const str = v === null || v === undefined ? '' : String(v);
    return /[",\n;]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str;
  }

  function toCSV(session) {
    const questions = session.questions || [];
    const header = ['#', ...questions.map((q) => q.text)];
    const rows = [header.map(csvCell).join(',')];
    (session.responses || []).forEach((r, i) => {
      const cells = [i + 1];
      for (const q of questions) {
        const v = r.answers ? r.answers[q.id] : undefined;
        if (q.type === 'likert') {
          cells.push(v === null || v === undefined ? '' : Number(v) + 1); // 1-based value
        } else {
          cells.push(v || '');
        }
      }
      rows.push(cells.map(csvCell).join(','));
    });
    return '﻿' + rows.join('\r\n'); // BOM for Excel UTF-8
  }

  function sanitizeFilename(s) {
    return String(s || '').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'evaluation';
  }

  function csvFilename(session) {
    const date = new Date(session.closedAt || session.createdAt || Date.now())
      .toISOString().slice(0, 10);
    return `TAP_${sanitizeFilename(session.title)}_${sanitizeFilename(session.term)}_${date}.csv`;
  }

  function download(filename, text, mime) {
    const blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return {
    saveSession, loadSession, deleteSession, listSessions, addResponse,
    toCSV, csvFilename, sanitizeFilename, download,
  };
})();
