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

// --skills scores one explicit build instead of searching, so the engine can be
// checked against a figure worked out independently.
//   --skills "Critical Element 5, Critical Eye 2, Weakness Exploit 2, Dragon Attack 2, Advanced Dragon Attack 1"
const explicit = val('--skills', null);
if (explicit) {
  const totals = {};
  explicit.split(',').forEach((part) => {
    const m = part.trim().match(/^(.*?)\s+(\d+)$/);
    if (!m) { console.error('cannot read "' + part.trim() + '"'); process.exit(2); }
    totals[m[1].trim()] = Number(m[2]);
  });
  const unknown = Object.keys(totals).filter((n) => !E.knownSkills(W).has(n));
  const s = E.score(totals, W);
  console.log('\n  ' + Object.keys(totals).map((n) => n + ' ' + totals[n]).join(', '));
  console.log('  damage ' + s.dmg.toFixed(1) +
    (s.util ? '   utility x' + (1 + s.util).toFixed(2) + ' -> ' + s.total.toFixed(1) : ''));
  if (unknown.length) console.log('  NOT PRICED (scored as zero): ' + unknown.join(', '));
  process.exit(0);
}

// ---------------------------------------------------------------- bundles
const known = E.knownSkills(W);
const relevant = (sk) => {
  const o = {};
  Object.keys(sk || {}).forEach((n) => { if (known.has(n)) o[n] = sk[n]; });
  return o;
};
// Critical Ferocity lowers affinity, so "more is better" does not hold for it
// and it must never be pruned away.
// Raw Power buys attack with affinity, so like Critical Ferocity it can be
// actively harmful and "more is better" does not hold for it either.
const NON_MONOTONIC = new Set(['Critical Ferocity', 'Raw Power']);

// Driftstone skills you already have, named per piece:
//   --own "Barioth Vambraces=Ice Attack, Lunagaron Mail=Ice Attack"
// These are added to the piece BEFORE pieces are grouped, because two pieces
// with the same printed skills are no longer interchangeable once one of them
// carries a gem the other does not.
const OWN = {};
(val('--own', '') || '').split(',').map((s) => s.trim()).filter(Boolean).forEach((part) => {
  const m = part.match(/^(.*?)=(.*?)(?:\s+(\d+))?$/);
  if (!m) { console.error('cannot read --own entry "' + part + '"'); process.exit(2); }
  const piece = m[1].trim(), skill = m[2].trim(), lv = Number(m[3] || 1);
  OWN[piece] = OWN[piece] || {};
  OWN[piece][skill] = (OWN[piece][skill] || 0) + lv;
});
if (Object.keys(OWN).length) {
  console.log('  your driftstone skills:');
  Object.keys(OWN).forEach((p) => {
    const known = d.armor.some((a) => a.name === p);
    console.log('     ' + p.padEnd(22) + Object.keys(OWN[p]).map((s) => s + ' ' + OWN[p][s]).join(', ') +
      (known ? '' : '   <-- NO SUCH PIECE, ignored'));
  });
}

