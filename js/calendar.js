// Diary – Calendar: one month at a time. Tap a day to see or edit it.
// Dot colours: green = all packs due that day are done, pink = started.
import { dbGetAll } from './db.js';
import { getConfig } from './config.js';
import { logicalDate, toISODate, makeAnswerLookup, packsForDay } from './logic.js';

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export async function calendarScreen(monthArg) {
  const today = logicalDate();
  const thisMonth = today.slice(0, 7);
  const month = /^\d{4}-\d{2}$/.test(monthArg || '') && monthArg <= thisMonth ? monthArg : thisMonth;
  const [year, monthNumber] = month.split('-').map(Number);

  const config = getConfig();
  const entries = await dbGetAll('entries');
  const answersFor = makeAnswerLookup(entries);
  const entryDates = entries.map((e) => e.date).sort();
  const withEntry = new Set(entryDates);

  const first = new Date(year, monthNumber - 1, 1);
  const daysInMonth = new Date(year, monthNumber, 0).getDate();
  const blanks = (first.getDay() + 6) % 7;             // Monday-first grid

  let cells = WEEKDAYS.map((d) => `<span class="wd" aria-hidden="true">${d}</span>`).join('');
  for (let i = 0; i < blanks; i++) cells += '<span></span>';

  let daysWithEntries = 0;
  let daysComplete = 0;
  for (let day = 1; day <= daysInMonth; day++) {
    const date = toISODate(new Date(year, monthNumber - 1, day));
    const label = new Date(year, monthNumber - 1, day).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
    if (date > today) {
      cells += `<span class="day future"><span>${day}</span><span class="dot"></span></span>`;
      continue;
    }
    let state = '';
    if (config && withEntry.has(date)) {
      const { due } = packsForDay(config, date, entryDates, answersFor);
      const done = due.filter((d) => d.status === 'done').length;
      const started = due.some((d) => d.status !== 'new');
      if (started) daysWithEntries++;
      if (due.length && done === due.length) { state = 'done'; daysComplete++; }
      else if (started) state = 'partial';
    }
    const stateText = state === 'done' ? ', all done' : state === 'partial' ? ', started' : '';
    cells += `<a class="day ${state}${date === today ? ' today' : ''}" href="#/day/${date}" aria-label="${label}${stateText}">
        <span>${day}</span><span class="dot"></span></a>`;
  }

  const shift = (delta) => toISODate(new Date(year, monthNumber - 1 + delta, 1)).slice(0, 7);
  const previous = shift(-1);
  const next = shift(1);
  const monthTitle = first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  const html = `
    <div class="month-nav">
      <a href="#/calendar/${previous}" aria-label="Previous month">‹</a>
      <h2>${monthTitle}</h2>
      ${next <= thisMonth ? `<a href="#/calendar/${next}" aria-label="Next month">›</a>` : '<span class="disabled" aria-hidden="true">›</span>'}
    </div>
    <section class="card cal">${cells}</section>
    <p class="legend"><span class="done">All done</span><span class="partial">Started</span></p>
    <p class="status">${daysWithEntries} ${daysWithEntries === 1 ? 'day' : 'days'} with entries this month, ${daysComplete} complete.</p>
    ${month !== thisMonth ? `<a class="button secondary" href="#/calendar/${thisMonth}">Back to this month</a>` : ''}`;

  return { title: 'Calendar', subtitle: '', html };
}
