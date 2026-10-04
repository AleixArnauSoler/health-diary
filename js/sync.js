// Diary – talking to GitHub (REST API): read config.json, back up the day files, restore them.
// The token is sent only to api.github.com and is never written into code.
// Day files are encrypted on the phone before upload (see crypto.js).

import { dbGet, dbPut, dbGetAll, isDemoMode } from './db.js';
import { encryptJSON, decryptJSON, toBase64 } from './crypto.js';

const API = 'https://api.github.com';

export class GitHubError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
  }
}

async function request(github, path, { method = 'GET', body } = {}) {
  const headers = { Authorization: `Bearer ${github.token}`, Accept: 'application/vnd.github+json' };
  if (body) headers['Content-Type'] = 'application/json';
  try {
    return await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
  } catch {
    throw new GitHubError(0, 'No connection to GitHub.');
  }
}

function errorFor(response) {
  switch (response.status) {
    case 401:
      return new GitHubError(401, 'GitHub did not accept the token (wrong, expired or revoked).');
    case 403:
      return new GitHubError(403, response.headers.get('x-ratelimit-remaining') === '0'
        ? 'GitHub rate limit reached. Try again later.'
        : 'The token is not allowed to do this. It needs Contents: Read and write on the data repo.');
    case 404:
      return new GitHubError(404, 'Repo not found. Check the username and repo name, and that the token includes this repo.');
    case 409:
    case 422:
      return new GitHubError(response.status, 'The file on GitHub changed in the meantime.');
    default:
      return new GitHubError(response.status, `GitHub answered with error ${response.status}.`);
  }
}

function repoPath(github) {
  return `/repos/${encodeURIComponent(github.owner)}/${encodeURIComponent(github.repo)}`;
}