const bundles = {};
SLOTS.forEach((slot) => {
  const seen = {};
  d.armor.filter((a) => a.slot === slot).forEach((a) => {
    const base = Object.assign({}, pieceSkills[a.id]);
    if (OWN[a.name]) {
      Object.keys(OWN[a.name]).forEach((s) => { base[s] = (base[s] || 0) + OWN[a.name][s]; });
    }
    const v = relevant(base);
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

// Skill levels live in one Int16Array indexed by the scorer's ordering. The
// nested loops add a slot's levels on the way in and take them off on the way
// out, so nothing is rebuilt or allocated per combination.
const SC = E.makeScorer(W, DAMAGE_ONLY);
const NS = SC.names.length;
const totals = new Int16Array(NS);

SLOTS.forEach((slot) => {
  bundles[slot].forEach((b) => {
    b.idx = [];
    Object.keys(b.v).forEach((n) => {
      if (SC.at[n] !== undefined) b.idx.push([SC.at[n], b.v[n]]);
    });
  });
});
const addB = (b, sign) => { for (let i = 0; i < b.idx.length; i++) totals[b.idx[i][0]] += sign * b.idx[i][1]; };

// Driftgems: each slot is independent, so five slots can hold five DIFFERENT
// skills. An earlier version applied one skill to every slot, which could not
// express "4 x Dragon Attack + 1 x Critical Eye" — a build this tool had itself
// recommended. Allocation is greedy: take the single gem with the best marginal
// gain, repeat for each slot. Greedy is exact whenever the gains are diminishing
// and in practice finds the threshold plays (reaching Lv5 to switch on an
// Advanced skill) because that step shows the largest gain of all.
//
// Only skills a driftgem can actually grant are candidates. An earlier version
// offered any skill the scorer knew, and duly recommended three Critical Element
// gems — a skill no driftstone grants at all. The DB has the real list, so it is
// read rather than assumed.
const GEMMABLE = new Set();
d.driftstoneSkills.forEach((x) => { GEMMABLE.add(skillById[x.skill_id].name); });
const gemIdx = GEMS
  ? SC.names.filter((n) => !E.UTILITY[n] && GEMMABLE.has(n)).map((n) => SC.at[n])
  : [];
if (GEMS) {
  console.log('  gem candidates: ' + gemIdx.map((i) => SC.names[i]).join(', '));
  const refused = SC.names.filter((n) => !E.UTILITY[n] && !GEMMABLE.has(n));
  if (refused.length) console.log('  no driftgem exists for: ' + refused.join(', '));
}

function allocateGems(slots) {
  if (!slots || !gemIdx.length) return null;
  const taken = [];
  for (let s = 0; s < slots; s++) {
    let bestI = -1, bestV = -Infinity;
    for (let k = 0; k < gemIdx.length; k++) {
      const i = gemIdx[k];
      if (totals[i] >= 5) continue;        // a level above the cap buys nothing
      totals[i]++;
      const v = SC.scoreVec(totals);
      totals[i]--;
      if (v > bestV) { bestV = v; bestI = i; }
    }
    if (bestI < 0) break;
    totals[bestI]++;
    taken.push(bestI);
  }
  const score = SC.scoreVec(totals);
  taken.forEach((i) => { totals[i]--; });
  return { score: score, taken: taken };
}

for (const h of H) {
  addB(h, 1);
  for (const c of C) {
    addB(c, 1);
    for (const a of A) {
      addB(a, 1);
      for (const t of T) {
        addB(t, 1);
        for (const l of L) {
          addB(l, 1);
          const slots = h.slots + c.slots + a.slots + t.slots + l.slots;
          let sc, gems = null;
          if (GEMS) {
            const g = allocateGems(slots);
            sc = g ? g.score : SC.scoreVec(totals);
            gems = g ? g.taken : null;
          } else {
            sc = SC.scoreVec(totals);
          }
          if (results.length < TOP || sc > worst) {
            offer({ score: sc, picks: [h, c, a, t, l], slots: slots, gems: gems });
          }
          addB(l, -1);
        }
        addB(t, -1);
      }
      addB(a, -1);
    }
    addB(c, -1);
  }
  addB(h, -1);
}

// Re-derive the breakdown for the finalists only.
results.forEach((r) => {
  const tot = {};
  r.picks.forEach((b) => { Object.keys(b.v).forEach((n) => { tot[n] = (tot[n] || 0) + b.v[n]; }); });
  if (r.gems) {
    const count = {};
    r.gems.forEach((i) => { count[SC.names[i]] = (count[SC.names[i]] || 0) + 1; });
    r.gemText = Object.keys(count).map((n) => count[n] + ' x ' + n).join(', ');
    Object.keys(count).forEach((n) => { tot[n] = (tot[n] || 0) + count[n]; });
  }
  r.totals = tot;
  r.s = E.score(tot, W);
});

// ---------------------------------------------------------------- report
console.log('\nBest ' + TOP + ' sets:');
results.slice(0, TOP).forEach((r, i) => {
  // In damage-only mode the ranking ignores utility, so the printed score must
  // too — showing the utility-inclusive total made a lower-ranked set look
  // higher than the winner.
  console.log('\n  #' + (i + 1) + '  ' + (DAMAGE_ONLY
    ? 'damage ' + r.s.dmg.toFixed(0) +
      (r.s.util ? '   (utility ignored; it would add x' + (1 + r.s.util).toFixed(2) + ')' : '')
    : 'score ' + r.s.total.toFixed(0) + '   (damage ' + r.s.dmg.toFixed(0) +
      (r.s.util ? ' x ' + (1 + r.s.util).toFixed(2) + ' utility' : '') + ')'));
  SLOTS.forEach((slot, j) => {
    const b = r.picks[j];
    const names = b.pieces.map((p) => p.name);
    const shown = names.slice(0, 2).join(' / ') + (names.length > 2 ? ' (+' + (names.length - 2) + ' equivalent)' : '');
    console.log('     ' + SLOT_LABEL[slot].padEnd(6) + shown.padEnd(44) +
      Object.keys(b.v).map((n) => n + ' ' + b.v[n]).join(', '));
  });
  if (r.gemText) console.log('     gems   ' + r.gemText + '   (' + r.slots + ' slot(s))');
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
