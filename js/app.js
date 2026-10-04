// Diary – start-up: screens, tab bar, offline support, loading the questions, backup.
import { logicalDate } from './logic.js';
import { dbGet, dbGetAll, isDemoMode } from './db.js';
import { initConfig, refreshConfig } from './config.js';
import { syncNow } from './sync.js';
import { dayScreen } from './day.js';
import { packScreen } from './form.js';
import { calendarScreen } from './calendar.js';
import { trendsScreen } from './trends.js';
import { settingsScreen } from './settings.js';

const APP_VERSION = '1.2.0';
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
  trends: () => trendsScreen(),
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
  let screen;
  try {
    screen = await routes[name](...args);
  } catch (err) {
    console.error(err);
    screen = { title: 'Problem', subtitle: '', html: `<section class="card"><p>This screen could not be shown: ${String(err.message).replace(/</g, '&lt;')}</p></section>
      <a class="button" href="#/settings">Open Settings</a>` };
  }
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

// Fetch config.json (quietly; problems are shown in Settings). At most every 10 minutes.
let lastRefresh = 0;
async function refreshConfigInBackground() {
  if (Date.now() - lastRefresh < AUTO_REFRESH_MINUTES * 60 * 1000) return;
  lastRefresh = Date.now();
  const github = await dbGet('settings', 'github');
  if (!github || !github.token || isDemoMode()) return;
  try {
    const changed = await refreshConfig(github);
    if (changed && currentScreen === 'today') render();
  } catch {
    // Offline or a problem with config.json: the saved copy stays in use.
  }
}

// Back up now; if days arrived from GitHub, refresh the screen that shows them.
async function backUpInBackground() {
  const before = await countEntries();
  await syncNow();
  if ((await countEntries()) !== before && (currentScreen === 'today' || currentScreen === 'calendar')) render();
}

async function countEntries() {
  return (await dbGetAll('entries')).length;
}

// Shows whose diary this is (or the demo label) in the header.
export async function showBadge() {
  const badge = document.getElementById('mode');
  if (isDemoMode()) {
    badge.textContent = 'Demo diary – simulated data';
    badge.hidden = false;
    return;
  }
  const person = await dbGet('settings', 'person');
  badge.textContent = person ? `${person}'s diary` : '';
  badge.hidden = !person;
}

window.addEventListener('hashchange', render);
window.addEventListener('online', () => { syncNow(); });

// The app can sit in the background for days: when it comes back, refresh the date, questions and backup.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  if (logicalDate() !== shownDate) render();
  refreshConfigInBackground();
  backUpInBackground();
});

async function start() {
  try { localStorage.removeItem('diary-pin'); } catch { /* the PIN lock was removed in 1.1.0 */ }
  // The demo diary gets its own header colour, so it is never mistaken for real data.
  if (isDemoMode()) document.body.classList.add('demo');
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
  await showBadge();
  await render();
  refreshConfigInBackground();
  backUpInBackground();
}

start();
