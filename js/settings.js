// Diary – Settings screen.
import { dbGet, dbPut, isDemoMode, setDemoMode, writeDemoDatabase } from './db.js';
import {
  checkRepo, checkKeyAgainstRepo, downloadEntries, syncNow, getSyncState, onSyncChange
} from './sync.js';
import { getConfig, getConfigInfo, refreshConfig, configSummary } from './config.js';
import { buildDemoEntries } from './demo.js';
import { newKeyText, isValidKeyText } from './crypto.js';
import { prepareExports, shareFile, importBackup } from './export.js';
import { pinEnabled, setPin, removePin, checkPin } from './lock.js';
import { escapeHtml as esc, formatDateTime, logicalDate } from './logic.js';

const DEFAULT_REPO = 'health-diary-data';

export async function settingsScreen({ appVersion, offlineStatus }) {
  const demo = isDemoMode();
  const github = await dbGet('settings', 'github');
  const key = await dbGet('settings', 'key');
  const config = getConfig();
  const info = getConfigInfo();

  // --- Private data repo ---
  const tokenPlaceholder = github && github.token ? `Saved (ends in ${github.token.slice(-4)})` : 'github_pat_…';
  const githubSection = demo
    ? `<h2 class="section">Private data repo</h2>
       <section class="card"><p>The demo diary is not connected to GitHub, so nothing from it is uploaded.</p></section>`
    : `<h2 class="section">Private data repo</h2>
       <form id="github-form" autocomplete="off">
         <div class="card">
           <label class="field"><span>GitHub username</span>
             <input name="owner" value="${esc(github ? github.owner : '')}" autocapitalize="none" autocorrect="off" spellcheck="false"></label>
           <label class="field"><span>Repo name</span>
             <input name="repo" value="${esc(github ? github.repo : DEFAULT_REPO)}" autocapitalize="none" autocorrect="off" spellcheck="false"></label>
           <label class="field"><span>Access token</span>
             <input name="token" type="password" placeholder="${esc(tokenPlaceholder)}" autocomplete="off"
                    autocapitalize="none" autocorrect="off" spellcheck="false"></label>
         </div>
         <button class="button" type="submit">Connect</button>
       </form>
       <p class="status ${github ? 'ok' : ''}" id="github-status" role="status">${github
         ? `Connected to ${esc(github.owner)}/${esc(github.repo)}.`
         : 'Enter your GitHub username, the private repo name and your access token.'}</p>`;

  // --- Encryption key ---
  const keySection = demo ? '' : key
    ? `<h2 class="section">Encryption key</h2>
       <section class="card">
         <p>Your entries are encrypted on this phone before upload. Keep a copy of the key in the Passwords app:
           without it, the backup can't be read.</p>
         <div class="key-box" id="key-box" hidden><code id="key-text"></code></div>
       </section>
       <button class="button secondary" id="key-show" type="button">Show key</button>
       <button class="button secondary" id="key-copy" type="button" hidden>Copy key</button>
       <p class="status" id="key-status" role="status"></p>`
    : `<h2 class="section">Encryption key</h2>
       <section class="card">
         <p>Your entries are encrypted on this phone before they go to GitHub. Create a key once, and keep a copy
           in the Passwords app: without it, the backup can't be read. On a new phone, enter the same key.</p>
       </section>
       <button class="button" id="key-new" type="button">Create new key</button>
       <form id="key-form" class="card inline-form" autocomplete="off">
         <label class="field"><span>Or enter the key you saved</span>
           <input name="key" type="password" placeholder="44 characters" autocapitalize="none" autocorrect="off" spellcheck="false"></label>
       </form>
       <button class="button secondary" id="key-use" type="button">Use this key</button>
       <p class="status" id="key-status" role="status"></p>`;

  // --- Backup ---
  const backupSection = demo ? '' : `
    <h2 class="section">Backup to GitHub</h2>
    <section class="card">
      <div class="row"><span>Status</span><span id="sync-state"></span></div>
      <div class="row"><span>Last backup</span><span id="sync-last"></span></div>
      <div class="row"><span>Waiting to upload</span><span id="sync-pending"></span></div>
    </section>
    <p class="status error" id="sync-error"></p>
    <button class="button secondary" id="sync-now" type="button">Back up now</button>
    <button class="button secondary" id="sync-download" type="button">Download from GitHub</button>
    <p class="status" id="sync-status" role="status"></p>`;

  // --- Questions ---
  let questionRows = '<div class="row"><span>Not loaded yet</span><span></span></div>';
  if (config) {
    const summary = configSummary(config);
    questionRows = `
      <div class="row"><span>Packs</span><span>${summary.packsActive} active of ${summary.packsTotal}</span></div>
      <div class="row"><span>Questions</span><span>${summary.questions}</span></div>
      <div class="row"><span>Version</span><span>${esc((info.sha || '').slice(0, 7))}</span></div>
      <div class="row"><span>Last checked</span><span>${info.lastCheck ? formatDateTime(info.lastCheck) : '–'}</span></div>`;
  }

  // --- PIN ---
  const pinSection = pinEnabled()
    ? `<h2 class="section">PIN lock</h2>
       <section class="card"><p>On. The app asks for the PIN when it opens and after a minute in the background.</p></section>
       <form id="pin-off-form" class="card inline-form" autocomplete="off">
         <label class="field"><span>Current PIN (to turn the lock off)</span>
           <input name="pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="off"></label>
       </form>
       <button class="button secondary" id="pin-off" type="button">Turn off PIN lock</button>
       <p class="status" id="pin-status" role="status"></p>`
    : `<h2 class="section">PIN lock</h2>
       <form id="pin-form" class="card inline-form" autocomplete="off">
         <label class="field"><span>New PIN (4–6 digits)</span>
           <input name="pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="off"></label>
         <label class="field"><span>Repeat PIN</span>
           <input name="repeat" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="off"></label>
       </form>
       <button class="button secondary" id="pin-on" type="button">Turn on PIN lock</button>
       <p class="status" id="pin-status" role="status"></p>`;

  // --- Demo ---
  const demoSection = demo
    ? `<h2 class="section">Demo diary</h2>
       <section class="card"><p>You are looking at simulated data. Your real diary is unchanged.</p></section>
       <button class="button" id="demo-leave" type="button">Back to my diary</button>
       <button class="button secondary" id="demo-build" type="button">Rebuild demo data</button>
       <p class="status" id="demo-status" role="status"></p>`
    : `<h2 class="section">Demo diary</h2>
       <section class="card"><p>Try the calendar and charts with about 3 months of simulated answers.
         It is kept apart from your real diary and never uploaded.</p></section>
       <button class="button secondary" id="demo-build" type="button">Open demo diary</button>
       <p class="status" id="demo-status" role="status"></p>`;

  const html = `<div class="settings">
    ${githubSection}
    ${keySection}
    ${backupSection}

    <h2 class="section">Questions</h2>
    <section class="card">${questionRows}</section>
    ${demo ? '' : '<button class="button secondary" id="reload-config" type="button">Reload questions</button>'}
    <p class="status ${info.lastError ? 'error' : ''}" id="config-status" role="status">${info.lastError ? esc(info.lastError) : ''}</p>

    <h2 class="section">Export and import</h2>
    <section class="card"><p>CSV: one row per day and question, for R or Python. Backup (JSON): everything, to keep
      or to import again. Both open the share sheet (Save to Files, AirDrop, Mail…).</p></section>
    <button class="button secondary" id="export-csv" type="button" disabled>Export CSV</button>
    <button class="button secondary" id="export-json" type="button" disabled>Export backup (JSON)</button>
    <button class="button secondary" id="import-json" type="button">Import backup (JSON)</button>
    <input type="file" id="import-file" accept=".json,application/json" hidden>
    <p class="status" id="export-status" role="status">Preparing export…</p>

    ${pinSection}

    <h2 class="section">Daily reminder</h2>
    <section class="card"><p>Web apps can't send scheduled notifications by themselves. In the iPhone's Reminders app,
      create a reminder such as "Diary", set a time and Repeat: Daily. When it goes off, open Diary from the
      Home Screen (not from a link: a Safari tab doesn't see this app's data).</p></section>

    ${demoSection}

    <h2 class="section">App</h2>
    <section class="card">
      <div class="row"><span>App version</span><span>${esc(appVersion)}</span></div>
      <div class="row"><span>Offline copy</span><span>${esc(offlineStatus)}</span></div>
      <div class="row"><span>Storage protected</span><span id="persisted">…</span></div>
    </section>
  </div>`;

  return { title: 'Settings', subtitle: '', html, mount };
}

