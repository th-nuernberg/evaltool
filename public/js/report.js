'use strict';

// ── Printable instructor report (R7) ─────────────────────────────────────────
// Builds a self-contained HTML document (inline CSS) the instructor opens and
// prints to PDF. Exposed as `Report`.

window.Report = (function () {
  // The four didactic dimensions, in report order. Shared with the dashboard.
  const DIMENSIONS = [
    { key: 'lehrinhalte', promptKey: 'conclusion_lehrinhalte', title: 'Lehrinhalte' },
    { key: 'strukturierung', promptKey: 'conclusion_strukturierung', title: 'Strukturierung der Lehrinhalte' },
    { key: 'darbietung', promptKey: 'conclusion_darbietung', title: 'Darbietung der Lehrinhalte' },
    { key: 'workload', promptKey: 'conclusion_workload', title: 'Workload der Studierenden' },
  ];

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatDate(ts) {
    const d = new Date(ts || Date.now());
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
  }

  function likertTableRows(session) {
    const likerts = (session.questions || []).filter((q) => q.type === 'likert');
    if (!likerts.length) return '';
    const rows = likerts.map((q) => {
      const s = window.Charts.likertStats(q, session.responses || []);
      return `<tr><td>${esc(q.text)}</td><td class="num">${s.n}</td>` +
        `<td class="num">${window.Charts.fmt(s.mean)}</td>` +
        `<td class="num">${window.Charts.fmt(s.median)}</td></tr>`;
    }).join('');
    return `
      <h2>Anhang A — Überblick Likert-Skalen</h2>
      <table class="lk">
        <thead><tr><th>Frage</th><th class="num">n</th><th class="num">Mittelwert</th><th class="num">Median</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="hint">Skala jeweils 1 (niedrigste Zustimmung) bis Maximum; höhere Werte = mehr Zustimmung.</p>`;
  }

  // An analysis entry is { prompt, result }; include only successful summaries.
  function summaryText(entry) {
    return entry && entry.result && entry.result.available ? entry.result.text : null;
  }
  function summariesSection(session) {
    const a = session.analysis || {};
    const blocks = [];
    const ff = summaryText(a.freeform);
    if (ff) {
      blocks.push(`<h3>Allgemeine Freitext-Rückmeldungen</h3><div class="pre">${esc(ff)}</div>`);
    }
    const tap = a.tap || {};
    const tapTitles = {
      tap_lernfoerderlich: 'Lernförderlich',
      tap_erschwert: 'Lernerschwerend',
      tap_verbesserung: 'Verbesserungsvorschläge',
    };
    for (const k of Object.keys(tapTitles)) {
      const t = summaryText(tap[k]);
      if (t) blocks.push(`<h3>TAP — ${esc(tapTitles[k])}</h3><div class="pre">${esc(t)}</div>`);
    }
    if (!blocks.length) return '';
    return `<h2>Anhang B — Zusammenfassungen der Freitexte</h2>${blocks.join('')}`;
  }

  function buildReportHTML(session) {
    const digest = session.digest || {};
    const conclusions = digest.conclusions || {};
    const participants = (session.responses || []).length;
    const date = formatDate(session.closedAt || session.createdAt);

    const conclusionsHtml = DIMENSIONS.map((d, i) => {
      const text = (conclusions[d.key] || '').trim();
      return `<section class="concl">
        <h2>${i + 1}. ${esc(d.title)}</h2>
        <div class="pre">${text ? esc(text) : '<em>(keine Schlussfolgerung erfasst)</em>'}</div>
      </section>`;
    }).join('');

    const note = (digest.note || '').trim();
    const noteHtml = note
      ? `<section class="note"><h2>Anmerkung</h2><div class="pre">${esc(note)}</div></section>`
      : '';

    return `<!DOCTYPE html>
<html lang="de"><head><meta charset="utf-8" />
<title>Evaluationsbericht — ${esc(session.title)}</title>
<style>
  :root { --ink:#1c2530; --muted:#5e6b7a; --line:#d4dbe2; --brand:#0b5e8a; }
  * { box-sizing: border-box; }
  body { font-family: Georgia, "Times New Roman", serif; color: var(--ink); line-height: 1.55; max-width: 800px; margin: 2rem auto; padding: 0 1.5rem; }
  h1 { font-size: 1.6rem; margin: 0 0 0.25rem; }
  h2 { font-size: 1.15rem; margin: 1.4rem 0 0.3rem; color: #102733; border-bottom: 1px solid var(--line); padding-bottom: 0.2rem; }
  h3 { font-size: 1rem; margin: 1rem 0 0.2rem; }
  .meta { margin: 0.5rem 0 1rem; }
  .meta table { border-collapse: collapse; }
  .meta td { padding: 0.15rem 0.8rem 0.15rem 0; }
  .meta td.k { color: var(--muted); }
  .pre { white-space: pre-wrap; }
  .concl { margin: 0.6rem 0; }
  table.lk { width: 100%; border-collapse: collapse; font-family: system-ui, sans-serif; font-size: 0.9rem; }
  table.lk th, table.lk td { border: 1px solid var(--line); padding: 0.35rem 0.5rem; text-align: left; }
  table.lk td.num, table.lk th.num { text-align: right; white-space: nowrap; }
  .hint { color: var(--muted); font-size: 0.82rem; font-family: system-ui, sans-serif; }
  .toolbar { font-family: system-ui, sans-serif; margin-bottom: 1rem; }
  .toolbar button { font: inherit; cursor: pointer; padding: 0.5rem 1rem; border-radius: 8px; border: 1px solid var(--brand); background: var(--brand); color: #fff; }
  footer { margin-top: 2rem; color: var(--muted); font-size: 0.8rem; font-family: system-ui, sans-serif; border-top: 1px solid var(--line); padding-top: 0.6rem; }
  @media print { .toolbar { display: none; } body { margin: 0; max-width: none; } }
</style></head>
<body>
  <div class="toolbar"><button onclick="window.print()">Als PDF drucken / speichern</button></div>
  <h1>Evaluationsbericht</h1>
  <div class="meta"><table>
    <tr><td class="k">Lehrveranstaltung</td><td>${esc(session.title)}</td></tr>
    <tr><td class="k">Semester</td><td>${esc(session.term)}</td></tr>
    <tr><td class="k">Datum der Befragung</td><td>${esc(date)}</td></tr>
    <tr><td class="k">Teilnehmende</td><td>${participants}</td></tr>
  </table></div>

  <h1 style="font-size:1.25rem;margin-top:1.5rem">Schlussfolgerungen</h1>
  ${conclusionsHtml}
  ${noteHtml}
  ${likertTableRows(session)}
  ${summariesSection(session)}

  <footer>
    Erstellt mit evaltool · Teaching Analysis Poll · anonyme Befragung ·
    Die Schlussfolgerungen wurden von der Lehrperson geprüft und überarbeitet.
  </footer>
</body></html>`;
  }

  function openReport(session) {
    const html = buildReportHTML(session);
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  function reportFilename(session) {
    const date = new Date(session.closedAt || session.createdAt || Date.now()).toISOString().slice(0, 10);
    return `Bericht_${window.Store.sanitizeFilename(session.title)}_${window.Store.sanitizeFilename(session.term)}_${date}.html`;
  }

  function downloadReport(session) {
    window.Store.download(reportFilename(session), buildReportHTML(session), 'text/html');
  }

  return { DIMENSIONS, buildReportHTML, openReport, downloadReport, formatDate };
})();