function decodeBase64(base64) {
  const binary = atob(base64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

// Checks that the token can open the repo. Returns { private, defaultBranch }.
export async function checkRepo(github) {
  const response = await request(github, repoPath(github));
  if (!response.ok) throw errorFor(response);
  const data = await response.json();
  return { private: data.private === true, defaultBranch: data.default_branch || 'main' };
}

// Reads a text file from the repo. Returns { sha, text }, or null if the file doesn't exist.
export async function getFile(github, path) {
  const response = await request(github, `${repoPath(github)}/contents/${path}`);
  if (response.status === 404) return null;
  if (!response.ok) throw errorFor(response);
  const data = await response.json();
  return { sha: data.sha, text: decodeBase64(data.content) };
}

async function putFile(github, path, text, sha, message) {
  const body = { message, content: toBase64(new TextEncoder().encode(text)) };
  if (sha) body.sha = sha;
  const response = await request(github, `${repoPath(github)}/contents/${path}`, { method: 'PUT', body });
  if (!response.ok) throw errorFor(response);
  return (await response.json()).content.sha;
}

// All day files in the repo: [{ date, sha }]
async function listEntryFiles(github) {
  const branch = github.branch || (await checkRepo(github)).defaultBranch;
  const response = await request(github, `${repoPath(github)}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
  if (response.status === 404 || response.status === 409) return [];         // 409 = repo still empty
  if (!response.ok) throw errorFor(response);
  const data = await response.json();
  return data.tree
    .filter((item) => item.type === 'blob' && /^entries\/\d{4}-\d{2}-\d{2}\.json$/.test(item.path))
    .map((item) => ({ date: item.path.slice(8, 18), sha: item.sha }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

async function getBlob(github, sha) {
  const response = await request(github, `${repoPath(github)}/git/blobs/${sha}`);
  if (!response.ok) throw errorFor(response);
  return decodeBase64((await response.json()).content);
}

// How many day files are on GitHub, and does this key open them?
export async function checkKeyAgainstRepo(github, keyText) {
  const files = await listEntryFiles(github);
  if (!files.length) return { files: 0, ok: true };
  const newest = files[files.length - 1];
  try {
    await decryptJSON(keyText, JSON.parse(await getBlob(github, newest.sha)));
    return { files: files.length, ok: true };
  } catch {
    return { files: files.length, ok: false };
  }
}

// ---------- Backup state (shown on Today and in Settings) ----------

let state = { status: 'idle', message: '', lastSync: null, pending: 0 };
const listeners = new Set();

export function getSyncState() {
  return state;
}

export function onSyncChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setState(patch) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener(state);
  return state;
}

// ---------- Sync ----------

let running = null;
let timer = null;

// Sync a few seconds after the last change (called after every save).
export function scheduleSync(delay = 3000) {
  clearTimeout(timer);
  timer = setTimeout(() => { syncNow(); }, delay);
}

export function syncNow() {
  if (!running) running = runSync().finally(() => { running = null; });
  return running;
}

// Timers don't run while the app is in the background: if a backup is waiting, start it now.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && timer) {
      clearTimeout(timer);
      timer = null;
      syncNow();
    }
  });
}

async function runSync() {
  if (isDemoMode()) return setState({ status: 'demo', pending: 0 });
  if (!state.lastSync) state.lastSync = (await dbGet('settings', 'lastSync')) || null;
  const github = await dbGet('settings', 'github');
  const key = await dbGet('settings', 'key');
  const countPending = async () => (await dbGetAll('entries')).filter((e) => e.sync && e.sync.dirty).length;

  if (!github || !github.token || !key) return setState({ status: 'not-set-up', pending: await countPending() });
  if (!navigator.onLine) return setState({ status: 'offline', pending: await countPending() });

  setState({ status: 'syncing', pending: await countPending() });
  try {
    // First sync on this phone (or after changing repo/key): fetch what is already on GitHub.
    if (!(await dbGet('settings', 'downloaded'))) {
      await downloadEntries(github, key);
      await dbPut('settings', true, 'downloaded');
    }
    const dirty = (await dbGetAll('entries')).filter((e) => e.sync && e.sync.dirty);
    let left = dirty.length;
    for (const entry of dirty) {
      await uploadEntry(github, key, entry);
      setState({ pending: --left });
    }
    const now = new Date().toISOString();
    await dbPut('settings', now, 'lastSync');
    return setState({ status: 'ok', message: '', lastSync: now, pending: await countPending() });
  } catch (err) {
    return setState({ status: 'error', message: err.message, pending: await countPending() });
  }
}

async function uploadEntry(github, key, entry) {
  const { sync, ...file } = entry;                      // "sync" is local bookkeeping only
  const text = JSON.stringify(await encryptJSON(key, file));
  const path = `entries/${entry.date}.json`;
  const message = `Diary ${entry.date}`;
  let sha;
  try {
    sha = await putFile(github, path, text, sync && sync.sha, message);
  } catch (err) {
    if (err.status !== 409 && err.status !== 422) throw err;
    const current = await getFile(github, path);         // we didn't know the file's latest version
    sha = await putFile(github, path, text, current ? current.sha : undefined, message);
  }
  const latest = await dbGet('entries', entry.date);
  if (!latest) return;
  latest.sync = { dirty: latest.modified_at !== entry.modified_at, sha };   // edited meanwhile → upload again
  await dbPut('entries', latest);
}

// Brings day files from GitHub onto the phone. The newer version of a day wins.
export async function downloadEntries(github, key) {
  const files = await listEntryFiles(github);
  const local = new Map((await dbGetAll('entries')).map((e) => [e.date, e]));
  let added = 0;
  let updated = 0;
  for (const file of files) {
    const mine = local.get(file.date);
    if (mine && mine.sync && (mine.sync.dirty || mine.sync.sha === file.sha)) continue;
    const remote = await decryptJSON(key, JSON.parse(await getBlob(github, file.sha)));
    if (mine && mine.modified_at > remote.modified_at) {
      mine.sync = { dirty: true, sha: file.sha };          // the phone's version is newer: upload it
      await dbPut('entries', mine);
      continue;
    }
    remote.date = file.date;
    remote.sync = { dirty: false, sha: file.sha };
    await dbPut('entries', remote);
    if (mine) updated++; else added++;
  }
  return { added, updated, total: files.length };
}
