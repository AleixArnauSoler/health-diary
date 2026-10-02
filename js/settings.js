// Diary – Settings screen.
import { dbGet, dbPut } from './db.js';
import { checkRepo } from './sync.js';
import { getConfig, getConfigInfo, refreshConfig, configSummary } from './config.js';
import { escapeHtml as esc, formatDateTime } from './logic.js';

const DEFAULT_REPO = 'health-diary-data';

export async function settingsScreen({ appVersion, offlineStatus }) {
  const github = await dbGet('settings', 'github');
  const config = getConfig();
  const info = getConfigInfo();

  const tokenPlaceholder = github && github.token
    ? `Saved (ends in ${github.token.slice(-4)})`
    : 'github_pat_…';

  const connection = github
    ? `<p class="status ok" id="github-status" role="status">Connected to ${esc(github.owner)}/${esc(github.repo)}.</p>`
    : '<p class="status" id="github-status" role="status">Enter your GitHub username, the private repo name and your access token.</p>';

  let questionRows = '<div class="row"><span>Not loaded yet</span><span></span></div>';
  if (config) {
    const summary = configSummary(config);
    questionRows = `
      <div class="row"><span>Packs</span><span>${summary.packsActive} active of ${summary.packsTotal}</span></div>
      <div class="row"><span>Questions</span><span>${summary.questions}</span></div>
      <div class="row"><span>Version</span><span>${esc(info.sha.slice(0, 7))}</span></div>
      <div class="row"><span>Last checked</span><span>${info.lastCheck ? formatDateTime(info.lastCheck) : '–'}</span></div>`;
  }
  const configStatus = info.lastError
    ? `<p class="status error" id="config-status" role="status">${esc(info.lastError)}</p>`
    : '<p class="status" id="config-status" role="status"></p>';

  const html = `
    <h2 class="section">Private data repo</h2>
    <form id="github-form" autocomplete="off">
      <div class="card">
        <label class="field">
          <span>GitHub username</span>
          <input name="owner" value="${esc(github ? github.owner : '')}"
                 autocapitalize="none" autocorrect="off" spellcheck="false">
        </label>
        <label class="field">
          <span>Repo name</span>
          <input name="repo" value="${esc(github ? github.repo : DEFAULT_REPO)}"
                 autocapitalize="none" autocorrect="off" spellcheck="false">
        </label>
        <label class="field">
          <span>Access token</span>
          <input name="token" type="password" placeholder="${esc(tokenPlaceholder)}"
                 autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false">
        </label>
      </div>
      <button class="button" type="submit">Connect</button>
    </form>
    ${connection}

    <h2 class="section">Questions</h2>
    <section class="card">${questionRows}</section>
    <button class="button secondary" id="reload-config" type="button">Reload questions</button>
    ${configStatus}

    <h2 class="section">App</h2>
    <section class="card">
      <div class="row"><span>App version</span><span>${esc(appVersion)}</span></div>
      <div class="row"><span>Offline copy</span><span>${esc(offlineStatus)}</span></div>
    </section>`;

  return { title: 'Settings', subtitle: '', html, mount };
}

function showStatus(element, text, kind = '') {
  element.textContent = text;
  element.className = `status ${kind}`.trim();
}

function mount(view, rerender) {
  const form = view.querySelector('#github-form');
  const connectButton = form.querySelector('button');
  const githubStatus = view.querySelector('#github-status');
  const reloadButton = view.querySelector('#reload-config');
  const configStatus = view.querySelector('#config-status');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const saved = await dbGet('settings', 'github');
    const owner = form.elements.owner.value.trim();
    const repo = form.elements.repo.value.trim();
    const token = form.elements.token.value.trim() || (saved ? saved.token : '');
    if (!owner || !repo || !token) {
      showStatus(githubStatus, 'Fill in the username, the repo name and the token.', 'error');
      return;
    }

    connectButton.disabled = true;
    showStatus(githubStatus, 'Connecting…');
    const github = { owner, repo, token };
    try {
      const repoInfo = await checkRepo(github);
      if (!repoInfo.private) {
        showStatus(githubStatus, `${owner}/${repo} is a public repo. Your data must go in a private repo.`, 'error');
        return;
      }
      await dbPut('settings', github, 'github');
    } catch (err) {
      showStatus(githubStatus, err.message, 'error');
      return;
    } finally {
      connectButton.disabled = false;
    }

    try {
      await refreshConfig(github);
    } catch {
      // The problem is shown under "Questions" after the screen refreshes.
    }
    rerender();
  });

  reloadButton.addEventListener('click', async () => {
    const github = await dbGet('settings', 'github');
    if (!github) {
      showStatus(configStatus, 'Connect the data repo first.', 'error');
      return;
    }
    reloadButton.disabled = true;
    showStatus(configStatus, 'Loading…');
    try {
      await refreshConfig(github);
    } catch {
      // Shown after the screen refreshes.
    }
    rerender();
  });
}
