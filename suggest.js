/**
 * Exact armour-set search. See suggest-engine.js for the scoring and its
 * assumptions; this file does the enumeration and the reporting.
 */

'use strict';

const E = require('./suggest-engine.js');
const d = E.d;

const SLOTS = ['HEAD', 'CHEST', 'ARMS', 'TORSO', 'LEGS'];
const SLOT_LABEL = { HEAD: 'Head', CHEST: 'Chest', ARMS: 'Arms', TORSO: 'Waist', LEGS: 'Legs' };

// ---------------------------------------------------------------- index data
const skillById = {}; d.skills.forEach((s) => { skillById[s.id] = s; });
const seriesById = {}; d.series.forEach((s) => { seriesById[s.id] = s.name; });
const armorById = {}; d.armor.forEach((a) => { armorById[a.id] = a; });
const maxGrade = {};
d.grades.forEach((g) => { const a = armorById[g.armor_id]; if (a && g.grade === a.max_grade) maxGrade[g.id] = a; });
const pieceSkills = {}, pieceSlots = {};
d.grades.forEach((g) => { if (maxGrade[g.id]) pieceSlots[g.armor_id] = g.driftsmelt_slots; });
d.gradeSkills.forEach((gs) => {
  const a = maxGrade[gs.armor_grade_id]; if (!a) return;
  (pieceSkills[a.id] = pieceSkills[a.id] || {})[skillById[gs.skill_id].name] = gs.level;
});

// ---------------------------------------------------------------- arguments
const argv = process.argv.slice(2);
const flag = (n) => argv.indexOf(n) > -1;
const val = (n, dflt) => { const i = argv.indexOf(n); return i > -1 ? argv[i + 1] : dflt; };
const name = argv.filter((a) => a.charAt(0) !== '-' && argv[argv.indexOf(a) - 1] !== '--top' &&
  argv[argv.indexOf(a) - 1] !== '--atk' && argv[argv.indexOf(a) - 1] !== '--ele' &&
  argv[argv.indexOf(a) - 1] !== '--aff' && argv[argv.indexOf(a) - 1] !== '--lock')[0];

if (!name) {
  console.error('usage: node suggest.js "Weapon Name" [--gems] [--atk N --ele N --aff N] [--top N]');
  process.exit(2);
}

// ---------------------------------------------------------------- the weapon
const g10 = {};
d.weaponGrades.forEach((x) => { g10[x.weapon_id + '|' + x.grade] = x; });
const lvl = {};
d.weaponLevels.forEach((l) => { (lvl[l.weapon_grade_id] = lvl[l.weapon_grade_id] || {})[l.level] = l; });

const wRow = d.weapons.filter((x) => x.name.toLowerCase() === name.toLowerCase())[0];
if (!wRow) { console.error('no weapon called "' + name + '"'); process.exit(2); }
const gr = g10[wRow.id + '|' + wRow.max_grade];
const st = lvl[gr.id] && lvl[gr.id][5];
if (!st) { console.error(name + ' has no 10-5 stats'); process.exit(2); }

const W = {
  name: wRow.name,
  category: wRow.category_label,
  element: wRow.element_label,
  atk: st.attack + Number(val('--atk', 0)),
  ele: st.element_attack + Number(val('--ele', 0)),
  aff: st.affinity + Number(val('--aff', 0)),
};
const isStatus = E.STATUS.indexOf(W.element) >= 0;

console.log(W.name + '  ' + W.category + '  ' + W.element);
console.log('  attack ' + W.atk + '   ' + (isStatus ? 'buildup ' : 'element ') + W.ele +
  (isStatus ? ' (status: excluded from damage)' : '') + '   affinity ' + W.aff + '%');
const GEMS = flag('--gems');
console.log('  driftsmelt: ' + (GEMS ? 'assumed to hold the set\'s most useful skill' : 'ignored'));

// ---------------------------------------------------------------- bundles
const known = E.knownSkills(W);
const relevant = (sk) => {
  const o = {};
  Object.keys(sk || {}).forEach((n) => { if (known.has(n)) o[n] = sk[n]; });
  return o;
};
// Critical Ferocity lowers affinity, so "more is better" does not hold for it
// and it must never be pruned away.
const NON_MONOTONIC = new Set(['Critical Ferocity']);

