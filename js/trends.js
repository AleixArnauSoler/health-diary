// Diary – Trends.
//   Overview: key charts at a glance.
//   Explore:  any question (or score) over time, drawn to suit its answer type.
//   Insights: which foods go with symptoms, averages by cycle phase, and the
//             spreadsheet's sex & vulva comparison (Auswertung) for sex days.
// Charts use Chart.js (bundled in js/vendor, loaded only when this tab opens).

import { dbGetAll } from './db.js';
import { getConfig } from './config.js';
import {
  logicalDate, addDays, isISODate, formatShortDate, escapeHtml as esc,
  makeAnswerLookup, computeScore, sleepMinutes
} from './logic.js';
import { analyseCycles, cycleDayInfo, PHASES } from './cycle.js';

const VIEWS = [['overview', 'Overview'], ['explore', 'Explore'], ['insights', 'Insights']];
const RANGES = [['30', '30 d', 30], ['90', '3 m', 91], ['365', '1 y', 365], ['all', 'All', null], ['custom', 'Custom', null]];

// What you picked last stays selected while the app is open.
const ui = { view: 'overview', range: '90', from: '', to: '', item: 'q:mood', outcome: 'stomach', lag: 0 };

// ---------- Screen ----------

export async function trendsScreen() {
  const config = getConfig();
  if (!config) {
    return {
      title: 'Trends', subtitle: '',
      html: '<section class="card"><p>Connect your private data repo in Settings to load your questions.</p></section>'
    };
  }
  const html = `<div class="trends">
      <div class="segmented" role="group" aria-label="View">
        ${VIEWS.map(([id, label]) => `<button type="button" data-view="${id}" aria-pressed="${ui.view === id}">${label}</button>`).join('')}
      </div>
      <div class="segmented small" role="group" aria-label="Period">
        ${RANGES.map(([id, label]) => `<button type="button" data-range="${id}" aria-pressed="${ui.range === id}">${label}</button>`).join('')}
      </div>
      <div class="custom-range" ${ui.range === 'custom' ? '' : 'hidden'}>
        <label>From<input type="date" id="range-from" value="${esc(ui.from)}"></label>
        <label>To<input type="date" id="range-to" value="${esc(ui.to)}"></label>
      </div>
      <div class="trend-body"><p class="status">Loading…</p></div>
    </div>`;
  return { title: 'Trends', subtitle: '', html, mount: (view) => mountTrends(view, config) };
}

function mountTrends(view, config) {
  const root = view.querySelector('.trends');
  const body = root.querySelector('.trend-body');
  let charts = [];
  let data = null;
  let alive = true;

  const destroyCharts = () => {
    charts.forEach((chart) => chart.destroy());
    charts = [];
  };

  async function draw() {
    try {
      if (!data) data = await loadData(config);
      const Chart = await loadChartLibrary();
      if (!alive) return;
      destroyCharts();
      const ctx = rangeContext(data);
      const result = ui.view === 'overview' ? overview(ctx) : ui.view === 'explore' ? explore(ctx) : insights(ctx);
      body.innerHTML = `<p class="range-note">${formatShortDate(ctx.from)} – ${formatShortDate(ctx.to)}
        (${ctx.days.length} ${ctx.days.length === 1 ? 'day' : 'days'})</p>${result.html}`;
      for (const spec of result.charts) charts.push(new Chart(body.querySelector(`#${spec.id}`), spec.config));
    } catch (err) {
      body.innerHTML = `<p class="status error">${esc(err.message)}</p>`;
    }
  }

  const press = (attribute, value) => {
    for (const b of root.querySelectorAll(`[${attribute}]`)) b.setAttribute('aria-pressed', String(b.getAttribute(attribute) === value));
  };

  root.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.view) { ui.view = button.dataset.view; press('data-view', ui.view); draw(); }
    else if (button.dataset.range) {
      ui.range = button.dataset.range;
      press('data-range', ui.range);
      root.querySelector('.custom-range').hidden = ui.range !== 'custom';
      if (ui.range === 'custom' && !(ui.from && ui.to)) return;
      draw();
    } else if (button.dataset.outcome) { ui.outcome = button.dataset.outcome; draw(); }
    else if (button.dataset.lag !== undefined) { ui.lag = Number(button.dataset.lag); draw(); }
  });

  root.addEventListener('change', (event) => {
    if (event.target.id === 'explore-item') { ui.item = event.target.value; draw(); }
    if (event.target.id === 'range-from' || event.target.id === 'range-to') {
      ui.from = root.querySelector('#range-from').value;
      ui.to = root.querySelector('#range-to').value;
      if (isISODate(ui.from) && isISODate(ui.to) && ui.from <= ui.to) draw();
    }
  });

  draw();
  return () => { alive = false; destroyCharts(); };
}

// ---------- Data ----------

async function loadData(config) {
  const entries = await dbGetAll('entries');
  const answersFor = makeAnswerLookup(entries);
  const dates = entries.map((e) => e.date).sort();
  const questions = new Map();
  for (const pack of config.packs) {
    if (pack.retired) continue;
    for (const q of pack.questions) if (!q.retired) questions.set(q.id, { q, pack });
  }
  const cycles = analyseCycles(dates, answersFor);
  return { config, answersFor, dates, questions, cycles };
}

