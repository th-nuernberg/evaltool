'use strict';

// ── Likert visualisation + statistics (R6) ───────────────────────────────────
// Dependency-free horizontal bar charts built from plain DOM. Exposed as `Charts`.

window.Charts = (function () {
  /** Compute distribution + summary stats for one likert question. */
  function likertStats(question, responses) {
    const counts = new Array(question.labels.length).fill(0);
    let n = 0;
    for (const r of responses) {
      const v = r.answers ? r.answers[question.id] : undefined;
      if (Number.isInteger(v) && v >= 0 && v < counts.length) {
        counts[v] += 1;
        n += 1;
      }
    }
    let mean = null, median = null;
    if (n > 0) {
      let sum = 0;
      const values = [];
      counts.forEach((c, idx) => {
        sum += (idx + 1) * c;
        for (let k = 0; k < c; k++) values.push(idx + 1);
      });
      mean = sum / n;
      values.sort((a, b) => a - b);
      const mid = Math.floor(values.length / 2);
      median = values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
    }
    return { counts, n, mean, median };
  }

  function fmt(x) {
    return x === null ? '–' : (Math.round(x * 10) / 10).toFixed(1).replace('.', ',');
  }

  /** Render a labelled bar chart for one likert question into `container`. */
  function renderLikert(container, question, responses) {
    const { counts, n, mean, median } = likertStats(question, responses);
    const max = Math.max(1, ...counts);

    const chart = document.createElement('div');
    chart.className = 'chart';

    const title = document.createElement('div');
    title.className = 'qtitle';
    title.textContent = question.text;
    chart.appendChild(title);

    const stat = document.createElement('div');
    stat.className = 'stat';
    stat.textContent = `n = ${n} · Mittelwert ${fmt(mean)} · Median ${fmt(median)} (Skala 1–${question.labels.length})`;
    chart.appendChild(stat);

    question.labels.forEach((label, idx) => {
      const c = counts[idx];
      const pct = n > 0 ? Math.round((c / n) * 100) : 0;

      const row = document.createElement('div');
      row.className = 'bar-row';

      const bl = document.createElement('div');
      bl.className = 'blabel';
      bl.textContent = `${idx + 1}. ${label}`;
      row.appendChild(bl);

      const track = document.createElement('div');
      track.className = 'bar-track';
      const fill = document.createElement('div');
      fill.className = 'bar-fill';
      fill.style.width = (c / max) * 100 + '%';
      track.appendChild(fill);
      row.appendChild(track);

      const bc = document.createElement('div');
      bc.className = 'bcount';
      bc.textContent = `${c} (${pct}%)`;
      row.appendChild(bc);

      chart.appendChild(row);
    });

    container.appendChild(chart);
    return { n, mean, median, counts };
  }

  return { likertStats, renderLikert, fmt };
})();
