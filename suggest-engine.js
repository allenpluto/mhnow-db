/**
 * Armour set suggester.
 *
 *   node suggest-engine.js "Squawkscythe"
 *   node suggest-engine.js "Squawkscythe" --gems          assume ideal driftgems
 *   node suggest-engine.js "Squawkscythe" --atk 80 --ele 80 --aff 30   style customisation
 *   node suggest-engine.js "Squawkscythe" --lock TORSO=Vangis Coil     force a slot
 *   node suggest-engine.js "Squawkscythe" --top 8
 *
 * HOW IT SEARCHES
 * 76 x 71 x 71 x 73 x 72 is 2.01 billion sets, but damage depends on skill
 * TOTALS, never on which piece supplied them. Collapsing each slot to its
 * distinct skill bundles gives 24-28 per slot, and dropping bundles that
 * another bundle beats on every skill leaves 17-21. That is about 2.1 million
 * combinations — small enough to evaluate every one, so the result is the
 * optimum rather than a good guess.
 *
 * Pareto pruning assumes more of a skill is never worse. Critical Ferocity
 * breaks that (it REDUCES affinity), so it is excluded from the domination test
 * and its bundles always survive to be scored properly.
 *
 * WHAT IT CANNOT KNOW
 * Of the 126 skills that appear on armour, about 20 carry a number this can use
 * directly. The rest are conditional — uptime after a roar, health thresholds,
 * consecutive hits — so they are priced by the rules in RULES below, which are
 * assumptions, not data. Anything absent from RULES scores zero and is reported
 * as ignored, so a set is never recommended on the strength of a skill that was
 * silently guessed at.
 */

/*
 * Loads both in Node (require) and in the browser (<script>). The damage model
 * has had several subtle faults already — uniform gems, unobtainable gems, a
 * missing Raw Power — so the website runs this exact file rather than a second
 * copy of the same arithmetic.
 *
 * No file or network access here: callers supply the data.
 */