function showStatus(element, text, kind = '') {
  if (!element) return;
  element.textContent = text;
  element.className = `status ${kind}`.trim();
}

function mount(view, rerender) {
  const root = view.querySelector('.settings');
  const $ = (selector) => root.querySelector(selector);
  mountGithub($, rerender);
  mountKey($, rerender);
  const stopBackup = mountBackup($, rerender);
  mountExport($);
  mountPin($, rerender);
  mountDemo($);

  const reload = $('#reload-config');
  if (reload) {
    reload.addEventListener('click', async () => {
      const github = await dbGet('settings', 'github');
      if (!github) { showStatus($('#config-status'), 'Connect the data repo first.', 'error'); return; }
      reload.disabled = true;
      showStatus($('#config-status'), 'Loading…');
      try { await refreshConfig(github); } catch { /* shown after the screen refreshes */ }
      rerender();
    });
  }

  if (navigator.storage && navigator.storage.persisted) {
    navigator.storage.persisted().then((yes) => { $('#persisted').textContent = yes ? 'Yes' : 'Not guaranteed'; })
      .catch(() => { $('#persisted').textContent = 'Unknown'; });
  } else {
    $('#persisted').textContent = 'Unknown';
  }
  return () => { if (stopBackup) stopBackup(); };
}

// ---------- GitHub connection ----------

