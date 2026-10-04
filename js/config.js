// Diary – the questionnaire config (config.json in the private data repo).
// A checked copy is kept on the phone, so the app works offline.
// If an edited config.json has mistakes, the app keeps using the last good copy.

import { dbGet, dbPut } from './db.js';
import { getFile } from './sync.js';

const TYPES = ['yesno', 'single', 'multi', 'scale', 'number', 'time', 'text'];
const OPS = ['eq', 'ne', 'in', 'has', 'gte', 'lte', 'answered'];

let saved = { data: null, sha: null, loadedAt: null };
let lastError = null;
let lastCheck = null;

// Load the copy saved on the phone (call once at start-up).
export async function initConfig() {
  const stored = await dbGet('settings', 'config');
  if (stored) saved = stored;
}

export function getConfig() {
  return saved.data;
}

export function getConfigInfo() {
  return { sha: saved.sha, loadedAt: saved.loadedAt, lastError, lastCheck };
}

// Fetch config.json from GitHub. Returns true if a new version was loaded.
export async function refreshConfig(github) {
  lastCheck = new Date().toISOString();
  try {
    const file = await getFile(github, 'config.json');
    if (!file) throw new Error('config.json was not found in the data repo.');
    if (file.sha === saved.sha) {
      lastError = null;
      return false;
    }
    let data;
    try {
      data = JSON.parse(file.text);
    } catch (err) {
      throw new Error(`config.json is not valid JSON (${err.message}).`);
    }
    const problems = validateConfig(data);
    if (problems.length) {
      throw new Error(`config.json has ${problems.length} problem(s), so the previous version is still in use:\n• ` +
        problems.slice(0, 8).join('\n• '));
    }
    saved = { data, sha: file.sha, loadedAt: lastCheck };
    await dbPut('settings', saved, 'config');
    lastError = null;
    return true;
  } catch (err) {
    lastError = err.message;
    throw err;
  }
}

// Counts for the Settings screen.
export function configSummary(config) {
  const active = config.packs.filter((p) => !p.retired && p.enabled !== false);
  return {
    packsActive: active.length,
    packsTotal: config.packs.filter((p) => !p.retired).length,
    questions: active.reduce((n, p) => n + p.questions.filter((q) => !q.retired).length, 0)
  };
}

