// Diary – PIN lock: a screen lock for when someone else holds your unlocked phone.
// Only a salted hash of the PIN is stored. The app is covered as soon as it goes to the background
// (so the app switcher shows nothing), and asks for the PIN if you were away for more than a minute.
// Forgot the PIN? The only way out is to erase the diary on this phone and restore it from GitHub.

import { eraseAllLocalData } from './db.js';
import { toBase64, fromBase64 } from './crypto.js';

const PIN_KEY = 'diary-pin';
const GRACE_MS = 60 * 1000;

function readPin() {
  try {
    return JSON.parse(localStorage.getItem(PIN_KEY));
  } catch {
    return null;
  }
}

export function pinEnabled() {
  return !!readPin();
}

async function hashPin(pin, salt) {
  const data = new Uint8Array([...salt, ...new TextEncoder().encode(pin)]);
  return toBase64(new Uint8Array(await crypto.subtle.digest('SHA-256', data)));
}

export async function setPin(pin) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  localStorage.setItem(PIN_KEY, JSON.stringify({ salt: toBase64(salt), hash: await hashPin(pin, salt), length: pin.length }));
}

export function removePin() {
  localStorage.removeItem(PIN_KEY);
}

export async function checkPin(pin) {
  const stored = readPin();
  if (!stored) return true;
  return (await hashPin(pin, fromBase64(stored.salt))) === stored.hash;
}

// ---------- Lock screen ----------

let overlay = null;
let locked = false;
let hiddenAt = 0;
let typed = '';

export function initLock() {
  if (pinEnabled()) lock();
  document.addEventListener('visibilitychange', () => {
    if (!pinEnabled()) return;
    if (document.hidden) {
      hiddenAt = Date.now();
      if (!locked) cover();
    } else if (!locked) {
      if (Date.now() - hiddenAt > GRACE_MS) lock();
      else removeOverlay();
    }
  });
  document.addEventListener('keydown', (event) => {
    if (!locked) return;
    if (/^\d$/.test(event.key)) press(event.key);
    else if (event.key === 'Backspace') press('del');
  });
}

function removeOverlay() {
  if (overlay) overlay.remove();
  overlay = null;
}

// Plain cover without keypad (shown while the app is in the background).
function cover() {
  removeOverlay();
  overlay = document.createElement('div');
  overlay.className = 'lock';
  document.body.appendChild(overlay);
}

function lock() {
  locked = true;
  typed = '';
  removeOverlay();
  const length = (readPin() || {}).length || 4;
  overlay = document.createElement('div');
  overlay.className = 'lock';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Diary is locked');
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'];
  overlay.innerHTML = `
    <div class="lock-inner">
      <p class="lock-title">Diary</p>
      <p class="lock-text" id="lock-text">Enter your PIN</p>
      <div class="lock-dots" aria-hidden="true">${'<span></span>'.repeat(length)}</div>
      <div class="keypad">
        ${keys.map((k) => (k === ''
          ? '<span></span>'
          : `<button type="button" data-key="${k}" aria-label="${k === 'del' ? 'Delete' : k}">${k === 'del' ? '⌫' : k}</button>`)).join('')}
      </div>
      <button type="button" class="lock-forgot">Forgot PIN?</button>
    </div>`;
  overlay.addEventListener('click', (event) => {
    const key = event.target.closest('[data-key]');
    if (key) press(key.dataset.key);
    else if (event.target.closest('.lock-forgot')) forgot();
  });
  document.body.appendChild(overlay);
}

async function press(key) {
  const length = (readPin() || {}).length || 4;
  if (key === 'del') typed = typed.slice(0, -1);
  else if (typed.length < length) typed += key;
  showDots();
  if (typed.length < length) return;

  if (await checkPin(typed)) {
    locked = false;
    typed = '';
    removeOverlay();
  } else {
    typed = '';
    const text = overlay.querySelector('#lock-text');
    text.textContent = 'Wrong PIN. Try again.';
    overlay.querySelector('.lock-dots').classList.add('shake');
    setTimeout(() => {
      if (!overlay) return;
      overlay.querySelector('.lock-dots').classList.remove('shake');
      showDots();
    }, 400);
  }
}

function showDots() {
  if (!overlay) return;
  overlay.querySelectorAll('.lock-dots span').forEach((dot, i) => dot.classList.toggle('on', i < typed.length));
}

async function forgot() {
  const ok = window.confirm(
    'This erases the diary on this phone (entries, token, key, PIN). Days already backed up on GitHub ' +
    'can be restored afterwards with your token and key. Erase now?');
  if (!ok) return;
  await eraseAllLocalData();
  location.hash = '#/settings';
  location.reload();
}
