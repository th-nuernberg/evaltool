'use strict';

// ── Instructor dashboard ─────────────────────────────────────────────────────
// Drives the four stages: setup → collect (live relay into localStorage) →
// analyze (charts + LLM) → digest (revise four conclusions → report).

(function () {
  const $ = (id) => document.getElementById(id);
  const show = (el) => el && el.classList.remove('hidden');
  const hide = (el) => el && el.classList.add('hidden');

  const HOSTKEY_LS = 'evaltool:hostkey';
  let meta = null;
  let hostKey = localStorage.getItem(HOSTKEY_LS) || '';
  let current = null; // active session object (mirrors localStorage)
  let socket = null;

  // ── View / step management ──────────────────────────────────────────────────
  const VIEWS = ['setup', 'collect', 'analyze', 'digest'];
  function showView(name) {
    VIEWS.forEach((v) => (v === name ? show($(`view-${v}`)) : hide($(`view-${v}`))));
    const order = VIEWS.indexOf(name);
    document.querySelectorAll('#steps li').forEach((li) => {
      const i = VIEWS.indexOf(li.dataset.step);
      li.classList.toggle('active', i === order);
      li.classList.toggle('done', i < order);
    });
    window.scrollTo(0, 0);
  }

  function ensureShape(s) {
    s.responses = s.responses || [];
    s.analysis = s.analysis || { freeform: null, tap: {} };
    s.analysis.tap = s.analysis.tap || {};
    s.digest = s.digest || { conclusions: {}, note: '', reviewed: {} };
    s.digest.conclusions = s.digest.conclusions || {};
    s.digest.reviewed = s.digest.reviewed || {};
    return s;
  }
  function saveCurrent() { if (current) window.Store.saveSession(current); }

  // ── Init ────────────────────────────────────────────────────────────────────
  async function init() {
    try {
      meta = await fetch('/api/meta').then((r) => r.json());
    } catch (_) {
      meta = { defaultTerm: '', questionSets: [], hostKeyRequired: false, llmConfigured: false };
    }
    $('f-term').value = meta.defaultTerm || '';
    const sel = $('f-set');
    sel.innerHTML = '';
    (meta.questionSets || []).forEach((qs) => {
      const opt = document.createElement('option');
      opt.value = qs.id;
      opt.textContent = qs.title;
      opt.dataset.desc = qs.description || '';
      sel.appendChild(opt);
    });
    const updateDesc = () => {
      const o = sel.options[sel.selectedIndex];
      $('set-desc').textContent = o ? o.dataset.desc || '' : '';
    };
    sel.addEventListener('change', updateDesc);
    updateDesc();

    if (meta.hostKeyRequired) {
      show($('hostkey-wrap'));
      if (hostKey) $('f-hostkey').value = hostKey;
    }
    if (!meta.llmConfigured) show($('llm-banner'));

    connectSocket();
    wireStaticButtons();
    renderResumeList();
    showView('setup');
  }

  // ── Socket (live relay) ─────────────────────────────────────────────────────
  function connectSocket() {
    socket = io();
    socket.on('connect', maybeAttach);
    socket.on('host-attached', ({ count } = {}) => {
      setCollectStatus(`Verbunden · die Befragung ist aktiv${count ? ` · ${count} am Server gezählt` : ''}.`, 'ok');
    });
    socket.on('host-attach-failed', () => {
      setCollectStatus('Diese Sitzung ist am Server nicht mehr aktiv. Eine neue Sammlung ist nicht möglich; bereits erfasste Antworten bleiben erhalten.', 'warn');
    });
    socket.on('new-response', (resp) => {
      if (!current) return;
      window.Store.addResponse(current.sessionId, resp);
      current = ensureShape(window.Store.loadSession(current.sessionId));
      updateCount();
    });
    socket.on('disconnect', () => {
      if (current && !current.closedAt) setCollectStatus('Verbindung getrennt – versuche erneut zu verbinden …', 'warn');
    });
  }
  function maybeAttach() {
    if (current && !current.closedAt && socket && socket.connected) {
      socket.emit('host-attach', { sessionId: current.sessionId, hostToken: current.hostToken });
    }
  }

  // ── Setup: create a session ─────────────────────────────────────────────────
  $('setup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    hide($('setup-error'));
    const title = $('f-title').value.trim();
    const term = $('f-term').value.trim();
    const questionSetId = $('f-set').value;
    if (meta.hostKeyRequired) hostKey = $('f-hostkey').value.trim();
    if (!title) return setupError('Bitte einen Namen für die Lehrveranstaltung angeben.');

    $('create-btn').disabled = true;
    try {
      const res = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, term, questionSetId, hostKey }),
      });
      const data = await res.json();
      if (!res.ok) return setupError(data.error || 'Anlegen fehlgeschlagen.');

      if (meta.hostKeyRequired && hostKey) localStorage.setItem(HOSTKEY_LS, hostKey);

      current = ensureShape({
        sessionId: data.sessionId,
        hostToken: data.hostToken,
        title: data.title,
        term: data.term,
        questionSetId,
        questionSetTitle: data.questionSetTitle || '',
        questions: data.questions,
        createdAt: Date.now(),
        closedAt: null,
        responses: [],
      });
      saveCurrent();
      renderCollect();
      showView('collect');
      maybeAttach();
    } catch (err) {
      setupError('Netzwerkfehler beim Anlegen.');
    } finally {
      $('create-btn').disabled = false;
    }
  });
  function setupError(msg) {
    $('setup-error').textContent = msg;
    show($('setup-error'));
  }

  // ── Collect ─────────────────────────────────────────────────────────────────
  function setCollectStatus(msg, kind) {
    const el = $('c-status');
    el.textContent = msg;
    el.className = 'notice' + (kind === 'ok' ? ' ok' : kind === 'warn' ? ' warn' : '');
  }
  async function renderCollect() {
    $('c-title').textContent = current.title;
    $('c-term').textContent = current.term;
    const link = `${window.location.origin}/eval/${current.sessionId}`;
    $('c-link').value = link;
    $('open-eval').href = link;
    updateCount();
    setCollectStatus('Verbinde …');
    try {
      const { dataUrl } = await fetch('/api/qr?data=' + encodeURIComponent(link)).then((r) => r.json());
      $('c-qr').innerHTML = `<img alt="QR-Code zum Teilnahme-Link" src="${dataUrl}" />`;
    } catch (_) { $('c-qr').textContent = ''; }
  }
  function updateCount() {
    const n = current ? current.responses.length : 0;
    $('c-count').textContent = n;
    $('a-count').textContent = n;
  }
  $('copy-link').addEventListener('click', () => {
    navigator.clipboard && navigator.clipboard.writeText($('c-link').value);
  });

  // ── Analyze ─────────────────────────────────────────────────────────────────
  function showAnalyze() {
    $('a-title').textContent = current.title;
    $('a-meta').textContent =
      `${current.term} · Befragung vom ${window.Report.formatDate(current.closedAt || current.createdAt)}` +
      (current.questionSetTitle ? ` · Fragebogen: ${current.questionSetTitle}` : '');
    updateCount();
    renderLikertCharts();
    renderFreeformSection();
    renderTapSections();
    $('out-conclusions').innerHTML = '';
    showView('analyze');
  }
  function renderLikertCharts() {
    const box = $('likert-charts');
    box.innerHTML = '';
    const likerts = current.questions.filter((q) => q.type === 'likert');
    if (!likerts.length) { box.innerHTML = '<p class="muted small">Keine Likert-Fragen im Fragebogen.</p>'; return; }
    likerts.forEach((q) => window.Charts.renderLikert(box, q, current.responses));
  }

  // LLM output rendering helper
  function renderLLM(container, result) {
    const box = document.createElement('div');
    if (result && result.available) {
      box.className = 'llm-box';
      box.textContent = result.text;
    } else {
      box.className = 'llm-box unavailable';
      box.textContent = (result && result.message) || 'LLM not available at present';
    }
    container.innerHTML = '';
    container.appendChild(box);
  }
  function loadingNote(container) {
    container.innerHTML = '<p class="llm-loading">Zusammenfassung wird erstellt …</p>';
  }
  async function callLLM(promptKey, input, system) {
    try {
      const res = await fetch(`/api/llm/${promptKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input, hostKey, system }),
      });
      if (!res.ok) return { available: false, message: 'LLM not available at present' };
      return await res.json();
    } catch (_) {
      return { available: false, message: 'LLM not available at present' };
    }
  }

  // Input compilers
  function answersFor(qid) {
    return (current.responses || [])
      .map((r) => r.answers && r.answers[qid])
      .filter((v) => typeof v === 'string' && v.trim())
      .map((v) => v.trim());
  }
  function compileFreeform() {
    const qs = current.questions.filter((q) => q.type === 'freeform' && !q.tap);
    const blocks = [];
    qs.forEach((q) => {
      const ans = answersFor(q.id);
      if (ans.length) blocks.push(`Frage: ${q.text}\n` + ans.map((a) => `- ${a}`).join('\n'));
    });
    return blocks.join('\n\n');
  }
  function formatTapAnswers(qid) {
    const ans = answersFor(qid);
    return ans.map((a) => `- ${a}`).join('\n');
  }
  function compileAllFeedback() {
    const lines = ['# Likert-Ergebnisse'];
    current.questions.filter((q) => q.type === 'likert').forEach((q) => {
      const s = window.Charts.likertStats(q, current.responses);
      const dist = q.labels.map((l, i) => `${l}=${s.counts[i]}`).join(', ');
      lines.push(`- ${q.text}: Mittelwert ${window.Charts.fmt(s.mean)} (n=${s.n}); Verteilung: ${dist}`);
    });
    lines.push('', '# Freitextantworten');
    current.questions.filter((q) => q.type === 'freeform').forEach((q) => {
      const ans = answersFor(q.id);
      if (ans.length) { lines.push(`## ${q.text}`); ans.forEach((a) => lines.push(`- ${a}`)); }
    });
    return lines.join('\n');
  }

  function freeformResponsesFlat() {
    const out = [];
    current.questions
      .filter((q) => q.type === 'freeform' && !q.tap)
      .forEach((q) => answersFor(q.id).forEach((a) => out.push(a)));
    return out;
  }

  // Shared AI-summary block: shows the submitted responses, an editable prompt,
  // and the result. Auto-triggers on first render; re-runnable with an edited
  // prompt. Caches { prompt, result } so re-renders restore state faithfully.
  function renderSummaryBlock(opts) {
    const { container, title, promptKey, responses, llmInput, getCache, setCache } = opts;
    container.innerHTML = '';
    const block = document.createElement('div');
    block.className = 'summary-block';

    if (title) {
      const h = document.createElement('h3');
      h.textContent = title;
      block.appendChild(h);
    }

    // Submitted responses
    const respHead = document.createElement('div');
    respHead.className = 'small muted';
    respHead.textContent = `Antworten (${responses.length})`;
    block.appendChild(respHead);
    if (responses.length) {
      const ul = document.createElement('ul');
      ul.className = 'resp-list';
      responses.forEach((a) => {
        const li = document.createElement('li');
        li.textContent = a;
        ul.appendChild(li);
      });
      block.appendChild(ul);
    } else {
      const none = document.createElement('p');
      none.className = 'muted small';
      none.textContent = 'Keine Antworten zu dieser Frage.';
      block.appendChild(none);
    }

    // Editable prompt
    const cache = getCache();
    const promptLabel = document.createElement('label');
    promptLabel.textContent = 'Prompt (anpassbar)';
    block.appendChild(promptLabel);
    const promptTa = document.createElement('textarea');
    promptTa.className = 'prompt-area';
    promptTa.rows = 5;
    promptTa.value = (cache && cache.prompt) || (meta.prompts && meta.prompts[promptKey]) || '';
    block.appendChild(promptTa);

    const btnRow = document.createElement('div');
    btnRow.className = 'btn-row';
    btnRow.style.marginTop = '0.4rem';
    const btn = document.createElement('button');
    btn.className = 'secondary';
    btn.type = 'button';
    btn.textContent = 'Zusammenfassung neu erzeugen';
    btnRow.appendChild(btn);
    block.appendChild(btnRow);

    const result = document.createElement('div');
    result.className = 'result';
    block.appendChild(result);
    container.appendChild(block);

    async function run() {
      if (!responses.length) {
        result.innerHTML = '<p class="muted small">Keine Antworten zu dieser Frage.</p>';
        return;
      }
      btn.disabled = true;
      loadingNote(result);
      const res = await callLLM(promptKey, llmInput, promptTa.value.trim());
      renderLLM(result, res);
      setCache({ prompt: promptTa.value, result: res });
      saveCurrent();
      btn.disabled = false;
    }
    btn.addEventListener('click', run);

    // Restore a cached run, otherwise auto-trigger.
    if (cache && cache.result) {
      renderLLM(result, cache.result);
    } else if (responses.length) {
      run();
    } else {
      result.innerHTML = '<p class="muted small">Keine Antworten zu dieser Frage.</p>';
    }
  }

  function renderFreeformSection() {
    renderSummaryBlock({
      container: $('freeform-section'),
      title: null,
      promptKey: 'freeform_summary',
      responses: freeformResponsesFlat(),
      llmInput: compileFreeform(),
      getCache: () => current.analysis.freeform,
      setCache: (v) => { current.analysis.freeform = v; },
    });
  }

  function renderTapSections() {
    const box = $('tap-sections');
    box.innerHTML = '';
    current.questions.filter((q) => q.tap).forEach((q) => {
      const sec = document.createElement('div');
      sec.className = 'card-sub';
      box.appendChild(sec);
      renderSummaryBlock({
        container: sec,
        title: q.text,
        promptKey: q.promptKey,
        responses: answersFor(q.id),
        llmInput: formatTapAnswers(q.id),
        getCache: () => current.analysis.tap[q.id],
        setCache: (v) => { current.analysis.tap[q.id] = v; },
      });
    });
  }

  // Conclusions
  async function runConclusions() {
    const out = $('out-conclusions');
    const input = compileAllFeedback();
    const dims = window.Report.DIMENSIONS;
    let any = false;
    for (let i = 0; i < dims.length; i++) {
      out.innerHTML = `<p class="llm-loading">Erzeuge Entwurf ${i + 1}/${dims.length} (${dims[i].title}) …</p>`;
      const r = await callLLM(dims[i].promptKey, input);
      if (r.available) { current.digest.conclusions[dims[i].key] = r.text; any = true; }
      saveCurrent();
    }
    if (!any) {
      out.innerHTML = '<div class="llm-box unavailable">LLM not available at present – bitte verfassen Sie die Schlussfolgerungen manuell.</div>';
    } else {
      out.innerHTML = '';
    }
    renderDigest();
    showView('digest');
  }

  // ── Digest ──────────────────────────────────────────────────────────────────
  function renderDigest() {
    const box = $('digest-fields');
    box.innerHTML = '';
    window.Report.DIMENSIONS.forEach((d, i) => {
      const wrap = document.createElement('div');
      wrap.style.marginBottom = '1rem';

      const lab = document.createElement('label');
      lab.setAttribute('for', `concl-${d.key}`);
      lab.textContent = `${i + 1}. ${d.title}`;
      wrap.appendChild(lab);

      const ta = document.createElement('textarea');
      ta.id = `concl-${d.key}`;
      ta.rows = 4;
      ta.value = current.digest.conclusions[d.key] || '';
      ta.placeholder = 'Schlussfolgerung formulieren …';
      ta.addEventListener('input', () => {
        current.digest.conclusions[d.key] = ta.value;
        saveCurrent();
      });
      wrap.appendChild(ta);

      const rline = document.createElement('div');
      rline.className = 'reviewed-line';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.id = `rev-${d.key}`;
      cb.checked = !!current.digest.reviewed[d.key];
      cb.addEventListener('change', () => {
        current.digest.reviewed[d.key] = cb.checked;
        saveCurrent();
        updateReportButtons();
      });
      const clab = document.createElement('label');
      clab.setAttribute('for', `rev-${d.key}`);
      clab.textContent = 'geprüft und freigegeben';
      rline.appendChild(cb);
      rline.appendChild(clab);
      wrap.appendChild(rline);

      box.appendChild(wrap);
    });

    const note = $('d-note');
    note.value = current.digest.note || '';
    note.oninput = () => { current.digest.note = note.value; saveCurrent(); };

    updateReportButtons();
  }
  function updateReportButtons() {
    const allReviewed = window.Report.DIMENSIONS.every((d) => current.digest.reviewed[d.key]);
    $('report-open').disabled = !allReviewed;
    $('report-download').disabled = !allReviewed;
  }

  // ── Resume list ─────────────────────────────────────────────────────────────
  function renderResumeList() {
    const list = window.Store.listSessions();
    const card = $('resume-card');
    const ul = $('resume-list');
    ul.innerHTML = '';
    if (!list.length) { card.style.display = 'none'; return; }
    card.style.display = '';
    list.forEach((s) => {
      const li = document.createElement('li');
      li.className = 'session-item';

      const info = document.createElement('div');
      const status = s.closedAt ? 'beendet' : 'offen';
      info.innerHTML = `<strong></strong><div class="tag"></div>`;
      info.querySelector('strong').textContent = s.title || '(ohne Titel)';
      info.querySelector('.tag').textContent =
        `${s.term} · ${s.count} Antwort(en) · ${status} · ${window.Report.formatDate(s.createdAt)}`;

      const actions = document.createElement('div');
      actions.className = 'btn-row';
      actions.style.margin = '0';
      const openBtn = document.createElement('button');
      openBtn.className = 'secondary';
      openBtn.type = 'button';
      openBtn.textContent = s.closedAt ? 'Auswerten' : 'Fortsetzen';
      openBtn.addEventListener('click', () => resumeSession(s.sessionId));
      const delBtn = document.createElement('button');
      delBtn.className = 'secondary';
      delBtn.type = 'button';
      delBtn.textContent = 'Löschen';
      delBtn.addEventListener('click', () => {
        if (confirm(`Evaluation „${s.title}“ und alle lokal gespeicherten Antworten löschen?`)) {
          window.Store.deleteSession(s.sessionId);
          renderResumeList();
        }
      });
      actions.appendChild(openBtn);
      actions.appendChild(delBtn);

      li.appendChild(info);
      li.appendChild(actions);
      ul.appendChild(li);
    });
  }
  function resumeSession(id) {
    const s = window.Store.loadSession(id);
    if (!s) return;
    current = ensureShape(s);
    if (current.closedAt) {
      showAnalyze();
    } else {
      renderCollect();
      showView('collect');
      maybeAttach();
    }
  }

  // ── Static buttons ──────────────────────────────────────────────────────────
  function wireStaticButtons() {
    $('end-btn').addEventListener('click', () => {
      if (!current) return;
      if (socket && socket.connected) socket.emit('host-end', { sessionId: current.sessionId, hostToken: current.hostToken });
      current.closedAt = Date.now();
      saveCurrent();
      showAnalyze();
    });
    $('new-btn').addEventListener('click', () => {
      current = null;
      renderResumeList();
      $('setup-form').reset();
      $('f-term').value = meta.defaultTerm || '';
      showView('setup');
    });
    $('run-conclusions').addEventListener('click', runConclusions);
    $('skip-conclusions').addEventListener('click', () => { renderDigest(); showView('digest'); });
    $('back-analyze').addEventListener('click', () => showAnalyze());
    $('report-open').addEventListener('click', () => window.Report.openReport(current));
    $('report-download').addEventListener('click', () => window.Report.downloadReport(current));
    const csv = () => window.Store.download(window.Store.csvFilename(current), window.Store.toCSV(current), 'text/csv');
    $('csv-btn').addEventListener('click', csv);
    $('csv-btn2').addEventListener('click', csv);
  }

  init();
})();