const bundles = {};
SLOTS.forEach((slot) => {
  const seen = {};
  d.armor.filter((a) => a.slot === slot).forEach((a) => {
    const v = relevant(pieceSkills[a.id]);
    const k = Object.keys(v).sort().map((n) => n + v[n]).join(',');
    if (!seen[k]) seen[k] = { v: v, slots: pieceSlots[a.id] || 0, pieces: [] };
    seen[k].pieces.push(a);
    seen[k].slots = Math.max(seen[k].slots, pieceSlots[a.id] || 0);
  });
  let list = Object.keys(seen).map((k) => seen[k]);
  const dominated = (x, y) => {
    if (Object.keys(x.v).some((n) => NON_MONOTONIC.has(n))) return false;
    if (Object.keys(y.v).some((n) => NON_MONOTONIC.has(n))) return false;
    if (y.slots < x.slots) return false;
    const keys = new Set(Object.keys(x.v).concat(Object.keys(y.v)));
    let strict = y.slots > x.slots;
    for (const n of keys) {
      const a = x.v[n] || 0, b = y.v[n] || 0;
      if (a > b) return false;
      if (b > a) strict = true;
    }
    return strict;
  };
  bundles[slot] = list.filter((x) => !list.some((y) => y !== x && dominated(x, y)));
});
console.log('  search space: ' + SLOTS.map((s) => bundles[s].length).join(' x ') + ' = ' +
  SLOTS.reduce((n, s) => n * bundles[s].length, 1).toLocaleString() + ' sets');

// ---------------------------------------------------------------- search
const TOP = Number(val('--top', 5));
// The utility weights are assumptions, and on a close field they decide the
// winner rather than merely colouring it. --damage-only ranks on damage alone so
// the two views can be compared and the cost of a utility skill made explicit.
const DAMAGE_ONLY = flag('--damage-only');
if (DAMAGE_ONLY) console.log('  ranking: damage only, utility weights ignored');
const H = bundles.HEAD, C = bundles.CHEST, A = bundles.ARMS, T = bundles.TORSO, L = bundles.LEGS;

// Keep only the leaders. Collecting all 2.1 million results (times a gem choice
// each) exhausted the heap, and nothing downstream needs the also-rans.
const results = [];
let worst = -Infinity;
function offer(rec) {
  if (results.length >= TOP && rec.score <= worst) return;
  results.push(rec);
  results.sort((x, y) => y.score - x.score);
  if (results.length > TOP) results.length = TOP;
  worst = results[results.length - 1].score;
}

// With --gems, every driftsmelt slot is assumed to carry one level of whichever
// known skill helps this set most. Tried one skill at a time rather than mixed,
// which is the honest reading of "suitable skills" and keeps the search exact.
const gemCandidates = GEMS
  ? Array.from(known).filter((n) => !E.UTILITY[n])
  : [null];

for (const h of H) for (const c of C) for (const a of A) for (const t of T) for (const l of L) {
  const picks = [h, c, a, t, l];
  const totals = {};
  let slots = 0;
  for (let i = 0; i < 5; i++) {
    const p = picks[i];
    slots += p.slots;
    for (const n in p.v) totals[n] = (totals[n] || 0) + p.v[n];
  }
  let bestScore = -Infinity, bestGem = null;
  for (const gem of gemCandidates) {
    let before;
    if (gem && slots) { before = totals[gem] || 0; totals[gem] = before + slots; }
    const v = DAMAGE_ONLY ? E.score(totals, W).dmg : E.scoreTotal(totals, W);
    if (gem && slots) { if (before) totals[gem] = before; else delete totals[gem]; }
    if (v > bestScore) { bestScore = v; bestGem = gem; }
  }
  offer({ score: bestScore, picks: picks.slice(), slots: slots, gem: bestGem, totals: totals });
}

// Re-derive the breakdown for the finalists only.
results.forEach((r) => {
  if (r.gem && r.slots) r.totals[r.gem] = (r.totals[r.gem] || 0) + r.slots;
  r.s = E.score(r.totals, W);
});

// ---------------------------------------------------------------- report
console.log('\nBest ' + TOP + ' sets:');
results.slice(0, TOP).forEach((r, i) => {
  console.log('\n  #' + (i + 1) + '  score ' + r.s.total.toFixed(0) +
    '   (damage ' + r.s.dmg.toFixed(0) + (r.s.util ? ' x ' + (1 + r.s.util).toFixed(2) + ' utility' : '') + ')');
  SLOTS.forEach((slot, j) => {
    const b = r.picks[j];
    const names = b.pieces.map((p) => p.name);
    const shown = names.slice(0, 2).join(' / ') + (names.length > 2 ? ' (+' + (names.length - 2) + ' equivalent)' : '');
    console.log('     ' + SLOT_LABEL[slot].padEnd(6) + shown.padEnd(44) +
      Object.keys(b.v).map((n) => n + ' ' + b.v[n]).join(', '));
  });
  if (r.gem) console.log('     gems   ' + r.slots + ' x ' + r.gem);
  console.log('     totals ' + Object.keys(r.totals).sort().map((n) => n + ' ' + r.totals[n]).join(', '));
});

// Anything on the chosen set that the engine could not price.
const top = results[0];
const ignored = {};
top.picks.forEach((b) => {
  b.pieces.slice(0, 1).forEach((p) => {
    Object.keys(pieceSkills[p.id] || {}).forEach((n) => { if (!known.has(n)) ignored[n] = true; });
  });
});
if (Object.keys(ignored).length) {
  console.log('\n  Skills on the winning set that this engine does not price: ' +
    Object.keys(ignored).sort().join(', '));
}