function mountGithub($, rerender) {
  const form = $('#github-form');
  if (!form) return;
  const button = form.querySelector('button');
  const status = $('#github-status');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const saved = await dbGet('settings', 'github');
    const owner = form.elements.owner.value.trim();
    const repo = form.elements.repo.value.trim();
    const token = form.elements.token.value.trim() || (saved ? saved.token : '');
    if (!owner || !repo || !token) { showStatus(status, 'Fill in the username, the repo name and the token.', 'error'); return; }

    button.disabled = true;
    showStatus(status, 'Connecting…');
    try {
      const repoInfo = await checkRepo({ owner, repo, token });
      if (!repoInfo.private) {
        showStatus(status, `${owner}/${repo} is a public repo. Your data must go in a private repo.`, 'error');
        return;
      }
      const github = { owner, repo, token, branch: repoInfo.defaultBranch };
      const changedRepo = !saved || saved.owner !== owner || saved.repo !== repo;
      await dbPut('settings', github, 'github');
      if (changedRepo) await dbPut('settings', false, 'downloaded');
      try { await refreshConfig(github); } catch { /* shown under Questions */ }
      syncNow();
      rerender();
    } catch (err) {
      showStatus(status, err.message, 'error');
    } finally {
      button.disabled = false;
    }
  });
}

// ---------- Encryption key ----------

function mountKey($, rerender) {
  const status = $('#key-status');
  const show = $('#key-show');
  if (show) {
    const copy = $('#key-copy');
    show.addEventListener('click', async () => {
      const box = $('#key-box');
      if (!box.hidden) { box.hidden = true; copy.hidden = true; show.textContent = 'Show key'; return; }
      $('#key-text').textContent = await dbGet('settings', 'key');
      box.hidden = false;
      copy.hidden = false;
      show.textContent = 'Hide key';
    });
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(await dbGet('settings', 'key'));
        showStatus(status, 'Copied. Paste it into a new entry in the Passwords app.', 'ok');
      } catch {
        showStatus(status, 'Could not copy. Select the key text and copy it by hand.', 'error');
      }
    });
    return;
  }

  const useKey = async (keyText, isNew) => {
    const github = await dbGet('settings', 'github');
    if (github) {
      showStatus(status, 'Checking your repo…');
      const check = await checkKeyAgainstRepo(github, keyText);
      if (isNew && check.files) {
        showStatus(status, `Your repo already has ${check.files} encrypted days. Enter the key you saved before instead.`, 'error');
        return false;
      }
      if (!check.ok) {
        showStatus(status, "This key doesn't open the entries in your repo.", 'error');
        return false;
      }
    }
    await dbPut('settings', keyText, 'key');
    await dbPut('settings', false, 'downloaded');
    syncNow();
    return true;
  };

  if (!$('#key-new')) return;                 // demo diary: no key
  $('#key-new').addEventListener('click', async () => {
    try {
      if (await useKey(newKeyText(), true)) rerender();
    } catch (err) {
      showStatus(status, err.message, 'error');
    }
  });
  $('#key-use').addEventListener('click', async () => {
    const keyText = $('#key-form').elements.key.value.trim();
    if (!isValidKeyText(keyText)) { showStatus(status, 'That is not a valid key (it should be 44 characters).', 'error'); return; }
    try {
      if (await useKey(keyText, false)) rerender();
    } catch (err) {
      showStatus(status, err.message, 'error');
    }
  });
  $('#key-form').addEventListener('submit', (event) => event.preventDefault());
}

// ---------- Backup ----------

const SYNC_WORDS = {
  'not-set-up': 'Not set up', syncing: 'Backing up…', offline: 'Offline', error: 'Failed', ok: 'Up to date', idle: '–'
};

