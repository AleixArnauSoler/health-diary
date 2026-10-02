// Diary – shared logic. For now: dates and the 04:00 day boundary.

// A new diary day starts at 04:00: anything entered before 4 am counts for the previous day.
export const DAY_START_HOUR = 4;

// Date as "YYYY-MM-DD" in local (Berlin) time.
export function toISODate(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// The diary date for a moment in time (default: now).
export function logicalDate(now = new Date()) {
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (now.getHours() < DAY_START_HOUR) day.setDate(day.getDate() - 1);
  return toISODate(day);
}

// "2026-10-02" -> "Friday 2 October"
export function formatLongDate(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  });
}
