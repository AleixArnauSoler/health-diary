// Diary – start-up: screens, tab bar, offline support, loading the questions.
import { logicalDate } from './logic.js';
import { dbGet, isDemoMode } from './db.js';
import { initConfig, refreshConfig } from './config.js';
import { dayScreen } from './day.js';
import { packScreen } from './form.js';
import { calendarScreen } from './calendar.js';
import { settingsScreen } from './settings.js';

const APP_VERSION = '0.4.0';
const AUTO_REFRESH_MINUTES = 10;   // re-check config.json at most this often when the app comes back

// Screens by address: #/today, #/day/<date>, #/pack/<pack id>/<date>, #/calendar[/<YYYY-MM>],
// #/trends, #/settings
// Each returns { title, subtitle, html, back?, tab?, mount? }. mount() wires up buttons and may
// return a clean-up function that runs before the next screen opens (used to save answers).
const routes = {
  today: () => dayScreen(logicalDate()),
  day: (date) => dayScreen(date),
  pack: (packId, date) => packScreen(packId, date),
  calendar: (month) => calendarScreen(month),
  trends: async () => ({
    title: 'Trends',
    subtitle: '',
    html: '<section class="card"><p>Charts of your answers over time will appear here.</p></section>'
  }),
  settings: () => settingsScreen({ appVersion: APP_VERSION, offlineStatus: offlineStatus() })
};

function offlineStatus() {
  if (!('serviceWorker' in navigator)) return 'Not supported';
  return navigator.serviceWorker.controller ? 'Ready' : 'Not ready yet';
}

function parseAddress() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  const name = routes[parts[0]] ? parts[0] : 'today';
  return { name, args: parts.slice(1) };
}

let currentScreen = 'today';
let shownDate = logicalDate();
let renderCount = 0;
let cleanup = null;

async function render() {
  const thisRender = ++renderCount;
  if (cleanup) {                          // e.g. save the answers of the form we are leaving
    const finish = cleanup;
    cleanup = null;
    try { await finish(); } catch (err) { console.error(err); }
  }

  const { name, args } = parseAddress();
  const screen = await routes[name](...args);
  if (thisRender !== renderCount) return;   // the user already tapped somewhere else

  currentScreen = name;
  shownDate = logicalDate();
  document.getElementById('title').textContent = screen.title;
  document.getElementById('subtitle').textContent = screen.subtitle;

  const back = document.getElementById('back');
  if (screen.back) {
    back.href = screen.back.href;
    back.textContent = `‹ ${screen.back.label}`;
    back.hidden = false;
  } else {
    back.hidden = true;
  }

  const view = document.getElementById('view');
  view.innerHTML = screen.html;
  view.scrollTop = 0;

  const tab = screen.tab || name;
  for (const link of document.querySelectorAll('.tabbar a')) {
    if (link.dataset.tab === tab) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  if (screen.mount) cleanup = screen.mount(view, render) || null;
}

// Fetch config.json from the private repo (quietly; problems are shown in Settings).
let lastAutoRefresh = 0;
async function autoRefreshConfig() {
  const github = await dbGet('settings', 'github');
  if (!github || !github.token) return;
  lastAutoRefresh = Date.now();
  try {
    const changed = await refreshConfig(github);
    if (changed && currentScreen === 'today') render();
  } catch {
    // Offline or a problem with config.json: the saved copy stays in use.
  }
}

window.addEventListener('hashchange', render);

// The app can sit in the background for days: when it comes back, refresh the date and the questions.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  if (logicalDate() !== shownDate) render();
  if (Date.now() - lastAutoRefresh > AUTO_REFRESH_MINUTES * 60 * 1000) autoRefreshConfig();
});

async function start() {
  // The demo diary gets its own header colour and a label, so it is never mistaken for real data.
  if (isDemoMode()) {
    document.body.classList.add('demo');
    document.getElementById('mode').hidden = false;
  }
  // Offline support: sw.js keeps a copy of the app on the phone.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js')
      .catch((err) => console.error('Service worker registration failed:', err));
  }
  try {
    await initConfig();
  } catch (err) {
    console.error('Could not read the saved config:', err);
  }
  await render();
  autoRefreshConfig();
}

start();
