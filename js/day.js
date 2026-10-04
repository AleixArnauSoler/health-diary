// Diary – Day screen: a short summary of the day, then the packs with their status.
// "Today" is this screen for the current date; past days are opened from the Calendar.
import { dbGetAll, isDemoMode } from './db.js';
import { getConfig } from './config.js';
import { getSyncState, onSyncChange } from './sync.js';
import { analyseCycles, cycleDayInfo, cycleSummary, phaseLabel } from './cycle.js';
import {
  logicalDate, formatLongDate, formatShortDate, formatDateTime, isISODate, escapeHtml as esc,
  makeAnswerLookup, packsForDay, computeScore, sleepMinutes
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

  const cycles = analyseCycles(entryDates, answersFor);
  const doneCount = due.filter((d) => d.status === 'done').length;
  let html = isToday ? cycleCardHtml(cycles, today, config) : '';
  html += summaryHtml(config, answersFor(date), cycleDayInfo(cycles, date));
  html += `
    <h2 class="section split"><span>${isToday ? 'Due today' : 'Due this day'}</span>
      <span>${doneCount} of ${due.length} done</span></h2>
    <section class="card">${due.map(row).join('')}</section>`;
  if (later.length) {
    html += `
      <h2 class="section">Not due yet</h2>
      <section class="card">${later.map(row).join('')}</section>`;
  }
  if (!isToday || isDemoMode()) return { ...header, html };

  // Today: a line about the GitHub backup, kept up to date while the screen is open.
  html += `<p class="status" id="sync-line">${esc(syncText(getSyncState()))}</p>`;
  return {
    ...header,
    html,
    mount: (view) => {
      const line = view.querySelector('#sync-line');
      return onSyncChange((state) => { line.textContent = syncText(state); });
    }
  };
}

function syncText(state) {
  const waiting = state.pending ? ` ${state.pending} ${state.pending === 1 ? 'day' : 'days'} waiting to upload.` : '';
  switch (state.status) {
    case 'not-set-up': return 'Backup to GitHub is not set up yet (Settings → Encryption key).';
    case 'syncing': return 'Backing up…';
    case 'offline': return `Offline.${waiting}`;
    case 'error': return `Backup failed: ${state.message}${waiting}`;
    default: return state.lastSync ? `Backed up ${formatDateTime(state.lastSync)}.${waiting}` : waiting.trim();
  }
}

// ---------- Cycle card (Today) ----------

function cycleCardHtml(cycles, today, config) {
  const hasFlowQuestion = config.packs.some((p) => !p.retired && p.enabled !== false &&
    p.questions.some((q) => q.id === 'period_flow' && !q.retired));
  const s = cycleSummary(cycles, today);
  if (!s) {
    return hasFlowQuestion
      ? '<section class="card cycle-card"><p class="cycle-note">Log bleeding in the Cycle pack to see your cycle day and predictions.</p></section>'
      : '';
  }
  const headline = s.phase === 'unclear' ? `Cycle day ${s.day}` : `Cycle day ${s.day}, ${phaseLabel(s.phase).toLowerCase()} phase`;
  let next;
  if (s.untilNext > 1) next = `Next period around ${formatShortDate(s.next)} (in ${s.untilNext} days)`;
  else if (s.untilNext === 1) next = 'Next period expected tomorrow';
  else if (s.untilNext === 0) next = 'Next period expected today';
  else next = `Period expected since ${formatShortDate(s.next)} (${-s.untilNext} ${s.untilNext === -1 ? 'day' : 'days'} late)`;
  let fertile = '';
  if (today >= s.fertileFrom && today <= s.fertileTo) fertile = `Fertile window now, until about ${formatShortDate(s.fertileTo)}`;
  else if (today < s.fertileFrom) fertile = `Fertile window about ${formatShortDate(s.fertileFrom)} – ${formatShortDate(s.fertileTo)}`;
  const basis = s.basedOn
    ? `Based on your last ${s.basedOn} ${s.basedOn === 1 ? 'cycle' : 'cycles'}.`
    : 'Based on a 28-day cycle until you have logged two periods.';
  return `<section class="card cycle-card">
      <p class="cycle-head">${esc(headline)}</p>
      <p>${esc(next)}</p>
      ${fertile ? `<p>${esc(fertile)}</p>` : ''}
      <p class="cycle-note">${esc(basis)} Estimates only, not suitable for contraception.</p>
    </section>`;
}

// ---------- Summary ----------
// A few key answers at a glance. Each line only appears if that question exists and was answered.

function summaryHtml(config, answers, cycleInfo) {
  const questions = new Map(config.packs.flatMap((p) => p.questions.map((q) => [q.id, q])));
  const optionLabel = (id, value) => {
    const q = questions.get(id);
    const option = q && q.options && q.options.find((o) => o.value === value);
    return option ? option.label : String(value);
  };
  const shortLabel = (label) => label.split(/ [/(]/)[0];
  const rows = [];

  if (cycleInfo && Object.keys(answers).length) {
    rows.push(textRow('Cycle', cycleInfo.phase === 'unclear'
      ? `Day ${cycleInfo.day}` : `Day ${cycleInfo.day}, ${phaseLabel(cycleInfo.phase).toLowerCase()}`));
  }
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
  const listRow = (id, label) => {
    const v = answers[id];
    if (Array.isArray(v) && !(v.length === 1 && v[0] === 'none')) rows.push(textRow(label, v.map((x) => optionLabel(id, x)).join(', ')));
  };
  listRow('creams', 'Creams');
  if (!Array.isArray(answers.creams) && answers.oekolp === true) rows.push(textRow('Creams', 'OeKolp'));   // before 1.2.0
  if (typeof answers.alcohol_drinks === 'number') {
    rows.push(textRow('Alcohol', `${answers.alcohol_drinks} ${answers.alcohol_drinks === 1 ? 'drink' : 'drinks'}`));
  }
  if (answers.hangover === true) rows.push(textRow('Hangover', 'Yes'));
  if (answers.panic_attack === true) rows.push(textRow('Panic attack', 'Yes'));
  if (answers.exercise_any === true) {
    const types = Array.isArray(answers.exercise_types)
      ? answers.exercise_types.map((t) => optionLabel('exercise_types', t)).join(', ') : 'Yes';
    const minutes = typeof answers.exercise_minutes === 'number' ? ` (${answers.exercise_minutes} min)` : '';
    rows.push(textRow('Exercise', types + minutes));
  }
  listRow('circumstances', 'Going on');
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

