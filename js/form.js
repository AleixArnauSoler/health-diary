// Diary – one pack as a form: shows its questions, applies the branching, saves as you go.
import { dbGet, dbGetAll, dbPut } from './db.js';
import { getConfig, getConfigInfo } from './config.js';
import { scheduleSync } from './sync.js';
import {
  logicalDate, formatLongDate, formatShortDate, isISODate, nowLocalISO, escapeHtml as esc,
  isAnswered, makeAnswerLookup, packVisibility, evaluate, computeScore
} from './logic.js';

const SAVE_AFTER_TAP_MS = 50;
const SAVE_AFTER_TYPING_MS = 800;

export async function packScreen(packId, date) {
  const today = logicalDate();
  const validDate = isISODate(date || '');
  const backHref = !validDate || date === today ? '#/today' : `#/day/${date}`;
  const base = {
    subtitle: validDate ? formatLongDate(date) : '',
    back: { href: backHref, label: !validDate || date === today ? 'Today' : formatShortDate(date) },
    tab: !validDate || date === today ? 'today' : 'calendar'
  };
  const message = (title, text) => ({ ...base, title, html: `<section class="card"><p>${esc(text)}</p></section>` });

  const config = getConfig();
  if (!config) return message('Questions', 'Connect your private data repo in Settings first.');
  const pack = config.packs.find((p) => p.id === packId && !p.retired);
  if (!pack) return message('Not found', 'This pack is not in your config.');
  if (!validDate || date > today) return message(pack.title, 'You can only fill in today or earlier days.');

  const entries = await dbGetAll('entries');
  const answersFor = makeAnswerLookup(entries);
  const entry = entries.find((e) => e.date === date);
  const lastSaved = entry
    ? pack.questions.map((q) => entry.answers[q.id] && entry.answers[q.id].modified_at).filter(Boolean).sort().pop()
    : null;
  const earlierDates = entries.map((e) => e.date).filter((d) => d < date).sort().reverse();
  const saved = answersFor(date);

  // Start from what is saved for this date; "prefill: last" questions copy the most recent earlier answer.
  const values = {};
  const prefilledFrom = {};
  for (const q of pack.questions) {
    if (q.retired) continue;
    if (q.id in saved) {
      values[q.id] = saved[q.id];
    } else if (q.prefill === 'last') {
      const from = earlierDates.find((d) => q.id in answersFor(d));
      if (from) {
        values[q.id] = answersFor(from)[q.id];
        prefilledFrom[q.id] = from;
      }
    }
  }

  const html = `<div class="pack-form">
    ${pack.help ? `<p class="pack-help">${esc(pack.help)}</p>` : ''}
    ${pack.questions.filter((q) => !q.retired).map((q) => questionHtml(q, values[q.id], prefilledFrom[q.id])).join('')}
    ${pack.score ? '<p class="score" id="score" hidden></p>' : ''}
    ${pack.alert ? `<div class="alert" id="alert" role="alert" hidden>${esc(pack.alert.text)}</div>` : ''}
    <a class="button" href="${backHref}">Done</a>
    <p class="status" id="save-status">${lastSaved ? `Saved ${savedWhen(lastSaved)}.` : 'Answers are saved as you go.'}</p>
    ${pack.source ? `<p class="source">${esc(pack.source)}</p>` : ''}
  </div>`;

  return {
    ...base,
    title: pack.title,
    html,
    mount: (view) => mountForm(view, pack, date, values, answersFor)
  };
}

// "at 21:14" today, "on 2 Oct at 21:14" otherwise.
function savedWhen(timestamp) {
  const when = new Date(timestamp);
  const time = when.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  if (when.toDateString() === new Date().toDateString()) return `at ${time}`;
  return `on ${when.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} at ${time}`;
}

// ---------- HTML for one question ----------

function questionHtml(q, value, prefilledDate) {
  const labelId = `label-${q.id}`;
  return `
    <section class="q" data-qid="${esc(q.id)}" role="group" aria-labelledby="${labelId}" hidden>
      <h3 class="q-label" id="${labelId}">${esc(q.label)}</h3>
      ${q.help ? `<p class="q-help">${esc(q.help)}</p>` : ''}
      ${controlHtml(q, value)}
      ${prefilledDate ? `<p class="q-note">Same as on ${formatShortDate(prefilledDate)}. Change it if needed.</p>` : ''}
    </section>`;
}

function pressed(on) {
  return `aria-pressed="${on ? 'true' : 'false'}"`;
}

