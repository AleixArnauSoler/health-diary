// Diary – cycle tracking: periods, cycle day, phase, predictions.
// A cycle starts on the first day of light/medium/heavy bleeding after at least 2 days without
// (spotting doesn't count). Predictions are calendar estimates: next period = last start + median of
// the last 6 cycle lengths (28 days until there is one); ovulation ≈ 14 days before the next period;
// fertile window = 5 days before to 1 day after ovulation. Not suitable for contraception.

import { addDays, daysBetween } from './logic.js';

export const PHASES = [
  { id: 'menstruation', label: 'Menstruation' },
  { id: 'follicular', label: 'Follicular' },
  { id: 'ovulation', label: 'Near ovulation' },
  { id: 'luteal', label: 'Luteal' },
  { id: 'premenstrual', label: 'Premenstrual' },
  { id: 'unclear', label: 'Unclear' }
];

const BLEEDING = new Set(['light', 'medium', 'heavy']);
const DEFAULT_CYCLE = 28;
const DEFAULT_PERIOD = 5;
const LUTEAL_DAYS = 14;
const LONGEST_CYCLE = 45;        // the current cycle becomes "unclear" after this many days

const median = (list) => {
  const s = [...list].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

// Everything the app needs to know about cycles, from the logged bleeding days.
export function analyseCycles(entryDates, answersFor) {
  const periods = [];
  for (const date of entryDates) {
    if (!BLEEDING.has(answersFor(date).period_flow)) continue;
    const last = periods[periods.length - 1];
    if (last && daysBetween(last.end, date) <= 2) last.end = date;   // at most 1 day without bleeding in between
    else periods.push({ start: date, end: date });
  }
  const cycles = periods.map((p, i) => ({
    start: p.start,
    periodEnd: p.end,
    periodLength: daysBetween(p.start, p.end) + 1,
    length: i + 1 < periods.length ? daysBetween(p.start, periods[i + 1].start) : null
  }));

  const lengths = cycles.map((c) => c.length).filter((l) => l && l >= 15 && l <= 60).slice(-6);
  const periodLengths = cycles.filter((c) => c.length).map((c) => c.periodLength).slice(-6);   // finished periods only
  const avgCycle = lengths.length ? Math.round(median(lengths)) : DEFAULT_CYCLE;
  const avgPeriod = periodLengths.length ? Math.min(10, Math.max(2, Math.round(median(periodLengths)))) : DEFAULT_PERIOD;
  const last = cycles.length ? cycles[cycles.length - 1] : null;

  const predictedStarts = [];
  if (last) {
    let start = addDays(last.start, avgCycle);
    for (let k = 0; k < 4; k++) { predictedStarts.push(start); start = addDays(start, avgCycle); }
  }
  return { cycles, avgCycle, avgPeriod, basedOn: lengths.length, last, predictedStarts };
}

// Cycle day and phase for a date, or null before the first logged period.
export function cycleDayInfo(analysis, date) {
  const { cycles, predictedStarts } = analysis;
  let index = -1;
  for (let k = cycles.length - 1; k >= 0; k--) {
    if (cycles[k].start <= date) { index = k; break; }
  }
  if (index < 0) return null;

  const cycle = cycles[index];
  const current = index === cycles.length - 1;
  const nextStart = current ? predictedStarts[0] : cycles[index + 1].start;
  const length = daysBetween(cycle.start, nextStart);
  const day = daysBetween(cycle.start, date) + 1;
  const ovulationDay = length - LUTEAL_DAYS;

  let phase;
  if (date <= cycle.periodEnd) phase = 'menstruation';
  else if (day > length || (current && day > LONGEST_CYCLE)) phase = 'unclear';      // overdue or irregular
  else if (day > length - 5) phase = 'premenstrual';
  else if (day >= ovulationDay - 2 && day <= ovulationDay + 1) phase = 'ovulation';
  else if (day < ovulationDay - 2) phase = 'follicular';
  else phase = 'luteal';
  return { day, length, phase, current };
}

export function phaseLabel(id) {
  const phase = PHASES.find((p) => p.id === id);
  return phase ? phase.label : id;
}

// Estimated ovulation day and fertile window of a cycle starting on `start` with length `length`.
function fertileWindow(start, length) {
  const ovulation = addDays(start, length - LUTEAL_DAYS - 1);
  return { ovulation, from: addDays(ovulation, -5), to: addDays(ovulation, 1) };
}

// Marks for one calendar day: logged period/spotting, predicted period, fertile window, ovulation.
export function calendarMarks(analysis, date, flow, today) {
  const marks = {
    period: BLEEDING.has(flow),
    spotting: flow === 'spotting',
    predicted: false,
    fertile: false,
    ovulation: false
  };
  const { last, predictedStarts, avgCycle, avgPeriod } = analysis;
  if (!last || date < last.start) return marks;

  // Predicted periods (only for days after today)
  if (date > today) {
    marks.predicted = predictedStarts.some((s) => date >= s && date < addDays(s, avgPeriod));
  }
  // Fertile windows of the current cycle and the predicted ones
  const starts = [last.start, ...predictedStarts];
  for (let k = 0; k < starts.length - 1; k++) {
    const window = fertileWindow(starts[k], daysBetween(starts[k], starts[k + 1]) || avgCycle);
    if (date >= window.from && date <= window.to) {
      marks.fertile = true;
      marks.ovulation = date === window.ovulation;
    }
  }
  return marks;
}

// Short text for the Today screen.
export function cycleSummary(analysis, today) {
  if (!analysis.last) return null;
  const info = cycleDayInfo(analysis, today);
  const next = analysis.predictedStarts[0];
  const untilNext = daysBetween(today, next);
  const window = fertileWindow(analysis.last.start, daysBetween(analysis.last.start, next));
  return {
    day: info.day,
    phase: info.phase,
    next,
    untilNext,
    fertileFrom: window.from,
    fertileTo: window.to,
    ovulation: window.ovulation,
    basedOn: analysis.basedOn,
    avgCycle: analysis.avgCycle
  };
}
