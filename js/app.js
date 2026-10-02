// Diary – start-up: screens, tab bar, offline support.
import { logicalDate, formatLongDate } from './logic.js';

const APP_VERSION = '0.1.0';

// Each screen returns its header text and its content.
const screens = {
  today: () => ({
    title: 'Today',
    subtitle: formatLongDate(logicalDate()),
    html: '<section class="card"><p>Your daily questions will appear here.</p></section>'
  }),
  calendar: () => ({
    title: 'Calendar',
    subtitle: '',
    html: '<section class="card"><p>A month view of your entries and cycle will appear here.</p></section>'
  }),
  trends: () => ({
    title: 'Trends',
    subtitle: '',
    html: '<section class="card"><p>Charts of your answers over time will appear here.</p></section>'
  }),
  settings: () => ({
    title: 'Settings',
    subtitle: '',
    html: `<section class="card">
        <div class="row"><span>App version</span><span>${APP_VERSION}</span></div>
        <div class="row"><span>Offline copy</span><span>${offlineStatus()}</span></div>
      </section>`
  })
};

let currentScreen = 'today';
let shownDate = logicalDate();

function offlineStatus() {
  if (!('serviceWorker' in navigator)) return 'Not supported';
  return navigator.serviceWorker.controller ? 'Ready' : 'Not ready yet';
}

// Show the screen named in the address, e.g. #/calendar
function render() {
  const name = location.hash.replace(/^#\//, '');
  currentScreen = screens[name] ? name : 'today';
  shownDate = logicalDate();

  const screen = screens[currentScreen]();
  document.getElementById('title').textContent = screen.title;
  document.getElementById('subtitle').textContent = screen.subtitle;

  const view = document.getElementById('view');
  view.innerHTML = screen.html;
  view.scrollTop = 0;

  for (const link of document.querySelectorAll('.tabbar a')) {
    if (link.dataset.tab === currentScreen) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}

window.addEventListener('hashchange', render);

// The app can sit in the background for days: when it comes back, refresh if the date has changed.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && logicalDate() !== shownDate) render();
});

// Offline support: sw.js keeps a copy of the app on the phone.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js')
    .catch((err) => console.error('Service worker registration failed:', err));
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (currentScreen === 'settings') render();
  });
}

render();