// Returns a list of problems in plain language (empty list = config is fine).
export function validateConfig(config) {
  const problems = [];
  if (!config || typeof config !== 'object') return ['The file is not a JSON object.'];
  if (config.schema !== 1) problems.push('"schema" must be 1.');
  if (!Array.isArray(config.packs) || config.packs.length === 0) {
    problems.push('"packs" must be a list with at least one pack.');
    return problems;
  }

  const isId = (x) => typeof x === 'string' && /^[a-z][a-z0-9_]*$/.test(x);
  const isVersion = (x) => Number.isInteger(x) && x >= 1;
  const packIds = new Set();
  const questions = new Map();

  // 1st pass: packs and questions
  for (const pack of config.packs) {
    const where = `Pack "${pack && pack.id}"`;
    if (!isId(pack.id)) problems.push(`${where}: "id" must use only lowercase letters, digits and _.`);
    else if (packIds.has(pack.id)) problems.push(`${where}: this pack id is used twice.`);
    packIds.add(pack.id);
    if (!isVersion(pack.version)) problems.push(`${where}: "version" must be a whole number of 1 or more.`);
    if (typeof pack.title !== 'string' || !pack.title) problems.push(`${where}: "title" is missing.`);
    const every = pack.schedule && pack.schedule.everyDays;
    if (!Number.isInteger(every) || every < 1) problems.push(`${where}: "schedule.everyDays" must be a whole number of 1 or more.`);
    if (pack.since !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(pack.since)) problems.push(`${where}: "since" must be a date like "2026-10-04".`);
    if (!Array.isArray(pack.questions) || pack.questions.length === 0) {
      problems.push(`${where}: "questions" must be a list with at least one question.`);
      continue;
    }

    for (const q of pack.questions) {
      const qWhere = `Question "${q && q.id}"`;
      if (!isId(q.id)) { problems.push(`${qWhere}: "id" must use only lowercase letters, digits and _.`); continue; }
      if (questions.has(q.id)) problems.push(`${qWhere}: this question id is used twice.`);
      questions.set(q.id, q);
      if (!isVersion(q.version)) problems.push(`${qWhere}: "version" must be a whole number of 1 or more.`);
      if (!TYPES.includes(q.type)) problems.push(`${qWhere}: "type" must be one of ${TYPES.join(', ')}.`);
      if (typeof q.label !== 'string' || !q.label) problems.push(`${qWhere}: "label" is missing.`);
      if (q.since !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(q.since)) problems.push(`${qWhere}: "since" must be a date like "2026-10-04".`);

      if (q.type === 'single' || q.type === 'multi') {
        if (!Array.isArray(q.options) || q.options.length < 2) {
          problems.push(`${qWhere}: needs an "options" list with at least two options.`);
        } else {
          const values = new Set();
          for (const option of q.options) {
            const okValue = (typeof option.value === 'string' && option.value !== '' && !option.value.includes(';')) ||
              Number.isFinite(option.value);
            if (!okValue) problems.push(`${qWhere}: each option needs a "value" (text without ";", or a number).`);
            else if (values.has(option.value)) problems.push(`${qWhere}: option value "${option.value}" is used twice.`);
            values.add(option.value);
            if (typeof option.label !== 'string' || !option.label) problems.push(`${qWhere}: each option needs a "label".`);
          }
        }
      }
      if (q.type === 'scale' && !(Number.isFinite(q.min) && Number.isFinite(q.max) && q.min < q.max)) {
        problems.push(`${qWhere}: a scale needs "min" and "max" numbers, with min < max.`);
      }
    }
  }

  // 2nd pass: everything that refers to a question must point to one that exists
  const checkCondition = (cond, where) => {
    if (cond === undefined) return;
    if (!cond || typeof cond !== 'object') { problems.push(`${where}: the condition is not an object.`); return; }
    if ('all' in cond || 'any' in cond) {
      const list = cond.all || cond.any;
      if (!Array.isArray(list) || list.length === 0) problems.push(`${where}: "all"/"any" needs a list of conditions.`);
      else list.forEach((c) => checkCondition(c, where));
      return;
    }
    if ('not' in cond) { checkCondition(cond.not, where); return; }
    if (!questions.has(cond.q)) problems.push(`${where}: the condition refers to an unknown question "${cond.q}".`);
    const used = OPS.filter((op) => op in cond);
    if (used.length !== 1) problems.push(`${where}: the condition needs exactly one of ${OPS.join(', ')}.`);
    if ('day' in cond && !(Number.isInteger(cond.day) && cond.day <= 0)) {
      problems.push(`${where}: "day" must be 0 or a negative whole number (-1 = yesterday).`);
    }
  };

  for (const pack of config.packs) {
    if (!Array.isArray(pack.questions)) continue;
    checkCondition(pack.showIf, `Pack "${pack.id}"`);
    for (const q of pack.questions) checkCondition(q.showIf, `Question "${q.id}"`);

    if (pack.score) {
      const where = `Score of pack "${pack.id}"`;
      if (!isId(pack.score.id)) problems.push(`${where}: "id" must use only lowercase letters, digits and _.`);
      else if (questions.has(pack.score.id)) problems.push(`${where}: "id" is already used by a question.`);
      if (!Array.isArray(pack.score.items) || pack.score.items.length === 0) problems.push(`${where}: "items" must list the questions to add up.`);
      else pack.score.items.forEach((id) => { if (!questions.has(id)) problems.push(`${where}: unknown question "${id}".`); });
      (pack.score.reverse || []).forEach((id) => {
        if (!(pack.score.items || []).includes(id)) problems.push(`${where}: reversed item "${id}" is not in "items".`);
      });
      checkCondition(pack.score.zeroIf, where);
    }
    if (pack.alert) {
      checkCondition(pack.alert.if, `Alert of pack "${pack.id}"`);
      if (typeof pack.alert.text !== 'string' || !pack.alert.text) problems.push(`Alert of pack "${pack.id}": "text" is missing.`);
    }
  }
  return problems;
}