function rangeContext(data) {
  const today = logicalDate();
  let from;
  let to = today;
  if (ui.range === 'custom' && isISODate(ui.from) && isISODate(ui.to) && ui.from <= ui.to) {
    from = ui.from;
    to = ui.to > today ? today : ui.to;
  } else if (ui.range === 'all' || ui.range === 'custom') {
    from = data.dates[0] || today;
  } else {
    from = addDays(today, -(RANGES.find((r) => r[0] === ui.range)[2] - 1));
  }
  const days = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  return {
    ...data, from, to, days,
    labels: days.map(formatShortDate),
    smooth: days.length > 45,                      // long periods: show 7-day averages
    bucket: days.length > 120 ? 'month' : 'week'   // counts per week, or per month for long periods
  };
}

const answer = (ctx, date, id) => ctx.answersFor(date)[id];
const numberOrNull = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function getterFor(ctx, key) {
  const [kind, id] = key.split(':');
  if (kind === 'score') {
    const pack = ctx.config.packs.find((p) => p.id === id);
    return (date) => computeScore(pack.score, ctx.answersFor(date));
  }
  if (key === 'calc:sleep') return (date) => { const m = sleepMinutes(ctx.answersFor(date)); return m === null ? null : Math.round(m / 6) / 10; };
  if (key === 'calc:pain') return (date) => worstPain(ctx.answersFor(date));
  if (key === 'calc:alcohol') return (date) => alcoholDrinks(ctx.answersFor(date));
  if (key === 'calc:exercise') return (date) => exerciseMinutes(ctx.answersFor(date));
  return (date) => numberOrNull(answer(ctx, date, id));
}

function worstPain(a) {
  if (a.pain_any === false) return 0;
  if (!Array.isArray(a.pain_sites)) return null;
  const values = a.pain_sites.map((site) => a[`pain_${site}`]).filter((v) => typeof v === 'number');
  return values.length ? Math.max(...values) : null;
}

// Drinks that day: 0 if alcohol wasn't ticked, null if the food questions weren't answered.
function alcoholDrinks(a) {
  if (!Array.isArray(a.food_triggers)) return null;
  if (!a.food_triggers.includes('alcohol')) return 0;
  return numberOrNull(a.alcohol_drinks);
}

// Exercise minutes that day: 0 on days without exercise.
function exerciseMinutes(a) {
  if (a.exercise_any === false) return 0;
  if (a.exercise_any !== true) return null;
  return numberOrNull(a.exercise_minutes);
}

function series(ctx, getter) {
  const values = ctx.days.map(getter);
  return ctx.smooth ? rollingMean(values, 7) : values;
}

function rollingMean(values, window) {
  return values.map((_, i) => {
    const part = values.slice(Math.max(0, i - window + 1), i + 1).filter((v) => v !== null);
    return part.length ? Math.round((part.reduce((s, v) => s + v, 0) / part.length) * 100) / 100 : null;
  });
}

// Groups the days of the range into weeks (starting Monday) or months.
function buckets(ctx) {
  const groups = [];
  for (const date of ctx.days) {
    const d = new Date(`${date}T12:00:00`);
    const key = ctx.bucket === 'month' ? date.slice(0, 7) : addDays(date, -((d.getDay() + 6) % 7));
    if (!groups.length || groups[groups.length - 1].key !== key) {
      const label = ctx.bucket === 'month'
        ? d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' })
        : formatShortDate(key);
      groups.push({ key, label, days: [] });
    }
    groups[groups.length - 1].days.push(date);
  }
  return groups;
}

function stats(values) {
  const v = values.filter((x) => x !== null).sort((a, b) => a - b);
  if (!v.length) return null;
  const mean = v.reduce((s, x) => s + x, 0) / v.length;
  const mid = Math.floor(v.length / 2);
  return { n: v.length, mean, median: v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2, min: v[0], max: v[v.length - 1] };
}

const round1 = (x) => (Math.round(x * 10) / 10).toString();
const percent = (x) => `${Math.round(x * 100)}%`;

// ---------- Chart helpers ----------

let chartLibrary = null;

function loadChartLibrary() {
  if (!chartLibrary) {
    chartLibrary = new Promise((resolve, reject) => {
      if (window.Chart) { resolve(window.Chart); return; }
      const script = document.createElement('script');
      script.src = './js/vendor/chart.umd.min.js';
      script.onload = () => resolve(window.Chart);
      script.onerror = () => { chartLibrary = null; reject(new Error('Could not load the chart library.')); };
      document.head.appendChild(script);
    }).then((Chart) => {
      Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
      Chart.defaults.font.size = 12;
      Chart.defaults.animation = false;
      Chart.defaults.maintainAspectRatio = false;
      Chart.defaults.plugins.legend.labels.boxWidth = 12;
      return Chart;
    });
  }
  return chartLibrary;
}

function colours() {
  const style = getComputedStyle(document.documentElement);
  const get = (name) => style.getPropertyValue(name).trim();
  return {
    text: get('--text'), muted: get('--muted'), line: get('--line'),
    series: ['--c1', '--c2', '--c3', '--c4', '--c5', '--c6', '--c7', '--c8'].map(get)
  };
}

