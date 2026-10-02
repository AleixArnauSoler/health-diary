// Diary – shared logic: dates, the 04:00 day boundary, branching conditions, schedules, scores.

// ---------- Dates ----------

// A new diary day starts at 04:00: anything entered before 4 am counts for the previous day.
export const DAY_START_HOUR = 4;

const pad = (n) => String(n).padStart(2, '0');

// Date as "YYYY-MM-DD" in local (Berlin) time.
export function toISODate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function isISODate(text) {
  return /^\d{4}-\d{2}-\d{2}$/.test(text) && toISODate(parseISODate(text)) === text;
}

function parseISODate(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// The diary date for a moment in time (default: now).
export function logicalDate(now = new Date()) {
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (now.getHours() < DAY_START_HOUR) day.setDate(day.getDate() - 1);
  return toISODate(day);
}

// "2026-10-02" + 1 -> "2026-10-03"
export function addDays(isoDate, days) {
  const date = parseISODate(isoDate);
  date.setDate(date.getDate() + days);
  return toISODate(date);
}

// Whole days from date a to date b (b - a).
export function daysBetween(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

// Timestamp with the local UTC offset, e.g. "2026-10-02T21:14:03+02:00"
export function nowLocalISO(now = new Date()) {
  const offset = -now.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  return `${toISODate(now)}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

// "2026-10-02" -> "Friday 2 October"
export function formatLongDate(isoDate) {
  return parseISODate(isoDate).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
}

// "2026-10-02" -> "2 Oct"
export function formatShortDate(isoDate) {
  return parseISODate(isoDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// ISO timestamp -> "2 Oct, 19:42"
export function formatDateTime(isoTimestamp) {
  return new Date(isoTimestamp).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
  });
}

// ---------- Answers ----------

export function isAnswered(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'number') return Number.isFinite(value);
  return true;                                   // true / false
}

// Builds a function date -> { questionId: value } with the answered questions saved for that date.
export function makeAnswerLookup(entries) {
  const byDate = new Map(entries.map((entry) => [entry.date, entry]));
  const cache = new Map();
  return (date) => {
    if (!cache.has(date)) {
      const values = {};
      const entry = byDate.get(date);
      if (entry) {
        for (const [id, answer] of Object.entries(entry.answers)) {
          if (answer.status === 'answered') values[id] = answer.value;
        }
      }
      cache.set(date, values);
    }
    return cache.get(date);
  };
}

// ---------- Branching ----------

// Evaluates a showIf condition. lookup(questionId, dayOffset) returns the answer (or undefined).
export function evaluate(condition, lookup) {
  if (!condition) return true;
  if (condition.all) return condition.all.every((c) => evaluate(c, lookup));
  if (condition.any) return condition.any.some((c) => evaluate(c, lookup));
  if (condition.not) return !evaluate(condition.not, lookup);

  const value = lookup(condition.q, condition.day || 0);
  const answered = isAnswered(value);
  if ('answered' in condition) return answered === condition.answered;
  if (!answered) return false;                   // unanswered questions never match
  if ('eq' in condition) return value === condition.eq;
  if ('ne' in condition) return value !== condition.ne;
  if ('in' in condition) return Array.isArray(condition.in) && condition.in.includes(value);
  if ('has' in condition) return Array.isArray(value) && value.includes(condition.has);
  if ('gte' in condition) return typeof value === 'number' && value >= condition.gte;
  if ('lte' in condition) return typeof value === 'number' && value <= condition.lte;
  return false;
}

// Works out which questions of a pack are shown, going top to bottom.
// ownValues: this pack's current answers. answersFor: date -> saved answers (see makeAnswerLookup).
// Returns { visible: {id: true/false}, values: answers that count (other packs + shown questions here) }.
export function packVisibility(pack, ownValues, date, answersFor) {
  const values = { ...answersFor(date) };
  for (const q of pack.questions) delete values[q.id];
  const lookup = (id, day) => (day ? answersFor(addDays(date, day))[id] : values[id]);

  const visible = {};
  for (const q of pack.questions) {
    const shown = !q.retired && evaluate(q.showIf, lookup);
    visible[q.id] = shown;
    if (shown && isAnswered(ownValues[q.id])) values[q.id] = ownValues[q.id];
  }
  return { visible, values, lookup };
}

// 'new' (nothing answered), 'partial' or 'done'. Free-text questions are optional.
export function packStatus(pack, date, answersFor) {
  const saved = answersFor(date);
  const own = {};
  let started = false;
  for (const q of pack.questions) {
    if (q.id in saved) { own[q.id] = saved[q.id]; started = true; }
  }
  if (!started) return 'new';
  const { visible } = packVisibility(pack, own, date, answersFor);
  const missing = pack.questions.some((q) => visible[q.id] && q.type !== 'text' && !isAnswered(own[q.id]));
  return missing ? 'partial' : 'done';
}

// ---------- Schedules ----------

// For packs that repeat every N days: is it due on this date, and when is it next due?
export function dueInfo(pack, date, entryDates, answersFor) {
  const every = pack.schedule.everyDays;
  if (every <= 1) return { due: true, next: null };
  let lastDone = null;
  for (let i = entryDates.length - 1; i >= 0; i--) {
    const d = entryDates[i];
    if (d < date && packStatus(pack, d, answersFor) === 'done') { lastDone = d; break; }
  }
  if (!lastDone) return { due: true, next: null };
  const next = addDays(lastDone, every);
  return { due: next <= date, next };
}

// ---------- Scores ----------

// Sum of the score items (with reversed items and multiplier), or null until all items are answered.
export function computeScore(score, values) {
  let total = 0;
  for (const id of score.items) {
    const value = values[id];
    if (typeof value !== 'number') return null;
    total += (score.reverse || []).includes(id) ? score.reverseFrom - value : value;
  }
  return total * (score.multiply || 1);
}

// ---------- Small helpers ----------

// Makes text safe to put inside HTML.
export function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
