// Diary – Day screen: a short summary of the day, then the packs with their status.
// "Today" is this screen for the current date; past days are opened from the Calendar.
import { dbGetAll } from './db.js';
import { getConfig } from './config.js';
import {
  logicalDate, formatLongDate, formatShortDate, isISODate, escapeHtml as esc,
  makeAnswerLookup, packsForDay, computeScore
} from './logic.js';

const STATUS_TEXT = { done: 'Done', partial: 'Started', new: '' };

export async function dayScreen(date) {
  const today = logicalDate();
  const isToday = date === today;
  const header = isToday
    ? { title: 'Today', subtitle: formatLongDate(date), tab: 'today' }
    : {
      title: isISODate(date) ? formatShortDate(date) : 'Day',
      subtitle: isISODate(date) ? formatLongDate(date) : '',
      back: { href: `#/calendar/${(isISODate(date) ? date : today).slice(0, 7)}`, label: 'Calendar' },
      tab: 'calendar'
    };
  const message = (text) => ({ ...header, html: `<section class="card"><p>${esc(text)}</p></section>` });

  if (!isISODate(date)) return message('This is not a valid date.');
  if (date > today) return message("This day hasn't happened yet.");

  const config = getConfig();
  if (!config) {
    return {
      ...header,
      html: `<section class="card"><p>Connect your private data repo in Settings to load your questions.</p></section>
             <a class="button" href="#/settings">Open Settings</a>`
    };
  }

  const entries = await dbGetAll('entries');
  const answersFor = makeAnswerLookup(entries);
  const entryDates = entries.map((e) => e.date).sort();
  const { due, later } = packsForDay(config, date, entryDates, answersFor);

  const row = ({ pack, status, next }) => `
    <a class="row link" href="#/pack/${encodeURIComponent(pack.id)}/${date}">
      <span>${esc(pack.title)}</span>
      <span class="state ${status}">${next ? `Next ${formatShortDate(next)}` : STATUS_TEXT[status]}</span>
    </a>`;

  const doneCount = due.filter((d) => d.status === 'done').length;
  let html = summaryHtml(config, answersFor(date));
  html += `
    <h2 class="section split"><span>${isToday ? 'Due today' : 'Due this day'}</span>
      <span>${doneCount} of ${due.length} done</span></h2>
    <section class="card">${due.map(row).join('')}</section>`;
  if (later.length) {
    html += `
      <h2 class="section">Not due yet</h2>
      <section class="card">${later.map(row).join('')}</section>`;
  }
  return { ...header, html };
}

// ---------- Summary ----------
// A few key answers at a glance. Each line only appears if that question exists and was answered.

function summaryHtml(config, answers) {
  const questions = new Map(config.packs.flatMap((p) => p.questions.map((q) => [q.id, q])));
  const optionLabel = (id, value) => {
    const q = questions.get(id);
    const option = q && q.options && q.options.find((o) => o.value === value);
    return option ? option.label : String(value);
  };
  const shortLabel = (label) => label.split(/ [/(]/)[0];
  const rows = [];

  if (answers.period_flow && answers.period_flow !== 'none') {
    rows.push(textRow('Bleeding', optionLabel('period_flow', answers.period_flow)));
  }
  for (const id of ['mood', 'anxiety', 'stress', 'energy', 'irritability']) {
    const q = questions.get(id);
    if (q && typeof answers[id] === 'number') rows.push(barRow(q.label, answers[id], q.min, q.max));
  }
  if (Array.isArray(answers.pain_sites)) {
    const parts = answers.pain_sites.map((site) => {
      const intensity = answers[`pain_${site}`];
      const label = shortLabel(optionLabel('pain_sites', site));
      return typeof intensity === 'number' ? `${label} ${intensity}` : label;
    });
    rows.push(textRow('Pain', parts.join(', ')));
  }
  const minutes = sleepMinutes(answers);
  const quality = answers.sleep_quality !== undefined ? optionLabel('sleep_quality', answers.sleep_quality) : null;
  if (minutes !== null || quality) {
    const duration = minutes !== null ? `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min` : null;
    rows.push(textRow('Sleep', [duration, quality && quality.toLowerCase()].filter(Boolean).join(', ')));
  }
  if (typeof answers.sex === 'boolean') rows.push(textRow('Sex', answers.sex ? 'Yes' : 'No'));
  for (const pack of config.packs) {
    if (!pack.score) continue;
    const score = computeScore(pack.score, answers);
    if (score !== null) rows.push(textRow(pack.score.label, String(score)));
  }

  if (!rows.length) return '';
  return `<h2 class="section">Summary</h2><section class="card summary">${rows.join('')}</section>`;
}

function textRow(label, value) {
  return `<div class="row"><span>${esc(label)}</span><span>${esc(value)}</span></div>`;
}

function barRow(label, value, min = 0, max = 10) {
  const percent = Math.round(((value - min) / (max - min)) * 100);
  return `<div class="row bar">
      <span class="label">${esc(label)}</span>
      <span class="meter"><span style="width:${percent}%"></span></span>
      <span>${value}</span>
    </div>`;
}

// Time asleep from the sleep diary: (final awakening − time trying to sleep) − time to fall asleep − time awake.
function sleepMinutes(a) {
  const start = a.sleep_try || a.sleep_bed;
  if (!start || !a.sleep_final) return null;
  const toMinutes = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  let span = toMinutes(a.sleep_final) - toMinutes(start);
  if (span <= 0) span += 24 * 60;
  const asleep = span - (a.sleep_latency || 0) - (a.sleep_waso || 0);
  return asleep > 0 ? asleep : null;
}