function baseOptions(c, extra = {}) {
  return {
    responsive: true,
    color: c.muted,
    borderColor: c.line,
    interaction: { mode: 'index', intersect: false },
    plugins: { legend: { labels: { color: c.text } }, tooltip: { enabled: true } },
    scales: {
      x: { ticks: { color: c.muted, autoSkip: true, maxTicksLimit: 6, maxRotation: 0 }, grid: { display: false } },
      y: { ticks: { color: c.muted }, grid: { color: c.line }, beginAtZero: true }
    },
    ...extra
  };
}

function lineConfig(labels, datasets, { min, max, legend = true, tickFormat } = {}) {
  const c = colours();
  const options = baseOptions(c);
  if (min !== undefined) options.scales.y.min = min;
  if (max !== undefined) options.scales.y.max = max;
  if (tickFormat) {
    options.scales.y.ticks.callback = tickFormat;
    options.plugins.tooltip.callbacks = { label: (item) => `${item.dataset.label}: ${tickFormat(item.parsed.y)}` };
  }
  options.plugins.legend.display = legend;
  return {
    type: 'line',
    data: {
      labels,
      datasets: datasets.map((d, i) => ({
        label: d.label,
        data: d.data,
        borderColor: d.color || c.series[i % c.series.length],
        backgroundColor: d.color || c.series[i % c.series.length],
        borderWidth: d.points ? 0 : 2,
        pointRadius: d.points ? 2.5 : d.marker ? 3 : (labels.length > 45 ? 0 : 2),
        showLine: !d.points,
        spanGaps: true,
        tension: 0.3,
        hidden: !!d.hidden
      }))
    },
    options
  };
}

function barConfig(labels, datasets, { stacked = false, horizontal = false, max, legend = true, percentAxis = false } = {}) {
  const c = colours();
  const options = baseOptions(c);
  options.plugins.legend.display = legend;
  if (horizontal) {
    options.indexAxis = 'y';
    options.scales = {
      x: { ticks: { color: c.muted, precision: 0 }, grid: { color: c.line }, beginAtZero: true, stacked },
      y: { ticks: { color: c.text, autoSkip: false }, grid: { display: false }, stacked }
    };
  } else {
    options.scales.x.stacked = stacked;
    options.scales.y.stacked = stacked;
    options.scales.y.ticks.precision = 0;
  }
  const valueAxis = horizontal ? options.scales.x : options.scales.y;
  if (max !== undefined) valueAxis.max = max;
  if (percentAxis) valueAxis.ticks.callback = (v) => `${v}%`;
  return {
    type: 'bar',
    data: {
      labels,
      datasets: datasets.map((d, i) => ({
        label: d.label,
        data: d.data,
        backgroundColor: d.color || c.series[i % c.series.length],
        borderRadius: 3,
        maxBarThickness: 28
      }))
    },
    options
  };
}

// Collects cards and their charts for one view.
function builder() {
  const parts = [];
  const charts = [];
  return {
    chart(title, note, config, footer = '', tall = false) {
      const id = `chart-${charts.length}`;
      parts.push(`<section class="card chart-card">
          <h3>${esc(title)}</h3>${note ? `<p class="chart-note">${esc(note)}</p>` : ''}
          <div class="chart${tall ? ' tall' : ''}"><canvas id="${id}"></canvas></div>${footer}
        </section>`);
      charts.push({ id, config });
    },
    html(text) { parts.push(text); },
    done() { return { html: parts.join(''), charts }; }
  };
}

const anyValue = (values) => values.some((v) => v !== null);
const empty = (text) => `<section class="card"><p>${esc(text)}</p></section>`;

// ---------- Overview ----------

