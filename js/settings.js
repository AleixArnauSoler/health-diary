// Diary – Settings screen.
import { dbGet, dbPut, isDemoMode, setDemoMode, writeDemoDatabase } from './db.js';
import { checkRepo } from './sync.js';
import { getConfig, getConfigInfo, refreshConfig, configSummary } from './config.js';
import { buildDemoEntries } from './demo.js';
import { escapeHtml as esc, formatDateTime, logicalDate } from './logic.js';

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

  const demo = isDemoMode();
  const githubSection = demo
    ? `<h2 class="section">Private data repo</h2>
       <section class="card"><p>The demo diary is not connected to GitHub, so nothing from it is uploaded.</p></section>`
    : `<h2 class="section">Private data repo</h2>
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
    ${connection}`;

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

  const html = `
    ${githubSection}

    <h2 class="section">Questions</h2>
    <section class="card">${questionRows}</section>
    ${demo ? '' : '<button class="button secondary" id="reload-config" type="button">Reload questions</button>'}
    ${configStatus}

    ${demoSection}

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
  mountDemo(view);
  const form = view.querySelector('#github-form');
  if (!form) return;                         // demo diary: no GitHub connection
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

function mountDemo(view) {
  const build = view.querySelector('#demo-build');
  const leave = view.querySelector('#demo-leave');
  const status = view.querySelector('#demo-status');

  build.addEventListener('click', async () => {
    const config = getConfig();
    if (!config) {
      showStatus(status, 'Load your questions first (connect the data repo above).', 'error');
      return;
    }
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
