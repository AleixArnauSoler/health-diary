// Diary – Calendar: one month at a time. Tap a day to see or edit it.
// Number in a filled circle = period day; dashed circle = predicted period; tinted = fertile window
// (darker = estimated ovulation). Dot below: green = all packs due that day are done, pink = started.
import { dbGetAll } from './db.js';
import { getConfig } from './config.js';
import { logicalDate, toISODate, formatShortDate, makeAnswerLookup, packsForDay } from './logic.js';
import { analyseCycles, calendarMarks } from './cycle.js';

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const MONTHS_AHEAD = 3;          // future months can be opened to see predicted periods

export async function calendarScreen(monthArg) {
  const today = logicalDate();
  const thisMonth = today.slice(0, 7);
  const shiftMonth = (month, delta) => {
    const [y, m] = month.split('-').map(Number);
    return toISODate(new Date(y, m - 1 + delta, 1)).slice(0, 7);
  };
  const lastMonth = shiftMonth(thisMonth, MONTHS_AHEAD);
  const month = /^\d{4}-\d{2}$/.test(monthArg || '') && monthArg <= lastMonth ? monthArg : thisMonth;
  const [year, monthNumber] = month.split('-').map(Number);

  const config = getConfig();
  const entries = await dbGetAll('entries');
  const answersFor = makeAnswerLookup(entries);
  const entryDates = entries.map((e) => e.date).sort();
  const withEntry = new Set(entryDates);
  const cycles = analyseCycles(entryDates, answersFor);

  const first = new Date(year, monthNumber - 1, 1);
  const daysInMonth = new Date(year, monthNumber, 0).getDate();
  const blanks = (first.getDay() + 6) % 7;             // Monday-first grid

  let cells = WEEKDAYS.map((d) => `<span class="wd" aria-hidden="true">${d}</span>`).join('');
  for (let i = 0; i < blanks; i++) cells += '<span></span>';

  let daysWithEntries = 0;
  let daysComplete = 0;
  for (let day = 1; day <= daysInMonth; day++) {
    const date = toISODate(new Date(year, monthNumber - 1, day));
    const marks = calendarMarks(cycles, date, answersFor(date).period_flow, today);
    const classes = ['day'];
    const words = [];
    if (marks.period) { classes.push('period'); words.push('period'); }
    else if (marks.spotting) { classes.push('spotting'); words.push('spotting'); }
    if (marks.predicted) { classes.push('predicted'); words.push('predicted period'); }
    if (marks.fertile) { classes.push(marks.ovulation ? 'ovulation' : 'fertile'); words.push(marks.ovulation ? 'estimated ovulation' : 'fertile window'); }
    if (date === today) classes.push('today');
    const label = new Date(year, monthNumber - 1, day).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });

    if (date > today) {
      classes.push('future');
      cells += `<span class="${classes.join(' ')}" aria-label="${label}${words.length ? `, ${words.join(', ')}` : ''}">
          <span>${day}</span><span class="dot"></span></span>`;
      continue;
    }
    if (config && withEntry.has(date)) {
      const { due } = packsForDay(config, date, entryDates, answersFor);
      const done = due.filter((d) => d.status === 'done').length;
      const started = due.some((d) => d.status !== 'new');
      if (started) daysWithEntries++;
      if (due.length && done === due.length) { classes.push('done'); daysComplete++; words.push('all done'); }
      else if (started) { classes.push('partial'); words.push('started'); }
    }
    cells += `<a class="${classes.join(' ')}" href="#/day/${date}" aria-label="${label}${words.length ? `, ${words.join(', ')}` : ''}">
        <span>${day}</span><span class="dot"></span></a>`;
  }

  const previous = shiftMonth(month, -1);
  const next = shiftMonth(month, 1);
  const monthTitle = first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const cycleLine = cycles.last
    ? `Typical cycle ${cycles.avgCycle} days, period ${cycles.avgPeriod} days. Next period around ${formatShortDate(cycles.predictedStarts[0])}.`
    : 'Log bleeding in the Cycle pack to see periods and predictions here.';

  const html = `
    <div class="month-nav">
      <a href="#/calendar/${previous}" aria-label="Previous month">‹</a>
      <h2>${monthTitle}</h2>
      ${next <= lastMonth ? `<a href="#/calendar/${next}" aria-label="Next month">›</a>` : '<span class="disabled" aria-hidden="true">›</span>'}
    </div>
    <section class="card cal">${cells}</section>
    <p class="legend">
      <span class="lg-period">Period</span><span class="lg-predicted">Predicted</span>
      <span class="lg-fertile">Fertile</span><span class="lg-ovulation">Ovulation</span>
    </p>
    <p class="legend"><span class="lg-done">All done</span><span class="lg-partial">Started</span></p>
    <p class="status">${month <= thisMonth
      ? `${daysWithEntries} ${daysWithEntries === 1 ? 'day' : 'days'} with entries this month, ${daysComplete} complete. `
      : ''}${cycleLine} Estimates only, not for contraception.</p>
    ${month !== thisMonth ? `<a class="button secondary" href="#/calendar/${thisMonth}">Back to this month</a>` : ''}`;

  return { title: 'Calendar', subtitle: '', html };
}
