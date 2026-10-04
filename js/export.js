// Diary – export (CSV / JSON backup) through the iOS share sheet, and importing a JSON backup.
// CSV: one row per date × question, tidy long format:
//   date, pack_id, question_id, question_version, answer_value, answer_type, created_at, modified_at, status
// Multi-choice answers are joined with ";". Yes/no answers are "true"/"false".

import { dbGetAll, dbGet, dbPut, isDemoMode } from './db.js';
import { isISODate, logicalDate } from './logic.js';

const CSV_COLUMNS = ['date', 'pack_id', 'question_id', 'question_version', 'answer_value', 'answer_type',
  'created_at', 'modified_at', 'status'];

function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function answerText(value) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.join(';');
  return String(value);
}

export function entriesToCSV(entries) {
  const lines = [CSV_COLUMNS.join(',')];
  const sorted = [...entries].sort((a, b) => (a.date < b.date ? -1 : 1));
  for (const entry of sorted) {
    for (const [questionId, a] of Object.entries(entry.answers)) {
      lines.push([entry.date, a.pack, questionId, a.version, answerText(a.value), a.type,
        a.created_at, a.modified_at, a.status].map(csvCell).join(','));
    }
  }
  return lines.join('\n') + '\n';
}

export function entriesToBackup(entries, configSha) {
  return JSON.stringify({
    app: 'diary',
    format: 1,
    exported_at: new Date().toISOString(),
    config_sha: configSha || null,
    entries: [...entries].sort((a, b) => (a.date < b.date ? -1 : 1)).map(({ sync, ...entry }) => entry)
  }, null, 1);
}

// Builds both export files in advance, so the share sheet can open straight from the button tap.
export async function prepareExports(configSha, person) {
  const entries = await dbGetAll('entries');
  const stamp = logicalDate();
  const slug = (person || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const prefix = isDemoMode() ? 'diary-demo' : slug ? `diary-${slug}` : 'diary';
  return {
    count: entries.length,
    csv: new File([entriesToCSV(entries)], `${prefix}-${stamp}.csv`, { type: 'text/csv' }),
    json: new File([entriesToBackup(entries, configSha)], `${prefix}-backup-${stamp}.json`, { type: 'application/json' })
  };
}

// Opens the share sheet (Save to Files, AirDrop, Mail, …). Falls back to a download.
export async function shareFile(file) {
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: file.name });
      return 'shared';
    } catch (err) {
      if (err.name === 'AbortError') return 'cancelled';
      throw err;
    }
  }
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return 'downloaded';
}

// Merges a JSON backup into the diary on this phone. For a day that exists on both sides,
// the newer version wins. Imported days are marked for upload.
export async function importBackup(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('This file is not valid JSON.');
  }
  const list = Array.isArray(data) ? data : data && data.entries;
  if (!Array.isArray(list)) throw new Error('This is not a Diary backup file.');
  if (!isDemoMode() && list.some((item) => item && item.demo)) {
    throw new Error('This backup comes from the demo diary, so it is not imported into your real diary.');
  }

  let added = 0;
  let updated = 0;
  let skipped = 0;
  for (const item of list) {
    if (!item || !isISODate(item.date || '') || typeof item.answers !== 'object') { skipped++; continue; }
    const mine = await dbGet('entries', item.date);
    if (mine && (mine.modified_at || '') >= (item.modified_at || '')) { skipped++; continue; }
    const { sync, ...entry } = item;
    entry.sync = { dirty: true, sha: mine && mine.sync ? mine.sync.sha : undefined };
    await dbPut('entries', entry);
    if (mine) updated++; else added++;
  }
  return { added, updated, skipped };
}