function mountBackup($, rerender) {
  const now = $('#sync-now');
  if (!now) return null;
  const status = $('#sync-status');
  const show = (state) => {
    $('#sync-state').textContent = SYNC_WORDS[state.status] || state.status;
    $('#sync-last').textContent = state.lastSync ? formatDateTime(state.lastSync) : '–';
    $('#sync-pending').textContent = `${state.pending} ${state.pending === 1 ? 'day' : 'days'}`;
    $('#sync-error').textContent = state.status === 'error' ? state.message : '';
  };
  show(getSyncState());
  const stopListening = onSyncChange(show);
  now.addEventListener('click', async () => {
    now.disabled = true;
    showStatus(status, 'Backing up…');
    await syncNow();
    rerender();
  });
  $('#sync-download').addEventListener('click', async () => {
    const github = await dbGet('settings', 'github');
    const key = await dbGet('settings', 'key');
    if (!github || !key) { showStatus(status, 'Connect the repo and set the encryption key first.', 'error'); return; }
    showStatus(status, 'Downloading…');
    try {
      const result = await downloadEntries(github, key);
      showStatus(status, `${result.added} new and ${result.updated} updated days (of ${result.total} on GitHub).`, 'ok');
      syncNow();
    } catch (err) {
      showStatus(status, err.message, 'error');
    }
  });
  return stopListening;
}

// ---------- Export and import ----------

function mountExport($) {
  const status = $('#export-status');
  const csvButton = $('#export-csv');
  const jsonButton = $('#export-json');
  let files = null;

  const prepare = async () => {
    files = await prepareExports(getConfigInfo().sha);
    csvButton.disabled = false;
    jsonButton.disabled = false;
    showStatus(status, `${files.count} ${files.count === 1 ? 'day' : 'days'} ready to export.`);
  };
  prepare().catch((err) => showStatus(status, err.message, 'error'));

  const share = async (file) => {
    try {
      const result = await shareFile(file);
      if (result === 'downloaded') showStatus(status, `Saved as ${file.name}.`, 'ok');
    } catch (err) {
      showStatus(status, `Could not share: ${err.message}`, 'error');
    }
  };
  csvButton.addEventListener('click', () => files && share(files.csv));
  jsonButton.addEventListener('click', () => files && share(files.json));

  const input = $('#import-file');
  $('#import-json').addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    showStatus(status, 'Importing…');
    try {
      const result = await importBackup(await file.text());
      await prepare();
      const days = (n) => `${n} ${n === 1 ? 'day' : 'days'}`;
      showStatus(status, `Imported ${days(result.added)}, updated ${days(result.updated)}, skipped ${days(result.skipped)} (same or older).`, 'ok');
      syncNow();
    } catch (err) {
      showStatus(status, err.message, 'error');
    }
    input.value = '';
  });
}

// ---------- PIN ----------

function mountPin($, rerender) {
  const status = $('#pin-status');
  const on = $('#pin-on');
  if (on) {
    on.addEventListener('click', async () => {
      const form = $('#pin-form');
      const pin = form.elements.pin.value.trim();
      if (!/^\d{4,6}$/.test(pin)) { showStatus(status, 'The PIN must be 4 to 6 digits.', 'error'); return; }
      if (pin !== form.elements.repeat.value.trim()) { showStatus(status, "The two PINs don't match.", 'error'); return; }
      await setPin(pin);
      rerender();
    });
    $('#pin-form').addEventListener('submit', (event) => event.preventDefault());
    return;
  }
  $('#pin-off').addEventListener('click', async () => {
    const pin = $('#pin-off-form').elements.pin.value.trim();
    if (!(await checkPin(pin))) { showStatus(status, 'Wrong PIN.', 'error'); return; }
    removePin();
    rerender();
  });
  $('#pin-off-form').addEventListener('submit', (event) => event.preventDefault());
}

// ---------- Demo ----------

function mountDemo($) {
  const build = $('#demo-build');
  const leave = $('#demo-leave');
  const status = $('#demo-status');

  build.addEventListener('click', async () => {
    const config = getConfig();
    if (!config) { showStatus(status, 'Load your questions first (connect the data repo above).', 'error'); return; }
    build.disabled = true;
    showStatus(status, 'Building the demo diary…');
    try {
      const info = getConfigInfo();
      const entries = buildDemoEntries(config, info.sha, logicalDate());
      await writeDemoDatabase({ config: { data: config, sha: info.sha, loadedAt: info.loadedAt } }, entries);
      setDemoMode(true);
      location.hash = '#/calendar';
      location.reload();
    } catch (err) {
      build.disabled = false;
      showStatus(status, `Could not build the demo diary: ${err.message}`, 'error');
    }
  });

  if (leave) {
    leave.addEventListener('click', () => {
      setDemoMode(false);
      location.hash = '#/today';
      location.reload();
    });
  }
}
