// Diary – demo diary: about 3 months of simulated answers, for trying the calendar and charts.
// The demo lives in its own database ("diary-demo"); the real diary is never touched,
// and the demo has no GitHub connection, so nothing from it is ever uploaded.
//
// Built-in patterns (so the charts have something to show):
//   • cycles of ~28 days; period 4–6 days; mood dips and irritability rise before the period
//   • stomach pain and bloating far more likely on days with milk/dairy
//   • stress higher on weekdays and during one "deadline" week; a 5-day cold
//   • test factor phases from the spreadsheet: no test → condom test → lubricant test
//   • two allergic-type reactions (prawns; pollen), PHQ-9 / GAD-7 / WHO-5 every ~2 weeks

import { addDays, nowLocalISO, isAnswered, packVisibility } from './logic.js';

const DAYS = 90;

export function buildDemoEntries(config, configSha, today) {
  const rand = mulberry32(20261003);
  const chance = (p) => rand() < p;
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
  const normal = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const weighted = (pairs) => {
    let r = rand() * pairs.reduce((sum, [, w]) => sum + w, 0);
    for (const [value, w] of pairs) { r -= w; if (r <= 0) return value; }
    return pairs[pairs.length - 1][0];
  };

  const firstDay = addDays(today, -DAYS);
  const REACTION_DAY = 20;
  const POLLEN_DAY = 70;
  const ill = (i) => i >= 31 && i <= 35;
  const deadline = (i) => i >= 50 && i <= 56;

  // Menstrual cycles covering the whole period
  const cycles = [];
  let start = addDays(firstDay, -int(5, 20));
  while (start <= today) {
    const length = clamp(Math.round(28.5 + normal() * 1.6), 25, 33);
    cycles.push({ start, length, period: int(4, 6), testing: chance(0.5) });
    start = addDays(start, length);
  }
  const cycleOn = (date) => {
    const c = [...cycles].reverse().find((x) => x.start <= date);
    const day = Math.round((Date.parse(date) - Date.parse(c.start)) / 86400000) + 1;
    return { ...c, day, ovulation: c.length - 14 };
  };

  const packs = config.packs.filter((p) => !p.retired && p.enabled !== false);
  const questionById = new Map(packs.flatMap((p) => p.questions.map((q) => [q.id, q])));
  const answered = new Map();                      // date -> { id: value } (for "yesterday" conditions)
  const answersFor = (date) => answered.get(date) || {};

  const entries = [];
  const history = [];                              // latent daily states for the periodic questionnaires
  let moodPrev = 6.5;
  let stressPrev = 3.5;
  let fissurePrev = 0;
  let sexPrev = false;
  let fissureAfterSexPrev = 0;
  let lastShave = -int(1, 6);
  let nextShaveGap = int(7, 12);
  let nextPeriodic = 2;

  for (let i = 0; i < DAYS; i++) {
    const date = addDays(firstDay, i);
    const weekday = new Date(`${date}T12:00:00`).getDay();     // 0 = Sunday
    const weekend = weekday === 0 || weekday === 6;
    const phase = i < 30 ? 1 : i < 60 ? 2 : 3;
    const c = cycleOn(date);
    const premenstrual = c.day > c.length - 5;
    const earlyPeriod = c.day <= 2;
    const v = {};

    // ----- Food -----
    const allergenOdds = {
      gluten: 0.85, milk: 0.6, egg: 0.4, nuts: 0.2, peanut: 0.1, soy: 0.15, sesame: 0.1, fish: 0.15,
      crustaceans: 0.03, molluscs: 0.02, celery: 0.1, mustard: 0.1, lupin: 0.01, sulphites: weekend ? 0.4 : 0.15
    };
    const allergens = Object.keys(allergenOdds).filter((k) => chance(allergenOdds[k]));
    if (i === REACTION_DAY && !allergens.includes('crustaceans')) allergens.push('crustaceans');
    v.food_allergens = allergens.length ? allergens : ['none'];
    const triggerOdds = {
      alcohol: weekend ? 0.5 : 0.12, caffeine: 0.85, spicy: 0.15, fatty: 0.25, onion_garlic: 0.6, legumes: 0.25,
      fruit: 0.55, polyols: 0.05, fizzy: 0.1, processed: 0.15, late_meal: weekend ? 0.3 : 0.1
    };
    const triggers = Object.keys(triggerOdds).filter((k) => chance(triggerOdds[k]));
    v.food_triggers = triggers.length ? triggers : ['none'];
    v.food_new = chance(0.05);
    if (v.food_new) v.food_new_what = pick(['Tempeh', 'Thai green curry', 'Kombucha', 'Oat drink', 'Kimchi']);
    if (chance(0.3)) {
      v.meals = pick(['Muesli; pasta salad; vegetable curry', 'Toast; lentil soup; pizza', 'Yoghurt; sandwich; stir-fry',
        'Porridge; canteen lunch; omelette', 'Croissant; salad bowl; risotto']);
    }
    const milk = allergens.includes('milk');
    const gasProne = triggers.includes('legumes') || triggers.includes('onion_garlic');

    // ----- Stress (affects sleep) -----
    const stressBase = 3.5 + (weekend ? -1 : 0.8) + (deadline(i) ? 3 : 0) + (ill(i) ? 1 : 0);
    const stressLatent = 0.55 * stressPrev + 0.45 * stressBase + normal() * 0.6;
    stressPrev = stressLatent;

    // ----- Sleep (the night before this date) -----
    const weekendNight = weekday === 6 || weekday === 0;
    const bed = Math.round((weekendNight ? 23 * 60 + 45 : 23 * 60 + 5) + normal() * 25 + (stressLatent > 6 ? 15 : 0));
    const tryToSleep = bed + int(3, 20);
    const latency = clamp(Math.round(8 + Math.abs(normal()) * 8 + (stressLatent > 6 ? 12 : 0)), 2, 90);
    const wakes = weighted([[0, 45], [1, 32], [2, 16], [3, 7]]) + (earlyPeriod && chance(0.4) ? 1 : 0);
    const waso = wakes ? wakes * int(4, 15) : 0;
    const finalWake = Math.round((weekendNight ? 8 * 60 + 20 : 6 * 60 + 55) + normal() * 18);
    const asleep = (finalWake + 24 * 60 - tryToSleep) % (24 * 60) - latency - waso;
    const quality = clamp(Math.round(3 + (asleep > 420 ? 1 : 0) - (asleep < 360 ? 1 : 0) + (wakes === 0 ? 0.5 : 0) -
      (latency > 30 ? 1 : 0) + normal() * 0.6), 1, 5);
    Object.assign(v, {
      sleep_bed: clock(bed), sleep_try: clock(tryToSleep), sleep_latency: latency, sleep_wakes: wakes,
      sleep_final: clock(finalWake), sleep_up: clock(finalWake + int(4, 25)), sleep_quality: quality
    });
    if (wakes) v.sleep_waso = waso;

    // ----- Cycle -----
    if (c.day <= c.period) {
      const flows = [pick(['medium', 'heavy']), pick(['heavy', 'heavy', 'medium']), pick(['medium', 'light']),
        'light', pick(['light', 'spotting']), 'spotting'];
      v.period_flow = flows[c.day - 1];
    } else {
      v.period_flow = c.day === c.length && chance(0.3) ? 'spotting' : 'none';
    }
    if (c.day <= c.period) v.discharge = 'none';
    else if (Math.abs(c.day - c.ovulation) <= 1) v.discharge = chance(0.7) ? 'eggwhite' : 'watery';
    else if (c.day >= c.ovulation - 4 && c.day < c.ovulation - 1) v.discharge = pick(['creamy', 'watery', 'creamy']);
    else if (c.day > c.ovulation + 1) v.discharge = pick(['sticky', 'creamy', 'sticky', 'none']);
    else v.discharge = pick(['none', 'sticky']);
    if (chance(0.02)) v.discharge = 'unusual';
    const testing = c.testing && c.day >= c.ovulation - 4 && c.day <= c.ovulation + 1;
    v.ovulation_test = !testing ? 'not_taken' : (c.day >= c.ovulation - 1 && c.day <= c.ovulation ? 'positive' : 'negative');

    // ----- Sex & vulva -----
    const sexOdds = c.day <= c.period ? 0.05 : Math.abs(c.day - c.ovulation) <= 2 ? 0.4 : 0.27;
    v.sex = chance(sexOdds);
    const condom = phase === 1 ? weighted([['latex', 50], ['none', 30], ['polyisoprene', 20]]) : 'polyisoprene';
    const lube = phase === 3 ? 'silicone' : phase === 2 ? pick(['water', 'none']) : weighted([['water', 50], ['none', 40], ['silicone', 10]]);
    let fissure = 0;
    if (v.sex) {
      const risk = clamp(0.3 + (condom === 'latex' ? 0.2 : condom === 'polyisoprene' ? -0.05 : 0) +
        (lube === 'none' ? 0.15 : lube === 'silicone' ? -0.15 : 0), 0.05, 0.9);
      v.condom = condom;
      v.lube = lube;
      v.sex_symptoms = chance(risk) ? weighted([[1, 60], [2, 30], [3, 10]]) : 0;
      fissure = chance(risk) ? weighted([[1, 70], [2, 24], [3, 6]]) : 0;
    } else if (fissurePrev > 0 && chance(0.5)) {
      fissure = fissurePrev - 1;
    }
    v.fissure = fissure;
    const probiotics = i >= 45 && chance(0.9);
    v.itch = chance(0.12 + (c.day <= c.period ? 0.15 : 0) + (premenstrual ? 0.1 : 0) - (probiotics ? 0.05 : 0))
      ? weighted([[1, 75], [2, 25]]) : 0;
    if (sexPrev) v.nextday = clamp(fissureAfterSexPrev + (chance(0.25) ? 1 : 0) - (chance(0.3) ? 1 : 0), 0, 3);
    v.oekolp = (weekday === 1 || weekday === 4) && chance(0.9);
    if (v.oekolp) v.oekolp_amount = pick(['normal', 'normal', 'thin']);
    if (i - lastShave >= nextShaveGap) { lastShave = i; nextShaveGap = int(7, 12); }
    const sinceShave = i - lastShave;
    v.shave_since = sinceShave === 0 ? 'lt24h' : sinceShave <= 2 ? '24-48h' : sinceShave <= 7 ? '3-7d' : 'gt7d';
    v.probiotics = probiotics;
    v.test_factor = phase === 1 ? 'none' : phase === 2 ? 'condom' : 'lube';
    if (phase === 2) v.test_variant = 'Polyisoprene condom';
    if (phase === 3) v.test_variant = 'Silicone-based lubricant';
    fissurePrev = fissure;
    sexPrev = v.sex;
    fissureAfterSexPrev = v.sex ? fissure : 0;

    // ----- Pain, digestion, reactions -----
    const sites = {};
    if (earlyPeriod && chance(0.85)) sites.pelvis = int(4, 7);
    else if (c.day === 3 && chance(0.4)) sites.pelvis = int(2, 4);
    else if (c.day === c.ovulation && chance(0.2)) sites.pelvis = int(2, 3);
    if (chance(0.06 + (premenstrual ? 0.15 : 0) + (triggers.includes('alcohol') ? 0.1 : 0))) sites.head = int(3, 6);
    if (chance(milk ? 0.32 : 0.04)) sites.stomach = int(3, 6);
    if (premenstrual && chance(0.3)) sites.breasts = int(2, 4);
    if (chance(0.04)) sites.back = int(2, 4);
    if (fissure >= 2 && chance(0.5)) sites.vulva = int(2, 5);
    if (chance(0.02)) sites.joints = int(2, 4);
    const siteOrder = ['head', 'breasts', 'stomach', 'pelvis', 'vulva', 'back', 'joints', 'other'];
    const painSites = siteOrder.filter((s) => s in sites);
    v.pain_any = painSites.length > 0;
    if (v.pain_any) {
      v.pain_sites = painSites;
      for (const s of painSites) v[`pain_${s}`] = sites[s];
    }
    if (sites.stomach) v.stomach_onset = milk ? (chance(0.7) ? '30min-2h' : 'lt30min') : pick(['gt2h', 'unrelated', 'unsure']);
    v.gi_any = chance((milk ? 0.35 : 0.04) + (gasProne ? 0.12 : 0)) || (!!sites.stomach && chance(0.6));
    if (v.gi_any) {
      const gi = milk ? ['bloating', 'wind', ...(chance(0.4) ? ['diarrhoea'] : [])]
        : gasProne ? ['bloating', 'wind'] : [pick(['bloating', 'nausea', 'reflux', 'constipation'])];
      v.gi_symptoms = gi;
    }
    v.reaction_any = i === REACTION_DAY || i === POLLEN_DAY;
    if (i === REACTION_DAY) {
      Object.assign(v, { reaction_symptoms: ['mouth', 'hives'], reaction_onset: 'lt30min', reaction_treatment: ['antihistamine'] });
    } else if (i === POLLEN_DAY) {
      Object.assign(v, { reaction_symptoms: ['nose', 'eyes'], reaction_onset: 'unrelated', reaction_treatment: ['none'] });
    }
    if (sites.stomach || v.gi_any || v.reaction_any) {
      if (i === REACTION_DAY) {
        v.suspect_food = 'Prawns';
        v.meal_before = 'Prawn risotto at a restaurant';
      } else if (i !== POLLEN_DAY) {
        v.suspect_food = milk ? pick(['Milk in coffee', 'Cheese', 'Yoghurt']) : gasProne ? pick(['Lentils', 'Onions']) : 'Not sure';
        v.meal_before = milk ? pick(['Cappuccino and a cheese sandwich', 'Pasta with cream sauce', 'Muesli with milk'])
          : pick(['Lentil soup', 'Falafel wrap', 'Stir-fry with garlic']);
      }
    }

    // ----- Mood -----
    const maxPain = Math.max(0, ...Object.values(sites));
    const moodBase = 6.8 - (premenstrual ? 1.4 : 0) - (earlyPeriod ? 0.8 : 0) - (quality <= 2 ? 1 : 0) -
      (maxPain >= 5 ? 0.8 : 0) + (weekend ? 0.4 : 0) - (ill(i) ? 1.2 : 0) - (deadline(i) ? 0.8 : 0);
    const moodLatent = 0.5 * moodPrev + 0.5 * moodBase + normal() * 0.7;
    moodPrev = moodLatent;
    v.mood = clamp(Math.round(moodLatent), 0, 10);
    v.anxiety = clamp(Math.round(2.5 + (premenstrual ? 1.3 : 0) + (stressLatent - 3.5) * 0.5 + normal() * 0.9), 0, 10);
    v.stress = clamp(Math.round(stressLatent + normal() * 0.6), 0, 10);
    v.energy = clamp(Math.round(6 + (quality - 3) * 0.8 - (ill(i) ? 2 : 0) - (earlyPeriod ? 1 : 0) + normal() * 0.8), 0, 10);
    v.irritability = clamp(Math.round(2 + (premenstrual ? 2 : 0) + (stressLatent - 3.5) * 0.4 + normal() * 0.9), 0, 10);
    history.push({ mood: v.mood, anxiety: v.anxiety, energy: v.energy, quality });

    // ----- General -----
    v.health_overall = clamp(Math.round(7.5 - (ill(i) ? 2.5 : 0) - (maxPain >= 5 ? 1.5 : maxPain > 0 ? 0.5 : 0) -
      (quality <= 2 ? 0.7 : 0) + normal() * 0.6), 0, 10);
    const meds = [];
    if (((sites.pelvis || 0) >= 5 || (sites.head || 0) >= 5) && chance(0.8)) meds.push('painkiller');
    if (i === REACTION_DAY) meds.push('antihistamine');
    v.meds = meds.length ? meds : ['none'];
    if (meds.length) {
      v.meds_detail = meds.map((m) => (m === 'painkiller' ? 'Ibuprofen 400 mg' : 'Cetirizine 10 mg')).join('; ');
    }
    v.unwell = ill(i);
    if (v.unwell) v.unwell_what = 'Cold';
    if (chance(0.08)) v.notes = pick(['Long day at work', 'Ran 5 km', 'Visited friends', 'Travel day', 'Slept badly, noisy street']);

    // ----- Questionnaires every ~2 weeks -----
    const periodicToday = i >= nextPeriodic;
    if (periodicToday) {
      nextPeriodic = i + 14 + (chance(0.3) ? 1 : 0);
      const recent = history.slice(-14);
      const mean = (key) => recent.reduce((sum, d) => sum + d[key], 0) / recent.length;
      const mood = mean('mood');
      const anxiety = mean('anxiety');
      const low = (6.5 - mood) * 0.5;
      for (let k = 1; k <= 8; k++) {
        const extra = k === 3 ? (3 - mean('quality')) * 0.5 : k === 4 ? (6 - mean('energy')) * 0.3 : 0;
        v[`phq9_${k}`] = clamp(Math.round(low + extra + normal() * 0.5), 0, 3);
      }
      v.phq9_9 = 0;
      v.phq9_difficulty = chance(0.7) ? 0 : 1;
      for (let k = 1; k <= 7; k++) v[`gad7_${k}`] = clamp(Math.round((anxiety - 2) * 0.45 + normal() * 0.5), 0, 3);
      v.gad7_difficulty = chance(0.7) ? 0 : 1;
      for (let k = 1; k <= 5; k++) v[`who5_${k}`] = clamp(Math.round(2.5 + (mood - 6) * 0.5 + normal() * 0.6), 0, 5);
    }

    // ----- Which packs were filled in, and when -----
    const compliance = weighted([['full', 87], ['skip', 7], ['light', 6]]);
    if (compliance === 'skip') continue;
    const dayPacks = packs.filter((p) => {
      if (p.schedule.everyDays > 1) return periodicToday && compliance === 'full';
      return compliance === 'full' || p.id === 'cycle' || p.id === 'mood';
    });
    if (!dayPacks.length) continue;

    let clockTime = chance(0.7) ? int(21 * 60, 22 * 60 + 59) : 24 * 60 + int(0, 90);   // evening, or just after midnight
    const editedNextMorning = chance(0.06) ? pick(dayPacks).id : null;
    const entry = { date, schema: 1, created_at: null, modified_at: null, config_sha: configSha, demo: true, answers: {} };
    answered.set(date, {});

    for (const pack of dayPacks) {
      const own = {};
      for (const q of pack.questions) {
        if (q.retired || !(q.id in v) || !validFor(q, v[q.id])) continue;
        if (compliance === 'light' && chance(0.15)) continue;            // a few questions left out
        let value = v[q.id];
        if (q.type === 'multi') {                                        // same order as the options
          const order = q.options.map((o) => o.value);
          value = [...value].sort((a, b) => order.indexOf(a) - order.indexOf(b));
        }
        own[q.id] = value;
      }
      const { visible } = packVisibility(pack, own, date, answersFor);
      const created = stamp(date, clockTime);
      const modified = editedNextMorning === pack.id ? stamp(date, 24 * 60 + int(8 * 60, 9 * 60 + 30)) : created;
      for (const q of pack.questions) {
        if (q.retired) continue;
        const status = !visible[q.id] ? 'skipped' : isAnswered(own[q.id]) ? 'answered' : 'unanswered';
        entry.answers[q.id] = {
          pack: pack.id, type: q.type, version: q.version,
          value: status === 'answered' ? own[q.id] : null, status,
          created_at: created, modified_at: modified
        };
        if (status === 'answered') answered.get(date)[q.id] = own[q.id];
      }
      clockTime += int(1, 3);
    }
    const stamps = Object.values(entry.answers).flatMap((a) => [a.created_at, a.modified_at]).sort();
    entry.created_at = stamps[0];
    entry.modified_at = stamps[stamps.length - 1];
    entries.push(entry);
  }
  return entries;

  function validFor(q, value) {
    switch (q.type) {
      case 'single': return q.options.some((o) => o.value === value);
      case 'multi': return Array.isArray(value) && value.every((x) => q.options.some((o) => o.value === x));
      case 'yesno': return typeof value === 'boolean';
      case 'scale': return typeof value === 'number' && value >= q.min && value <= q.max;
      case 'number': return typeof value === 'number';
      case 'time': return /^\d\d:\d\d$/.test(value);
      case 'text': return typeof value === 'string';
      default: return false;
    }
  }
}

// Minutes after midnight -> "HH:MM" (wraps past midnight).
function clock(minutes) {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

// Timestamp for a diary date + minutes after its midnight (may run into the next morning).
function stamp(date, minutes) {
  const [y, m, d] = date.split('-').map(Number);
  return nowLocalISO(new Date(y, m - 1, d, 0, Math.round(minutes), 0));
}

// Small seeded random number generator, so the demo looks the same every time it is rebuilt.
function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