function overview(ctx) {
  const b = builder();
  const has = (id) => ctx.questions.has(id);
  const label = (id) => ctx.questions.get(id).q.label;
  const how = ctx.smooth ? '7-day average' : 'Daily';
  let shown = 0;

  const moodIds = ['mood', 'anxiety', 'stress', 'irritability', 'energy'].filter(has);
  const moodSets = moodIds.map((id) => ({
    label: label(id), data: series(ctx, getterFor(ctx, `q:${id}`)), hidden: id === 'irritability' || id === 'energy'
  }));
  if (moodSets.some((s) => anyValue(s.data))) {
    b.chart('Mood', `${how}, 0–10. Tap a name to show or hide it.`, lineConfig(ctx.labels, moodSets, { min: 0, max: 10 }), '', true);
    shown++;
  }

  if (has('pain_sites')) {
    const groups = buckets(ctx);
    const sites = ctx.questions.get('pain_sites').q.options;
    const sets = sites.map((o) => ({
      label: o.label.split(/ [/(]/)[0],
      data: groups.map((g) => g.days.filter((d) => (answer(ctx, d, 'pain_sites') || []).includes(o.value)).length)
    })).filter((s) => s.data.some((x) => x > 0));
    if (sets.length) {
      b.chart('Pain', `Days with pain per ${ctx.bucket}, by site`, barConfig(groups.map((g) => g.label), sets, { stacked: true }));
      shown++;
    }
  }

  const sleep = series(ctx, getterFor(ctx, 'calc:sleep'));
  if (anyValue(sleep)) {
    const s = stats(ctx.days.map(getterFor(ctx, 'calc:sleep')));
    const config = lineConfig(ctx.labels, [{ label: 'Hours asleep', data: sleep }], { legend: false });
    config.options.scales.y.beginAtZero = false;
    b.chart('Time asleep', `${how}, hours`, config, `<p class="chart-foot">Average ${round1(s.mean)} h over ${s.n} nights.</p>`);
    shown++;
  }

  if (has('sleep_quality')) {
    const quality = series(ctx, getterFor(ctx, 'q:sleep_quality'));
    if (anyValue(quality)) {
      b.chart('Sleep quality', `${how}, 1 = very poor, 5 = very good`,
        lineConfig(ctx.labels, [{ label: 'Sleep quality', data: quality }], { min: 1, max: 5, legend: false }));
      shown++;
    }
  }

  const perBucket = (getter) => buckets(ctx).map((g) => g.days.reduce((sum, d) => sum + (getter(d) || 0), 0));
  const bucketLabels = buckets(ctx).map((g) => g.label);

  if (has('exercise_any')) {
    const getter = getterFor(ctx, 'calc:exercise');
    const answered = ctx.days.filter((d) => typeof answer(ctx, d, 'exercise_any') === 'boolean').length;
    const active = ctx.days.filter((d) => answer(ctx, d, 'exercise_any') === true).length;
    if (active) {
      b.chart('Exercise', `Minutes per ${ctx.bucket}`, barConfig(bucketLabels, [{ label: 'Minutes', data: perBucket(getter) }], { legend: false }),
        `<p class="chart-foot">Exercised on ${active} of ${answered} answered days.</p>`);
      shown++;
    }
  }

  if (has('alcohol_drinks')) {
    const drinks = perBucket(getterFor(ctx, 'calc:alcohol'));
    const total = drinks.reduce((sum, x) => sum + x, 0);
    const hangovers = has('hangover') ? ctx.days.filter((d) => answer(ctx, d, 'hangover') === true).length : 0;
    if (total || hangovers) {
      b.chart('Alcohol', `Drinks per ${ctx.bucket}`, barConfig(bucketLabels, [{ label: 'Drinks', data: drinks }], { legend: false }),
        `<p class="chart-foot">${total} ${total === 1 ? 'drink' : 'drinks'} in this period${has('hangover')
          ? `, hangover on ${hangovers} ${hangovers === 1 ? 'day' : 'days'}` : ''}.</p>`);
      shown++;
    }
  }

  if (has('panic_attack')) {
    const counts = perBucket((d) => (answer(ctx, d, 'panic_attack') === true ? 1 : 0));
    if (counts.some(Boolean)) {
      b.chart('Panic attacks', `Days with a panic attack per ${ctx.bucket}`,
        barConfig(bucketLabels, [{ label: 'Days', data: counts }], { legend: false }));
      shown++;
    }
  }

  const cyc = ctx.cycles.cycles.filter((c) => c.length && c.start >= addDays(ctx.from, -60) && c.start <= ctx.to);
  if (cyc.length) {
    b.chart('Cycle length', 'Days from one period to the next, and period length',
      barConfig(cyc.map((c) => formatShortDate(c.start)), [
        { label: 'Cycle', data: cyc.map((c) => c.length) },
        { label: 'Period', data: cyc.map((c) => c.periodLength) }
      ]),
      `<p class="chart-foot">Typical cycle ${ctx.cycles.avgCycle} days, period ${ctx.cycles.avgPeriod} days` +
      ` (from your last ${ctx.cycles.basedOn || 0} cycles).</p>`);
    shown++;
  }

  const scorePacks = ctx.config.packs.filter((p) => p.score && !p.retired && p.enabled !== false);
  const small = scorePacks.filter((p) => (p.score.max || 0) <= 40);
  const smallSets = small.map((p) => ({ label: p.score.label, data: ctx.days.map(getterFor(ctx, `score:${p.id}`)) }))
    .filter((s) => anyValue(s.data));
  if (smallSets.length) {
    b.chart('Questionnaire scores', 'Totals each time you filled them in (higher = more symptoms)',
      lineConfig(ctx.labels, smallSets.map((s) => ({ ...s, marker: true }))));
    shown++;
  }
  for (const p of scorePacks.filter((x) => (x.score.max || 0) > 40)) {
    const data = ctx.days.map(getterFor(ctx, `score:${p.id}`));
    if (anyValue(data)) {
      b.chart(p.score.label, 'Higher = better well-being',
        lineConfig(ctx.labels, [{ label: p.score.label, data, marker: true }], { min: 0, max: p.score.max, legend: false }));
      shown++;
    }
  }

  const vulvaIds = ['fissure', 'itch', 'nextday'].filter(has);
  const vulvaSets = vulvaIds.map((id) => ({ label: label(id), data: series(ctx, getterFor(ctx, `q:${id}`)) }));
  if (vulvaSets.some((s) => anyValue(s.data))) {
    b.chart('Vulva', `${how}, 0–3`, lineConfig(ctx.labels, vulvaSets, { min: 0, max: 3 }));
    shown++;
  }

  if (!shown) b.html(empty('No answers in this period yet.'));
  return b.done();
}

// ---------- Explore ----------

function exploreItems(ctx) {
  const groups = [];
  for (const pack of ctx.config.packs) {
    if (pack.retired) continue;
    const items = pack.questions.filter((q) => !q.retired).map((q) => ({ key: `q:${q.id}`, label: q.label }));
    if (items.length) groups.push({ label: pack.title, items });
  }
  const scores = ctx.config.packs.filter((p) => p.score && !p.retired).map((p) => ({ key: `score:${p.id}`, label: p.score.label }));
  const calculated = [{ key: 'calc:sleep', label: 'Time asleep (hours, until Oct 2026)' }, { key: 'calc:pain', label: 'Worst pain of the day' },
    { key: 'calc:alcohol', label: 'Alcoholic drinks (0 on days without)' },
    { key: 'calc:exercise', label: 'Exercise minutes (0 on days without)' },
    { key: 'calc:cycle', label: 'Cycle and period length' }];
  return [...groups, { label: 'Scores', items: scores }, { label: 'Calculated', items: calculated }].filter((g) => g.items.length);
}

function explore(ctx) {
  const groups = exploreItems(ctx);
  const all = groups.flatMap((g) => g.items);
  if (!all.some((i) => i.key === ui.item)) ui.item = all[0].key;
  const b = builder();
  b.html(`<label class="picker">Question
      <select id="explore-item">
        ${groups.map((g) => `<optgroup label="${esc(g.label)}">${g.items.map((i) =>
          `<option value="${esc(i.key)}" ${i.key === ui.item ? 'selected' : ''}>${esc(i.label)}</option>`).join('')}</optgroup>`).join('')}
      </select></label>`);

  const [kind, id] = ui.item.split(':');
  const q = kind === 'q' ? ctx.questions.get(id).q : null;
  const title = all.find((i) => i.key === ui.item).label;

  if (ui.item === 'calc:cycle') return exploreCycle(ctx, b);
  if (!q || q.type === 'scale' || q.type === 'number' || (q.type === 'single' && q.options.every((o) => typeof o.value === 'number'))) {
    return exploreNumbers(ctx, b, title, getterFor(ctx, ui.item), q);
  }
  if (q.type === 'yesno') return exploreYesNo(ctx, b, title, q);
  if (q.type === 'single' || q.type === 'multi') return exploreChoices(ctx, b, title, q);
  if (q.type === 'time') return exploreTimes(ctx, b, title, q);
  return exploreText(ctx, b, title, q);
}

function exploreNumbers(ctx, b, title, getter, q) {
  const daily = ctx.days.map(getter);
  const s = stats(daily);
  if (!s) { b.html(empty('No answers for this question in this period.')); return b.done(); }
  const datasets = ctx.smooth
    ? [{ label: 'Each day', data: daily, points: true, color: colours().series[1] }, { label: '7-day average', data: rollingMean(daily, 7) }]
    : [{ label: title, data: daily }];
  const range = q && q.type === 'scale' ? { min: q.min, max: q.max } : {};
  const optionText = q && q.type === 'single'
    ? `<p class="chart-foot">${q.options.map((o) => `${o.value} = ${esc(o.label.replace(/^\d+ · /, ''))}`).join('; ')}</p>` : '';
  b.chart(title, ctx.smooth ? 'Dots: each day. Line: 7-day average.' : 'Each day',
    lineConfig(ctx.labels, datasets, { ...range, legend: ctx.smooth }),
    `<p class="chart-foot">Answered on ${s.n} days. Average ${round1(s.mean)}, median ${round1(s.median)},
      range ${round1(s.min)}–${round1(s.max)}.</p>${optionText}`);
  return b.done();
}

function exploreYesNo(ctx, b, title, q) {
  const groups = buckets(ctx);
  const rows = groups.map((g) => {
    const answered = g.days.map((d) => answer(ctx, d, q.id)).filter((v) => typeof v === 'boolean');
    return { label: g.label, yes: answered.filter(Boolean).length, n: answered.length };
  });
  const yes = rows.reduce((s, r) => s + r.yes, 0);
  const n = rows.reduce((s, r) => s + r.n, 0);
  if (!n) { b.html(empty('No answers for this question in this period.')); return b.done(); }
  b.chart(title, `Share of answered days with "Yes", per ${ctx.bucket}`,
    barConfig(rows.map((r) => r.label), [{ label: 'Yes', data: rows.map((r) => (r.n ? Math.round((r.yes / r.n) * 100) : null)) }],
      { max: 100, legend: false, percentAxis: true }),
    `<p class="chart-foot">Yes on ${yes} of ${n} answered days (${percent(yes / n)}).</p>`);
  return b.done();
}

function exploreChoices(ctx, b, title, q) {
  const counts = q.options.map((o) => ({
    label: o.label,
    n: ctx.days.filter((d) => {
      const v = answer(ctx, d, q.id);
      return Array.isArray(v) ? v.includes(o.value) : v === o.value;
    }).length
  }));
  const answered = ctx.days.filter((d) => answer(ctx, d, q.id) !== undefined).length;
  if (!answered) { b.html(empty('No answers for this question in this period.')); return b.done(); }
  const height = Math.max(160, counts.length * 30);
  b.html(`<section class="card chart-card"><h3>${esc(title)}</h3>
      <p class="chart-note">Number of days with each answer (${answered} answered days)</p>
      <div class="chart" style="height:${height}px"><canvas id="chart-0"></canvas></div></section>`);
  const out = b.done();
  out.charts.push({ id: 'chart-0', config: barConfig(counts.map((c) => c.label), [{ label: 'Days', data: counts.map((c) => c.n) }], { horizontal: true, legend: false }) });
  return out;
}

function exploreTimes(ctx, b, title, q) {
  const minutes = ctx.days.map((d) => {
    const v = answer(ctx, d, q.id);
    if (typeof v !== 'string') return null;
    const [h, m] = v.split(':').map(Number);
    return h * 60 + m;
  });
  const known = minutes.filter((v) => v !== null);
  if (!known.length) { b.html(empty('No answers for this question in this period.')); return b.done(); }
  // Times around midnight (e.g. bedtimes): if counting early-morning times as "after midnight"
  // gives a tighter spread, do that (00:30 then sits next to 23:30 instead of far below it).
  const spread = (list) => {
    const m = list.reduce((sum, v) => sum + v, 0) / list.length;
    return list.reduce((sum, v) => sum + (v - m) ** 2, 0);
  };
  const shift = (v) => (v < 12 * 60 ? v + 1440 : v);
  const wrap = spread(known.map(shift)) < spread(known);
  const values = minutes.map((v) => (v === null ? null : wrap ? shift(v) : v));
  const clock = (v) => {
    const m = ((Math.round(v) % 1440) + 1440) % 1440;
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  };
  const s = stats(values);
  const shownValues = ctx.smooth ? rollingMean(values, 7) : values;
  b.chart(title, ctx.smooth ? '7-day average' : 'Each day',
    lineConfig(ctx.labels, [{ label: title, data: shownValues }], { legend: false, tickFormat: clock }),
    `<p class="chart-foot">Answered on ${s.n} days. Average ${clock(s.mean)}, earliest ${clock(s.min)}, latest ${clock(s.max)}.</p>`);
  const out = b.done();
  out.charts[0].config.options.scales.y.beginAtZero = false;
  return out;
}

function exploreText(ctx, b, title, q) {
  const items = [...ctx.days].reverse()
    .map((d) => ({ d, v: answer(ctx, d, q.id) }))
    .filter((x) => typeof x.v === 'string' && x.v.trim());
  if (!items.length) { b.html(empty('No answers for this question in this period.')); return b.done(); }
  b.html(`<section class="card"><h3 class="card-title">${esc(title)}</h3>
      ${items.slice(0, 100).map((x) => `<div class="row text-row"><span>${formatShortDate(x.d)}</span><span>${esc(x.v)}</span></div>`).join('')}
    </section>`);
  return b.done();
}

function exploreCycle(ctx, b) {
  const cyc = ctx.cycles.cycles.filter((c) => c.start >= addDays(ctx.from, -60) && c.start <= ctx.to);
  if (!cyc.length) { b.html(empty('No periods logged in this period.')); return b.done(); }
  b.chart('Cycle and period length', 'Each bar is one cycle, labelled with its first day',
    barConfig(cyc.map((c) => formatShortDate(c.start)), [
      { label: 'Cycle length', data: cyc.map((c) => c.length) },
      { label: 'Period length', data: cyc.map((c) => c.periodLength) }
    ]),
    `<p class="chart-foot">Typical cycle ${ctx.cycles.avgCycle} days, period ${ctx.cycles.avgPeriod} days. The current cycle has no length yet.</p>`);
  return b.done();
}

// ---------- Insights ----------

function insights(ctx) {
  const b = builder();
  b.html(foodInsight(ctx));
  b.html(phaseInsight(ctx));
  b.html(vulvaInsight(ctx));
  b.html(`<p class="source">These are patterns in your own data, not proof of cause. With small numbers, treat
    differences as hints to test, not conclusions.</p>`);
  return b.done();
}

const OUTCOMES = [
  ['stomach', 'Stomach pain', (a) => (a.pain_any === false ? false : Array.isArray(a.pain_sites) ? a.pain_sites.includes('stomach') : null)],
  ['gi', 'Digestive', (a) => (typeof a.gi_any === 'boolean' ? a.gi_any : null)],
  ['reaction', 'Reaction', (a) => (typeof a.reaction_any === 'boolean' ? a.reaction_any : null)],
  ['head', 'Headache', (a) => (a.pain_any === false ? false : Array.isArray(a.pain_sites) ? a.pain_sites.includes('head') : null)]
];

function foodInsight(ctx) {
  const foodQuestions = ['food_allergens', 'food_triggers'].filter((id) => ctx.questions.has(id));
  if (!foodQuestions.length) return '';
  const [, outcomeLabel, outcomeOf] = OUTCOMES.find((o) => o[0] === ui.outcome) || OUTCOMES[0];

  const rows = [];
  for (const qid of foodQuestions) {
    for (const option of ctx.questions.get(qid).q.options) {
      if (option.exclusive) continue;
      let a = 0; let b = 0; let c = 0; let d = 0;              // a,b = ate it (symptom yes/no); c,d = didn't
      for (const date of ctx.days) {
        const foods = answer(ctx, date, qid);
        if (!Array.isArray(foods)) continue;
        const outcome = outcomeOf(ctx.answersFor(addDays(date, ui.lag)));
        if (outcome === null || outcome === undefined) continue;
        if (foods.includes(option.value)) { if (outcome) a++; else b++; } else if (outcome) c++; else d++;
      }
      if (a + b < 3 || c + d < 3) continue;
      rows.push({ label: option.label.split(' (')[0], a, b, c, d, rateWith: a / (a + b), rateWithout: c / (c + d), p: fisherExact(a, b, c, d) });
    }
  }
  rows.sort((x, y) => x.p - y.p || (y.rateWith - y.rateWithout) - (x.rateWith - x.rateWithout));

  const outcomeButtons = OUTCOMES.map(([id, label]) =>
    `<button type="button" data-outcome="${id}" aria-pressed="${ui.outcome === id}">${label}</button>`).join('');
  const lagButtons = [[0, 'Same day'], [1, 'Next day']].map(([lag, label]) =>
    `<button type="button" data-lag="${lag}" aria-pressed="${ui.lag === lag}">${label}</button>`).join('');
  const list = rows.length
    ? rows.slice(0, 15).map((r) => `
        <div class="assoc${r.p < 0.05 && r.rateWith > r.rateWithout ? ' strong' : ''}">
          <div class="assoc-head"><span>${esc(r.label)}</span><span>p = ${r.p < 0.001 ? '<0.001' : r.p.toFixed(3)}</span></div>
          <div class="assoc-bars">
            <span class="bar-label">With</span><span class="meter"><span style="width:${Math.round(r.rateWith * 100)}%"></span></span>
            <span class="bar-value">${percent(r.rateWith)} of ${r.a + r.b}</span>
            <span class="bar-label">Without</span><span class="meter muted"><span style="width:${Math.round(r.rateWithout * 100)}%"></span></span>
            <span class="bar-value">${percent(r.rateWithout)} of ${r.c + r.d}</span>
          </div>
        </div>`).join('')
    : '<p class="chart-foot">Not enough days yet: each food needs at least 3 days with and 3 without.</p>';

  return `<h2 class="section">Food and symptoms</h2>
    <section class="card insight">
      <p class="chart-note">How often you had the symptom on days you ate each item, compared with days you didn't.
        Ordered by Fisher's exact test (smallest p first). Many items are tested at once, so some low p-values are chance.</p>
      <div class="segmented small" role="group" aria-label="Symptom">${outcomeButtons}</div>
      <div class="segmented small" role="group" aria-label="When">${lagButtons}</div>
      <p class="chart-foot"><strong>${esc(outcomeLabel)}</strong> ${ui.lag ? 'the day after eating' : 'on the same day'}</p>
      ${list}
    </section>`;
}

// Two-sided Fisher's exact test for a 2×2 table [[a, b], [c, d]].
function fisherExact(a, b, c, d) {
  const n = a + b + c + d;
  const logFact = [0];
  for (let i = 1; i <= n; i++) logFact[i] = logFact[i - 1] + Math.log(i);
  const row1 = a + b;
  const row2 = c + d;
  const col1 = a + c;
  const prob = (x) => Math.exp(logFact[row1] + logFact[row2] + logFact[col1] + logFact[n - col1] -
    logFact[x] - logFact[row1 - x] - logFact[col1 - x] - logFact[row2 - col1 + x] - logFact[n]);
  const observed = prob(a);
  let p = 0;
  for (let x = Math.max(0, col1 - row2); x <= Math.min(row1, col1); x++) {
    const px = prob(x);
    if (px <= observed * (1 + 1e-7)) p += px;
  }
  return Math.min(1, p);
}

function phaseInsight(ctx) {
  if (!ctx.cycles.cycles.length) return '';
  const measures = [
    ['mood', 'Mood'], ['anxiety', 'Anxiety'], ['stress', 'Stress'], ['irritability', 'Irritability'], ['energy', 'Energy'],
    ['calc:pain', 'Worst pain'], ['itch', 'Itching'], ['fissure', 'Tearing'], ['sleep_quality', 'Sleep quality'],
    ['calc:sleep', 'Hours asleep'], ['calc:alcohol', 'Alcohol drinks'], ['calc:exercise', 'Exercise min'], ['health_overall', 'Overall health']
  ].filter(([id]) => id.startsWith('calc:') || ctx.questions.has(id));
  const phases = PHASES.filter((p) => p.id !== 'unclear');
  const short = { menstruation: 'Period', follicular: 'Follic.', ovulation: 'Ovul.', luteal: 'Luteal', premenstrual: 'Pre-' };
  const phaseOf = new Map(ctx.days.map((d) => [d, (cycleDayInfo(ctx.cycles, d) || {}).phase]));

  const rows = measures.map(([id, label]) => {
    const getter = id.startsWith('calc:') ? getterFor(ctx, id) : getterFor(ctx, `q:${id}`);
    const means = phases.map((p) => stats(ctx.days.filter((d) => phaseOf.get(d) === p.id).map(getter)));
    const values = means.filter(Boolean).map((m) => m.mean);
    if (values.length < 2) return '';
    const hi = Math.max(...values);
    const lo = Math.min(...values);
    return `<tr><th scope="row">${esc(label)}</th>${means.map((m) => (m
      ? `<td class="${m.mean === hi ? 'hi' : m.mean === lo ? 'lo' : ''}" title="n = ${m.n}">${round1(m.mean)}</td>` : '<td>–</td>')).join('')}</tr>`;
  }).filter(Boolean);
  if (!rows.length) return '';

  return `<h2 class="section">By cycle phase</h2>
    <section class="card insight">
      <p class="chart-note">Average per phase. Highest in each row is marked. Pre- = premenstrual (last 5 days before a period).</p>
      <div class="table-wrap"><table class="phase-table">
        <thead><tr><th></th>${phases.map((p) => `<th scope="col">${short[p.id]}</th>`).join('')}</tr></thead>
        <tbody>${rows.join('')}</tbody>
      </table></div>
    </section>`;
}

// The spreadsheet's evaluation: for sex days, compare the outcomes per variant of each factor.
function vulvaInsight(ctx) {
  if (!ctx.questions.has('sex')) return '';
  const sexDays = ctx.days.filter((d) => answer(ctx, d, 'sex') === true);
  if (!sexDays.length) {
    return `<h2 class="section">Sex and vulva</h2>${empty('No sex days logged in this period.')}`;
  }
  const mean = (list) => (list.length ? round1(list.reduce((s, x) => s + x, 0) / list.length) : '–');
  const outcomesFor = (days) => {
    const tearing = days.map((d) => answer(ctx, d, 'fissure')).filter((v) => typeof v === 'number');
    const during = days.map((d) => answer(ctx, d, 'sex_symptoms')).filter((v) => typeof v === 'number');
    const next = days.map((d) => answer(ctx, addDays(d, 1), 'nextday')).filter((v) => typeof v === 'number');
    return {
      n: days.length,
      during: mean(during),
      tearing: mean(tearing),
      noTear: tearing.length ? percent(tearing.filter((v) => v === 0).length / tearing.length) : '–',
      next: mean(next)
    };
  };
  const optionLabel = (qid, value) => {
    const info = ctx.questions.get(qid);
    const option = info && info.q.options && info.q.options.find((o) => o.value === value);
    return option ? option.label : value === true ? 'Yes' : value === false ? 'No' : String(value);
  };
  const factors = [
    ['condom', 'Condom', (d) => answer(ctx, d, 'condom')],
    ['lube', 'Lubricant', (d) => answer(ctx, d, 'lube')],
    ['shave_since', 'Last shave', (d) => answer(ctx, d, 'shave_since')],
    ['creams', 'Creams that day', (d) => {
      const list = answer(ctx, d, 'creams');
      if (Array.isArray(list)) return list;
      const old = answer(ctx, d, 'oekolp');                     // before 1.2.0 only OeKolp was asked
      return old === true ? ['oekolp'] : old === false ? ['none'] : undefined;
    }],
    ['probiotics', 'Probiotics that day', (d) => answer(ctx, d, 'probiotics')],
    ['phase', 'Cycle phase', (d) => (cycleDayInfo(ctx.cycles, d) || { phase: 'unclear' }).phase],
    ['test_factor', 'Active test', (d) => {
      const f = answer(ctx, d, 'test_factor');
      if (f === undefined) return undefined;
      const variant = answer(ctx, d, 'test_variant');
      return `${optionLabel('test_factor', f)}${variant && f !== 'none' ? `: ${variant}` : ''}`;
    }]
  ].filter(([id]) => id === 'phase' || ctx.questions.has(id));

  const all = outcomesFor(sexDays);
  const tables = factors.map(([id, title, valueOf]) => {
    const groups = new Map();
    for (const d of sexDays) {
      const v = valueOf(d);
      if (v === undefined || v === null) continue;
      for (const one of Array.isArray(v) ? v : [v]) {           // multi-choice: a day counts for each answer
        if (!groups.has(one)) groups.set(one, []);
        groups.get(one).push(d);
      }
    }
    if (!groups.size) return '';
    const rows = [...groups.entries()].map(([v, days]) => {
      const o = outcomesFor(days);
      const name = id === 'phase' ? (PHASES.find((p) => p.id === v) || { label: v }).label
        : id === 'test_factor' ? v : optionLabel(id, v);
      return `<tr><th scope="row">${esc(name)}</th><td>${o.n}</td><td>${o.during}</td><td>${o.tearing}</td><td>${o.noTear}</td><td>${o.next}</td></tr>`;
    });
    return `<h3 class="table-title">${esc(title)}</h3>
      <div class="table-wrap"><table class="factor-table">
        <thead><tr><th></th><th>Days</th><th>During</th><th>Tear</th><th>No tear</th><th>Next</th></tr></thead>
        <tbody>${rows.join('')}</tbody></table></div>`;
  }).join('');

  return `<h2 class="section">Sex and vulva</h2>
    <section class="card insight">
      <p class="chart-note">Sex days only. During = symptoms during sex, Tear = tearing/soreness, Next = symptoms the
        following day (from that day's entry): averages on the 0–3 scale. No tear = share of sex days with tearing 0.</p>
      <div class="kpis">
        <div><strong>${all.n}</strong><span>sex days</span></div>
        <div><strong>${all.noTear}</strong><span>without tearing</span></div>
        <div><strong>${all.tearing}</strong><span>avg tearing</span></div>
        <div><strong>${all.next}</strong><span>avg next day</span></div>
      </div>
      ${tables}
    </section>`;
}