'use strict';

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SuggestEngine = factory();
}(typeof self !== 'undefined' ? self : this, function () {

// ---------------------------------------------------------------- assumptions
const ASSUME = {
  // 60% is the AVERAGE health over a hunt, not a constant. That distinction
  // matters: the Vital family scales with health continuously, so the average is
  // the right input for it, while the threshold skills either fire or do not.
  hpFraction: 0.60,
  baseHp: 100,             // before Health Boost
  // Valor fires once per hunt, on the first roar, and lasts the rest of it. 60%
  // therefore means the first roar lands 40% of the way in. That is the
  // pessimistic reading: a longer fight pushes the figure up, never down, so
  // this understates Valor rather than flattering it.
  valorUptime: 0.60,

  // Set by the user rather than measured — none of these can be read off
  // anything, and the earlier figures were my guesses. They were deliberately
  // lowered: a weak point is not always available, and a buff with a short
  // window is not up as often as it feels.
  weakPointUptime: 0.70,   // Weakness Exploit only applies on a weak point
  elementalReleaseUptime: 0.35,
  burstUptime: 0.35,
  offensiveGuardUptime: 0.00,   // zero unless you actually guard

  // Threshold skills. An average of 60% health means full health and sub-29%
  // health are both occasional, so these are weighted at a tenth of nominal
  // rather than being deleted or taken at face value.
  peakPerformanceUptime: 0.10,  // needs FULL health
  heroicsUptime: 0.10,          // needs health at 29% or lower

  // How long the fight lasts. Two skills key off the clock rather than off
  // anything you do, so this is a real input: a standard hunt is 75 seconds
  // (Latent Power's two stated conditions, 47 seconds of combat and the last
  // 28 seconds, are the same moment only if the hunt is 75), while a base
  // defence runs about 2.5 minutes.
  huntSeconds: 75,

  // Latent Power starts at roughly 47 seconds of combat and holds to the end,
  // so its uptime follows from the hunt length rather than being guessed.
  // Attacking hard brings it forward, so this is a floor.
  latentPowerStart: 47,
};

// Worth as a fraction of the set's damage, for skills damage cannot price.
// These are the user's own exchange rates — Power Prolonger and Quick Work at
// 15% for their max level, Lock On a flat 10% — not anything derived from data.
const UTILITY = {
  'Power Prolonger': { 1: 0.05, 2: 0.10, 3: 0.15 },
  'Quick Work': { 1: 0.05, 2: 0.10, 3: 0.15 },
  'Lock On': { 1: 0.10 },

  // Rude Awakener multiplies the FIRST attack on a sleeping monster by 1.3,
  // 1.6 or 2.0, on top of the 2.0 that waking a monster already gives — so up
  // to 4.0 on one hit. Averaging a single hit across a whole hunt would be
  // dishonest arithmetic, so it is scored as utility instead.
  //
  // THE RATE BELOW IS A GUESS. The multipliers are measured; what one boosted
  // hit is worth as a fraction of a hunt's damage is not.
  'Rude Awakener': { 1: 0.05, 2: 0.10, 3: 0.15 },
};

// Utility skills that only apply to a weapon of a given element. Rude Awakener
// does nothing without a monster to put to sleep.
const UTILITY_ELEMENT = {
  'Rude Awakener': ['Sleep'],
};
// Which weapons each utility skill is worth anything on.
const UTILITY_SCOPE = {
  // The game's own text names seven types for Power Prolonger. You listed four;
  // the other three are here at the same weight pending your call.
  'Power Prolonger': ['Dual Blades', 'Long Sword', 'Switch Axe', 'Charge Blade',
    'Hunting Horn', 'Gunlance', 'Insect Glaive'],
  // "sheathing or transforming" — Long Sword is your priority, the transforming
  // weapons are included at the same weight pending your call.
  'Quick Work': ['Long Sword', 'Switch Axe', 'Charge Blade'],
  // The skill text itself says "close-range weapon", so this is data, not taste.
  'Lock On': ['Great Sword', 'Long Sword', 'Sword & Shield', 'Dual Blades', 'Hammer',
    'Hunting Horn', 'Lance', 'Gunlance', 'Switch Axe', 'Charge Blade', 'Insect Glaive'],
};

const ELEMENTS = ['Fire', 'Water', 'Thunder', 'Ice', 'Dragon'];
const STATUS = ['Blast', 'Poison', 'Paralysis', 'Sleep'];

// Skills that feed the damage model. Everything else scores zero.
const CEYE = { 1: 10, 2: 15, 3: 20, 4: 30, 5: 40 };
const WEX = { 1: 20, 2: 25, 3: 30, 4: 40, 5: 50 };
const CBOOST = { 0: 1.25, 1: 1.30, 2: 1.35, 3: 1.40, 4: 1.45, 5: 1.50 };
const CELEM = { 0: 1.00, 1: 1.30, 2: 1.40, 3: 1.50, 4: 1.60, 5: 1.80 };
const ATTACK_BOOST = { 1: 50, 2: 100, 3: 150, 4: 200, 5: 300 };
const ADV_ATTACK = { 1: 150, 2: 350 };
const ELEM_ATTACK = { 1: 50, 2: 100, 3: 200, 4: 350, 5: 500 };
const ADV_ELEM = { 1: 200, 2: 400 };
const VITAL = { 1: 2, 2: 4, 3: 8 };
const HEALTH = { 1: 10, 2: 20, 3: 30, 4: 40, 5: 50 };
const VALOR = { 1: 400, 2: 550, 3: 700, 4: 850, 5: 1000 };
const PEAK = { 1: 100, 2: 200, 3: 300, 4: 400, 5: 500 };
const CFERO_AFF = { 1: 10, 2: 15, 3: 20, 4: 25, 5: 30 };
const CFERO_MULT = { 1: 1.50, 2: 1.75, 3: 2.00, 4: 2.25, 5: 2.50 };
const ELEM_RELEASE = { 1: 0.20, 2: 0.40, 3: 0.60, 4: 0.80, 5: 1.00 };
const BURST = { 1: 0.05, 2: 0.10, 3: 0.15, 4: 0.20, 5: 0.30 };
const ADV_BURST = { 1: 0.05, 2: 0.10 };
const LATENT = { 1: 20, 2: 30, 3: 40, 4: 50, 5: 60 };
const OFF_GUARD = { 1: 0.10, 2: 0.15, 3: 0.20, 4: 0.30, 5: 0.40 };
const HEROICS = { 1: 0.10, 2: 0.20, 3: 0.30, 4: 0.40, 5: 0.50 };

// Rising Tide ramps on the clock: measured at +30 attack from 25 seconds and
// another +30 from 50, per level. Averaging both stages over the hunt gives the
// attack it is worth across the whole fight, which is why a long base defence
// is where it earns its place.
const TIDE_PER_LEVEL = 30;
const TIDE_STAGES = [25, 50];
function tideAttack(level, huntSeconds) {
  if (!level) return 0;
  var total = 0;
  for (var i = 0; i < TIDE_STAGES.length; i++) {
    var active = huntSeconds - TIDE_STAGES[i];
    if (active > 0) total += TIDE_PER_LEVEL * level * (active / huntSeconds);
  }
  return total;
}

// Latent Power's share of the hunt, from when it starts to the end.
function latentUptime() {
  var up = (ASSUME.huntSeconds - ASSUME.latentPowerStart) / ASSUME.huntSeconds;
  return up < 0 ? 0 : up > 1 ? 1 : up;
}
// Raw Power: flat attack bought with affinity.
const RAW_ATK = { 1: 100, 2: 200, 3: 300, 4: 400, 5: 500 };
const RAW_AFF = { 1: 5, 2: 10, 3: 15, 4: 20, 5: 30 };

/** Every skill this engine understands, so the rest can be reported as ignored. */
/**
 * The skills worth considering for ONE weapon.
 *
 * Keeping this tight is not just tidiness: every skill dropped makes more
 * armour pieces collapse into the same bundle, which shrinks the search.
 *
 *   * Resistances and the other defensive skills never enter — they do not
 *     touch damage.
 *   * Only the weapon's OWN element is included. Dragon Attack is worthless on
 *     an ice weapon, so it is not a dimension worth searching.
 *   * A status weapon (Blast/Poison/Paralysis/Sleep) or a no-element weapon has
 *     no damaging element at all, so Critical Element, Elemental Release and the
 *     Vital family are dropped with it. They would otherwise be searched and
 *     scored at zero on every single candidate.
 *   * Lock On is close-range only, by its own description, so it is dropped
 *     entirely for bow and bowguns rather than carried at zero weight.
 */
function knownSkills(weapon) {
  const s = new Set(['Attack Boost', 'Advanced Attack Boost', 'Critical Eye', 'Weakness Exploit',
    'Critical Boost', 'Critical Ferocity', 'Valor', 'Peak Performance', 'Burst',
    'Advanced Burst', 'Latent Power', 'Offensive Guard', 'Heroics',
    // Trades affinity for flat attack, which makes it a real option on a
    // negative-affinity weapon and a partner for Critical Ferocity. Omitting it
    // meant the optimiser scored it zero and never considered that build.
    'Raw Power',
    // Ramps on the clock, so it is worth most on a long base defence.
    'Rising Tide']);

  Object.keys(UTILITY).forEach((k) => {
    const scope = UTILITY_SCOPE[k];
    if (scope && scope.indexOf(weapon.category) < 0) return;
    const el = UTILITY_ELEMENT[k];
    if (el && el.indexOf(weapon.element) < 0) return;
    s.add(k);
  });

  if (ELEMENTS.indexOf(weapon.element) >= 0) {
    s.add(weapon.element + ' Attack');
    s.add('Advanced ' + weapon.element + ' Attack');
    s.add('Vital ' + weapon.element);
    s.add('Critical Element');
    s.add('Elemental Release');
    s.add('Health Boost');          // only matters through Vital
  }
  return s;
}

/** Roll a set's skill totals into one damage figure. */
function score(totals, w) {
  const lv = (n) => totals[n] || 0;
  const elemental = ELEMENTS.indexOf(w.element) >= 0;

  let atk = w.atk;
  let ele = elemental ? w.ele : 0;        // status buildup is not damage
  let aff = w.aff;

  atk += ATTACK_BOOST[lv('Attack Boost')] || 0;
  if (lv('Attack Boost') >= 5) atk += ADV_ATTACK[lv('Advanced Attack Boost')] || 0;
  atk += RAW_ATK[lv('Raw Power')] || 0;
  atk += tideAttack(lv('Rising Tide'), ASSUME.huntSeconds);
  atk += (VALOR[lv('Valor')] || 0) * ASSUME.valorUptime;
  atk += (PEAK[lv('Peak Performance')] || 0) * ASSUME.peakPerformanceUptime;

  if (elemental) {
    ele += ELEM_ATTACK[lv(w.element + ' Attack')] || 0;
    if (lv(w.element + ' Attack') >= 5) ele += ADV_ELEM[lv('Advanced ' + w.element + ' Attack')] || 0;
    const hp = (ASSUME.baseHp + (HEALTH[lv('Health Boost')] || 0)) * ASSUME.hpFraction;
    ele += (VITAL[lv('Vital ' + w.element)] || 0) * hp;
    ele *= 1 + (ELEM_RELEASE[lv('Elemental Release')] || 0) * ASSUME.elementalReleaseUptime;
  }

  aff += (CEYE[lv('Critical Eye')] || 0);
  aff += (WEX[lv('Weakness Exploit')] || 0) * ASSUME.weakPointUptime;
  aff += (LATENT[lv('Latent Power')] || 0) * latentUptime();
  aff -= (CFERO_AFF[lv('Critical Ferocity')] || 0);
  aff -= (RAW_AFF[lv('Raw Power')] || 0);

  const c = Math.max(-100, Math.min(100, aff)) / 100;
  const m = CBOOST[Math.min(5, lv('Critical Boost'))];
  const ce = CELEM[Math.min(5, lv('Critical Element'))];

  let dmg;
  if (c >= 0) {
    dmg = atk * (1 + c * (m - 1)) + ele * (c * m * ce + (1 - c));
  } else {
    // Negative final affinity: those hits land at 75%, or at the Critical
    // Ferocity multiplier on the 30% of them that proc it.
    const n = Math.abs(c);
    const cf = lv('Critical Ferocity');
    const neg = cf ? 0.30 * CFERO_MULT[cf] + 0.70 * 0.75 : 0.75;
    dmg = (atk + ele) * ((1 - n) + n * neg);
  }

  // Flat attack multipliers that apply to the whole hit.
  dmg *= 1 + (BURST[lv('Burst')] || 0) * ASSUME.burstUptime;
  if (lv('Burst') >= 5) dmg *= 1 + (ADV_BURST[lv('Advanced Burst')] || 0) * ASSUME.burstUptime;
  dmg *= 1 + (OFF_GUARD[lv('Offensive Guard')] || 0) * ASSUME.offensiveGuardUptime;
  dmg *= 1 + (HEROICS[lv('Heroics')] || 0) * ASSUME.heroicsUptime;

  // Utility, priced as a fraction of damage.
  let util = 0;
  Object.keys(UTILITY).forEach((n) => {
    if (!lv(n)) return;
    const scope = UTILITY_SCOPE[n];
    if (scope && scope.indexOf(w.category) < 0) return;
    const el = UTILITY_ELEMENT[n];
    if (el && el.indexOf(w.element) < 0) return;
    util += UTILITY[n][Math.min(lv(n), 3)] || 0;
  });

  return { dmg: dmg, util: util, total: dmg * (1 + util) };
}

/**
 * The same calculation returning only the number.
 *
 * The search evaluates a few tens of millions of candidates, and allocating a
 * result object for each one exhausted the heap. Reporting calls score() for
 * the handful of finalists instead.
 */
function scoreTotal(totals, w) {
  const s = score(totals, w);
  return s.total;
}

/**
 * A scorer bound to one weapon and one fixed skill ordering.
 *
 * The search evaluates millions of candidates, and the object-keyed score()
 * rebuilds a name-keyed map for every one of them. This resolves each skill to
 * an array index once, so the hot loop reads integers out of a typed array and
 * allocates nothing.
 *
 * Returns { names, scoreVec } where scoreVec takes an Int16Array of levels in
 * `names` order.
 */
function makeScorer(w, damageOnly) {
  const names = Array.from(knownSkills(w)).sort();
  const at = {};
  names.forEach((n, i) => { at[n] = i; });
  const I = (n) => (at[n] === undefined ? -1 : at[n]);

  const elemental = ELEMENTS.indexOf(w.element) >= 0;
  const iAB = I('Attack Boost'), iAAB = I('Advanced Attack Boost');
  const iValor = I('Valor'), iPeak = I('Peak Performance'), iHero = I('Heroics');
  const iEA = elemental ? I(w.element + ' Attack') : -1;
  const iAEA = elemental ? I('Advanced ' + w.element + ' Attack') : -1;
  const iVital = elemental ? I('Vital ' + w.element) : -1;
  const iHealth = I('Health Boost'), iER = I('Elemental Release');
  const iCEye = I('Critical Eye'), iWEx = I('Weakness Exploit'), iLat = I('Latent Power');
  const iCF = I('Critical Ferocity'), iCB = I('Critical Boost'), iCE = I('Critical Element');
  const iBurst = I('Burst'), iAB2 = I('Advanced Burst'), iOG = I('Offensive Guard');
  const iRaw = I('Raw Power'), iTide = I('Rising Tide');

  // Utility skills that apply to this weapon, resolved up front.
  const util = [];
  Object.keys(UTILITY).forEach((n) => {
    const scope = UTILITY_SCOPE[n];
    if (scope && scope.indexOf(w.category) < 0) return;
    const el = UTILITY_ELEMENT[n];
    if (el && el.indexOf(w.element) < 0) return;
    if (I(n) < 0) return;
    util.push({ i: I(n), table: UTILITY[n] });
  });

  const g = (v, i) => (i < 0 ? 0 : v[i]);

  function scoreVec(v) {
    let atk = w.atk;
    let ele = elemental ? w.ele : 0;
    let aff = w.aff;

    atk += ATTACK_BOOST[g(v, iAB)] || 0;
    if (g(v, iAB) >= 5) atk += ADV_ATTACK[g(v, iAAB)] || 0;
    atk += RAW_ATK[g(v, iRaw)] || 0;
    atk += tideAttack(g(v, iTide), ASSUME.huntSeconds);
    atk += (VALOR[g(v, iValor)] || 0) * ASSUME.valorUptime;
    atk += (PEAK[g(v, iPeak)] || 0) * ASSUME.peakPerformanceUptime;

    if (elemental) {
      ele += ELEM_ATTACK[g(v, iEA)] || 0;
      if (g(v, iEA) >= 5) ele += ADV_ELEM[g(v, iAEA)] || 0;
      const hp = (ASSUME.baseHp + (HEALTH[g(v, iHealth)] || 0)) * ASSUME.hpFraction;
      ele += (VITAL[g(v, iVital)] || 0) * hp;
      ele *= 1 + (ELEM_RELEASE[g(v, iER)] || 0) * ASSUME.elementalReleaseUptime;
    }

    aff += CEYE[g(v, iCEye)] || 0;
    aff += (WEX[g(v, iWEx)] || 0) * ASSUME.weakPointUptime;
    aff += (LATENT[g(v, iLat)] || 0) * latentUptime();
    aff -= CFERO_AFF[g(v, iCF)] || 0;
    aff -= RAW_AFF[g(v, iRaw)] || 0;

    const c = (aff > 100 ? 100 : aff < -100 ? -100 : aff) / 100;
    const m = CBOOST[Math.min(5, g(v, iCB))];
    const ce = CELEM[Math.min(5, g(v, iCE))];

    let dmg;
    if (c >= 0) {
      dmg = atk * (1 + c * (m - 1)) + ele * (c * m * ce + (1 - c));
    } else {
      const n = -c;
      const cf = g(v, iCF);
      const neg = cf ? 0.30 * CFERO_MULT[cf] + 0.70 * 0.75 : 0.75;
      dmg = (atk + ele) * ((1 - n) + n * neg);
    }

    dmg *= 1 + (BURST[g(v, iBurst)] || 0) * ASSUME.burstUptime;
    if (g(v, iBurst) >= 5) dmg *= 1 + (ADV_BURST[g(v, iAB2)] || 0) * ASSUME.burstUptime;
    dmg *= 1 + (OFF_GUARD[g(v, iOG)] || 0) * ASSUME.offensiveGuardUptime;
    dmg *= 1 + (HEROICS[g(v, iHero)] || 0) * ASSUME.heroicsUptime;

    if (damageOnly) return dmg;
    let u = 0;
    for (let k = 0; k < util.length; k++) {
      const lvl = v[util[k].i];
      if (lvl) u += util[k].table[lvl > 3 ? 3 : lvl] || 0;
    }
    return dmg * (1 + u);
  }

  return { names: names, at: at, scoreVec: scoreVec };
}

return { ASSUME: ASSUME, UTILITY: UTILITY, UTILITY_SCOPE: UTILITY_SCOPE,
  score: score, scoreTotal: scoreTotal, makeScorer: makeScorer,
  knownSkills: knownSkills, ELEMENTS: ELEMENTS, STATUS: STATUS };
}));
