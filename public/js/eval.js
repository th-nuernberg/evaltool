'use strict';

// ── Student survey ───────────────────────────────────────────────────────────
// Connects to the session, renders the questions, and submits one anonymous
// response. Nothing is persisted here except a local "already submitted" flag.

(function () {
  const parts = window.location.pathname.split('/');
  const sessionId = decodeURIComponent(parts[parts.length - 1] || '');

  const els = {
    state: document.getElementById('state'),
    stateMsg: document.getElementById('state-msg'),
    survey: document.getElementById('survey'),
    title: document.getElementById('poll-title'),
    term: document.getElementById('poll-term'),
    questions: document.getElementById('questions'),
    submitBtn: document.getElementById('submit-btn'),
    submitError: document.getElementById('submit-error'),
    thanks: document.getElementById('thanks'),
  };

  const SUBMIT_FLAG = `evaltool:submitted:${sessionId}`;
  let currentQuestions = [];
  let submitting = false;

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'r-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  }

  function show(el) { el.classList.remove('hidden'); }
  function hide(el) { el.classList.add('hidden'); }

  function showState(msg, cls) {
    els.stateMsg.textContent = msg;
    els.stateMsg.className = cls || 'muted';
    show(els.state);
    hide(els.survey);
  }

  function showThanks() {
    hide(els.state);
    hide(els.survey);
    show(els.thanks);
  }

  // Already submitted on this device → straight to thank-you.
  if (localStorage.getItem(SUBMIT_FLAG)) {
    showThanks();
    return;
  }

  function renderQuestions(questions) {
    currentQuestions = questions;
    els.questions.innerHTML = '';
    questions.forEach((q, i) => {
      const wrap = document.createElement('div');
      wrap.className = 'question';

      const qtext = document.createElement('div');
      qtext.className = 'qtext';
      qtext.textContent = `${i + 1}. ${q.text}`;
      if (q.tap) {
        const badge = document.createElement('span');
        badge.className = 'tap-badge';
        badge.textContent = 'TAP';
        qtext.appendChild(badge);
      }
      wrap.appendChild(qtext);

      if (q.type === 'likert') {
        const group = document.createElement('div');
        group.className = 'likert';
        group.setAttribute('role', 'radiogroup');
        q.labels.forEach((label, idx) => {
          const lab = document.createElement('label');
          const input = document.createElement('input');
          input.type = 'radio';
          input.name = q.id;
          input.value = String(idx);
          input.addEventListener('change', () => {
            group.querySelectorAll('label').forEach((l) => l.classList.remove('checked'));
            lab.classList.add('checked');
          });
          lab.appendChild(input);
          lab.appendChild(document.createTextNode(label));
          group.appendChild(lab);
        });
        wrap.appendChild(group);
      } else {
        const ta = document.createElement('textarea');
        ta.name = q.id;
        ta.rows = 3;
        ta.maxLength = 5000;
        ta.placeholder = 'Ihre Antwort (optional)';
        wrap.appendChild(ta);
      }
      els.questions.appendChild(wrap);
    });
  }

  function collectAnswers() {
    const answers = {};
    for (const q of currentQuestions) {
      if (q.type === 'likert') {
        const checked = els.survey.querySelector(`input[name="${CSS.escape(q.id)}"]:checked`);
        if (checked) answers[q.id] = Number(checked.value);
      } else {
        const ta = els.survey.querySelector(`textarea[name="${CSS.escape(q.id)}"]`);
        if (ta && ta.value.trim()) answers[q.id] = ta.value.trim();
      }
    }
    return answers;
  }

  // ── Socket wiring ───────────────────────────────────────────────────────────
  const socket = io();

  socket.on('connect', () => socket.emit('student-join', { sessionId }));

  socket.on('eval-config', (cfg) => {
    els.title.textContent = cfg.title || 'Evaluation';
    els.term.textContent = cfg.term || '';
    renderQuestions(cfg.questions || []);
    hide(els.state);
    show(els.survey);
    els.submitBtn.disabled = false;
  });

  socket.on('eval-unavailable', ({ reason } = {}) => {
    if (localStorage.getItem(SUBMIT_FLAG)) return showThanks();
    if (reason === 'paused') {
      showState('Die Evaluation ist gerade pausiert (die Lehrperson ist nicht verbunden). Bitte einen Moment warten – diese Seite aktualisiert sich automatisch.');
    } else {
      showState('Diese Evaluation ist derzeit nicht aktiv.');
    }
  });

  socket.on('eval-paused', () => {
    if (els.survey.classList.contains('hidden')) return;
    els.submitBtn.disabled = true;
    els.submitError.textContent = 'Die Evaluation ist gerade pausiert. Bitte warten Sie kurz.';
    show(els.submitError);
  });

  socket.on('eval-resumed', () => {
    if (els.survey.classList.contains('hidden')) {
      socket.emit('student-join', { sessionId });
      return;
    }
    els.submitBtn.disabled = false;
    hide(els.submitError);
  });

  socket.on('eval-closed', () => {
    if (localStorage.getItem(SUBMIT_FLAG)) return showThanks();
    showState('Die Evaluation wurde beendet. Vielen Dank für Ihr Interesse.');
  });

  els.survey.addEventListener('submit', (e) => {
    e.preventDefault();
    if (submitting) return;
    hide(els.submitError);

    const answers = collectAnswers();
    if (Object.keys(answers).length === 0) {
      els.submitError.textContent = 'Bitte beantworten Sie mindestens eine Frage, bevor Sie absenden.';
      show(els.submitError);
      return;
    }

    submitting = true;
    els.submitBtn.disabled = true;
    els.submitBtn.textContent = 'Senden …';

    socket.emit('submit-response', { sessionId, responseId: uuid(), answers }, (res) => {
      submitting = false;
      if (res && res.ok) {
        localStorage.setItem(SUBMIT_FLAG, '1');
        showThanks();
      } else {
        els.submitBtn.disabled = false;
        els.submitBtn.textContent = 'Antwort absenden';
        const reason = res && res.reason;
        els.submitError.textContent =
          reason === 'paused' ? 'Die Evaluation ist gerade pausiert. Bitte erneut versuchen.'
          : reason === 'closed' ? 'Die Evaluation wurde bereits beendet.'
          : 'Senden fehlgeschlagen. Bitte erneut versuchen.';
        show(els.submitError);
      }
    });
  });

  socket.on('disconnect', () => {
    if (!els.thanks.classList.contains('hidden')) return;
  });
})();
