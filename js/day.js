// Diary – Day screen: which packs are due on a date, and how far you got with each.
import { dbGetAll } from './db.js';
import { getConfig } from './config.js';
import {
  logicalDate, formatLongDate, formatShortDate, escapeHtml as esc,
  makeAnswerLookup, packStatus, dueInfo, evaluate, addDays
} from './logic.js';

const STATUS_TEXT = { done: 'Done', partial: 'Started', new: '' };

export async function dayScreen(date) {
  const isToday = date === logicalDate();
  const title = isToday ? 'Today' : formatShortDate(date);
  const subtitle = formatLongDate(date);
  const config = getConfig();

  if (!config) {
    return {
      title, subtitle,
      html: `<section class="card"><p>Connect your private data repo in Settings to load your questions.</p></section>
             <a class="button" href="#/settings">Open Settings</a>`
    };
  }

  const entries = await dbGetAll('entries');
  const answersFor = makeAnswerLookup(entries);
  const entryDates = entries.map((e) => e.date).sort();
  const sameDay = (id, day) => answersFor(addDays(date, day || 0))[id];

  const due = [];
  const later = [];
  for (const pack of config.packs) {
    if (pack.retired || pack.enabled === false) continue;
    if (!evaluate(pack.showIf, sameDay)) continue;
    const status = packStatus(pack, date, answersFor);
    if (status !== 'new') {
      due.push({ pack, status });
      continue;
    }
    const { due: isDue, next } = dueInfo(pack, date, entryDates, answersFor);
    if (isDue) due.push({ pack, status });
    else later.push({ pack, status, next });
  }

  const row = ({ pack, status, next }) => `
    <a class="row link" href="#/pack/${encodeURIComponent(pack.id)}/${date}">
      <span>${esc(pack.title)}</span>
      <span class="state ${status}">${next ? `Next ${formatShortDate(next)}` : STATUS_TEXT[status]}</span>
    </a>`;

  const doneCount = due.filter((d) => d.status === 'done').length;
  let html = `
    <h2 class="section split"><span>${isToday ? 'Due today' : 'Due this day'}</span>
      <span>${doneCount} of ${due.length} done</span></h2>
    <section class="card">${due.map(row).join('')}</section>`;
  if (later.length) {
    html += `
      <h2 class="section">Not due yet</h2>
      <section class="card">${later.map(row).join('')}</section>`;
  }
  return { title, subtitle, html };
}