function controlHtml(q, value) {
  switch (q.type) {
    case 'yesno':
      return `<div class="seg">
          <button type="button" class="opt" data-v="yes" ${pressed(value === true)}>Yes</button>
          <button type="button" class="opt" data-v="no" ${pressed(value === false)}>No</button>
        </div>`;
    case 'single':
      return `<div class="opts">${q.options.map((o, i) =>
        `<button type="button" class="opt" data-i="${i}" ${pressed(value === o.value)}>${esc(o.label)}</button>`).join('')}</div>`;
    case 'multi':
      return `<div class="chips">${q.options.map((o, i) =>
        `<button type="button" class="chip" data-i="${i}" ${pressed(Array.isArray(value) && value.includes(o.value))}>${esc(o.label)}</button>`).join('')}</div>`;
    case 'scale': {
      const buttons = [];
      for (let v = q.min; v <= q.max; v += q.step || 1) {
        buttons.push(`<button type="button" class="opt" data-v="${v}" ${pressed(value === v)}>${v}</button>`);
      }
      return `<div class="scale" style="--count:${buttons.length}">${buttons.join('')}</div>
        <div class="scale-ends"><span>${esc(q.minLabel || '')}</span><span>${esc(q.maxLabel || '')}</span></div>`;
    }
    case 'number': {
      const range = `${q.min !== undefined ? `min="${q.min}"` : ''} ${q.max !== undefined ? `max="${q.max}"` : ''}`;
      return `<div class="num">
          <input type="number" inputmode="numeric" ${range} step="${q.step || 1}" value="${isAnswered(value) ? value : ''}">
          ${q.unit ? `<span>${esc(q.unit)}</span>` : ''}
        </div>`;
    }
    case 'time':
      return `<div class="timebox">
          <input type="time" value="${isAnswered(value) ? esc(value) : ''}">
          <button type="button" class="clear" ${isAnswered(value) ? '' : 'hidden'}>Clear</button>
        </div>`;
    case 'text':
      return `<textarea rows="2" maxlength="2000">${isAnswered(value) ? esc(value) : ''}</textarea>`;
    default:
      return '';
  }
}

// Brings the buttons of one question in line with its current answer.
function updateControl(section, q, value) {
  if (q.type === 'yesno') {
    for (const b of section.querySelectorAll('.opt')) b.setAttribute('aria-pressed', String(value === (b.dataset.v === 'yes')));
  } else if (q.type === 'single') {
    for (const b of section.querySelectorAll('.opt')) b.setAttribute('aria-pressed', String(value === q.options[Number(b.dataset.i)].value));
  } else if (q.type === 'scale') {
    for (const b of section.querySelectorAll('.opt')) b.setAttribute('aria-pressed', String(value === Number(b.dataset.v)));
  } else if (q.type === 'multi') {
    for (const b of section.querySelectorAll('.chip')) {
      b.setAttribute('aria-pressed', String(Array.isArray(value) && value.includes(q.options[Number(b.dataset.i)].value)));
    }
  } else if (q.type === 'time') {
    section.querySelector('.clear').hidden = !isAnswered(value);
  }
}

// ---------- Interaction ----------

