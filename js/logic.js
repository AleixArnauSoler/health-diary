// Diary – shared logic: dates, the 04:00 day boundary, small helpers.

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

// ISO timestamp -> "2 Oct, 19:42"
export function formatDateTime(isoTimestamp) {
  return new Date(isoTimestamp).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  });
}

// Makes text safe to put inside HTML.
export function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
