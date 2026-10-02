// Diary – start-up: screens, tab bar, offline support, loading the questions.
import { logicalDate, formatLongDate, escapeHtml as esc } from './logic.js';
import { dbGet } from './db.js';
import { initConfig, getConfig, refreshConfig } from './config.js';
import { settingsScreen } from './settings.js';

const APP_VERSION = '0.2.0';
const AUTO_REFRESH_MINUTES = 10;   // re-check config.json at most this often when the app comes back

// Each screen returns its header text, its content and (optionally) a mount() that wires up buttons.
const screens = {
  today: async () => {
    const title = 'Today';
    const subtitle = formatLongDate(logicalDate());
    const config = getConfig();
    if (!config) {
      return {
        title, subtitle,
        html: `<section class="card"><p>Connect your private data repo in Settings to load your questions.</p></section>
               <a class="button" href="#/settings">Open Settings</a>`
      };
    }
    const rows = config.packs
      .filter((pack) => !pack.retired)
      .map((pack) => `<div class="row"><span>${esc(pack.title)}</span><span>${scheduleText(pack)}</span></div>`)
      .join('');
    return { title, subtitle, html: `<h2 class="section">Your packs</h2><section class="card">${rows}</section>` };
  },
  calendar: async () => ({
    title: 'Calendar',
    subtitle: '',
    html: '<section class="card"><p>A month view of your entries and cycle will appear here.</p></section>'
  }),
  trends: async () => ({
    title: 'Trends',
    subtitle: '',
    html: '<section class="card"><p>Charts of your answers over time will appear here.</p></section>'
  }),
  settings: () => settingsScreen({ appVersion: APP_VERSION, offlineStatus: offlineStatus() })
};

function scheduleText(pack) {
  if (pack.enabled === false) return 'Off';
  const days = pack.schedule.everyDays;
  return days === 1 ? 'Daily' : `Every ${days} days`;
}

function offlineStatus() {
  if (!('serviceWorker' in navigator)) return 'Not supported';
  return navigator.serviceWorker.controller ? 'Ready' : 'Not ready yet';
}

let currentScreen = 'today';
let shownDate = logicalDate();
let renderCount = 0;

// Show the screen named in the address, e.g. #/calendar
async function render() {
  const thisRender = ++renderCount;
  const name = location.hash.replace(/^#\//, '');
  const key = screens[name] ? name : 'today';
  const screen = await screens[key]();
  if (thisRender !== renderCount) return;   // the user already tapped somewhere else

  currentScreen = key;
  shownDate = logicalDate();
  document.getElementById('title').textContent = screen.title;
  document.getElementById('subtitle').textContent = screen.subtitle;

  const view = document.getElementById('view');
  view.innerHTML = screen.html;
  view.scrollTop = 0;

  for (const link of document.querySelectorAll('.tabbar a')) {
    if (link.dataset.tab === currentScreen) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  if (screen.mount) screen.mount(view, render);
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