function mountForm(view, pack, date, values, answersFor) {
  // Listeners go on this screen's own container, so they disappear with it.
  const root = view.querySelector('.pack-form');
  const byId = new Map(pack.questions.map((q) => [q.id, q]));
  const scoreEl = root.querySelector('#score');
  const alertEl = root.querySelector('#alert');
  const statusEl = root.querySelector('#save-status');
  let pending = false;              // answers changed but not written yet
  let timer = null;
  let writing = Promise.resolve();

  // Show/hide questions, update the score and the alert.
  function refresh() {
    const { visible, values: counted, lookup } = packVisibility(pack, values, date, answersFor);
    for (const section of root.querySelectorAll('.q')) section.hidden = !visible[section.dataset.qid];
    if (scoreEl) {
      const score = computeScore(pack.score, counted);
      scoreEl.hidden = score === null;
      if (score !== null) scoreEl.textContent = `${pack.score.label}: ${score}`;
    }
    if (alertEl) alertEl.hidden = !evaluate(pack.alert.if, lookup);
  }

  function save() {
    clearTimeout(timer);
    timer = null;
    if (!pending) return writing;
    pending = false;
    const snapshot = structuredClone(values);
    writing = writing
      .then(() => writePack(pack, date, snapshot, answersFor))
      .then((changed) => {
        if (!changed) return;
        statusEl.textContent = `Saved ${savedWhen(new Date().toISOString())}.`;
        statusEl.className = 'status';
      })
      .catch((err) => {
        statusEl.textContent = `Could not save: ${err.message}`;
        statusEl.className = 'status error';
      });
    return writing;
  }

  function changed(section, delay) {
    const note = section.querySelector('.q-note');
    if (note) note.remove();
    pending = true;
    refresh();
    clearTimeout(timer);
    timer = setTimeout(save, delay);
  }

  function setValue(q, value) {
    if (value === undefined) delete values[q.id];
    else values[q.id] = value;
  }

  // Taps on buttons. Tapping the selected answer again clears it.
  root.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    const section = button && button.closest('.q');
    const q = section && byId.get(section.dataset.qid);
    if (!q) return;
    const current = values[q.id];
    let next;

    if (button.classList.contains('clear')) {
      next = undefined;
      section.querySelector('input').value = '';
    } else if (q.type === 'yesno') {
      const v = button.dataset.v === 'yes';
      next = current === v ? undefined : v;
    } else if (q.type === 'single') {
      const v = q.options[Number(button.dataset.i)].value;
      next = current === v ? undefined : v;
    } else if (q.type === 'scale') {
      const v = Number(button.dataset.v);
      next = current === v ? undefined : v;
    } else if (q.type === 'multi') {
      const option = q.options[Number(button.dataset.i)];
      let list = Array.isArray(current) ? [...current] : [];
      if (list.includes(option.value)) list = list.filter((v) => v !== option.value);
      else if (option.exclusive) list = [option.value];
      else list = list.filter((v) => !q.options.some((o) => o.exclusive && o.value === v)).concat(option.value);
      const order = q.options.map((o) => o.value);
      list.sort((a, b) => order.indexOf(a) - order.indexOf(b));
      next = list.length ? list : undefined;
    } else {
      return;
    }
    setValue(q, next);
    updateControl(section, q, next);
    changed(section, SAVE_AFTER_TAP_MS);
  });

  // Typing and pickers.
  const onInput = (event) => {
    const field = event.target;
    const section = field.closest('.q');
    const q = section && byId.get(section.dataset.qid);
    if (!q) return;
    if (q.type === 'number') {
      const text = field.value.trim();
      const number = text === '' ? undefined : Number(text);
      const ok = number === undefined || (Number.isFinite(number) &&
        (q.min === undefined || number >= q.min) && (q.max === undefined || number <= q.max));
      field.classList.toggle('invalid', !ok);
      setValue(q, ok ? number : undefined);
    } else if (q.type === 'time') {
      setValue(q, field.value || undefined);
      updateControl(section, q, values[q.id]);
    } else if (q.type === 'text') {
      setValue(q, field.value === '' ? undefined : field.value);
      field.style.height = 'auto';
      field.style.height = `${field.scrollHeight + 2}px`;
    } else {
      return;
    }
    changed(section, q.type === 'time' ? SAVE_AFTER_TAP_MS : SAVE_AFTER_TYPING_MS);
  };
  root.addEventListener('input', onInput);
  root.addEventListener('change', onInput);

  // Save straight away if the app goes to the background.
  const onHidden = () => { if (document.hidden) save(); };
  document.addEventListener('visibilitychange', onHidden);

  refresh();

  // Called when you leave the screen: write anything still pending.
  return async () => {
    document.removeEventListener('visibilitychange', onHidden);
    await save();
  };
}

// ---------- Saving ----------

// Writes this pack's answers into the day's entry. Returns true if anything changed.
async function writePack(pack, date, values, answersFor) {
  const { visible } = packVisibility(pack, values, date, answersFor);
  const now = nowLocalISO();
  const existing = await dbGet('entries', date);
  const entry = existing
    ? structuredClone(existing)
    : { date, schema: 1, created_at: now, modified_at: now, config_sha: null, answers: {} };
  let changed = !existing;

  for (const q of pack.questions) {
    if (q.retired) continue;
    let status = 'unanswered';
    let value = null;
    if (!visible[q.id]) {
      status = 'skipped';                       // hidden by the branching
    } else if (isAnswered(values[q.id])) {
      status = 'answered';
      value = q.type === 'text' ? values[q.id].trim() : values[q.id];
    }
    const old = entry.answers[q.id];
    if (old && old.status === status && JSON.stringify(old.value) === JSON.stringify(value) &&
        old.version === q.version && old.type === q.type && old.pack === pack.id) continue;
    entry.answers[q.id] = {
      pack: pack.id,
      type: q.type,
      version: q.version,
      value,
      status,
      created_at: old ? old.created_at : now,
      modified_at: now
    };
    changed = true;
  }

  if (!changed) return false;
  entry.modified_at = now;
  entry.config_sha = getConfigInfo().sha;
  entry.sync = { ...(entry.sync || {}), dirty: true };   // "needs upload"; keeps the GitHub file version
  await dbPut('entries', entry);
  scheduleSync();
  return true;
}
