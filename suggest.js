/**
 * Armour set suggester, command line.
 *
 *   node suggest.js "Bloom Snow Wail+"
 *   node suggest.js "Squawkscythe" --atk 80 --ele 80 --aff 30 --damage-only
 *   node suggest.js "Squawkscythe" --gems
 *   node suggest.js "Bloom Snow Wail+" --own "Barioth Vambraces=Ice Attack"
 *   node suggest.js "Squawkscythe" --skills "Dragon Attack 5, Critical Element 4"
 *
 * The scoring lives in suggest-engine.js and the search in suggest-search.js,
 * both of which the website loads too — this file only reads data.json, parses
 * arguments and prints.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const E = require('./suggest-engine.js');
const S = require('./suggest-search.js');

const HERE = __dirname;
const d = JSON.parse(fs.readFileSync(path.join(HERE, 'data.json'), 'utf8'));

const SLOT_LABEL = { HEAD: 'Head', CHEST: 'Chest', ARMS: 'Arms', TORSO: 'Waist', LEGS: 'Legs' };

// ---------------------------------------------------------------- shape data
const skillById = {}; d.skills.forEach((s) => { skillById[s.id] = s; });
const seriesById = {}; d.series.forEach((s) => { seriesById[s.id] = s.name; });
const armorById = {}; d.armor.forEach((a) => { armorById[a.id] = a; });
const maxGrade = {};
d.grades.forEach((g) => { const a = armorById[g.armor_id]; if (a && g.grade === a.max_grade) maxGrade[g.id] = g; });
const slotsOf = {}, skillsOf = {};
Object.keys(maxGrade).forEach((gid) => {
  const g = maxGrade[gid];
  slotsOf[g.armor_id] = g.driftsmelt_slots;
});
d.gradeSkills.forEach((gs) => {
  const g = maxGrade[gs.armor_grade_id]; if (!g) return;
  (skillsOf[g.armor_id] = skillsOf[g.armor_id] || {})[skillById[gs.skill_id].name] = gs.level;
});
const ARMOUR = d.armor.map((a) => ({
  name: a.name, slot: a.slot, series: seriesById[a.series_id] || '',
  skills: skillsOf[a.id] || {}, slots: slotsOf[a.id] || 0,
}));
const GEMMABLE = {};
d.driftstoneSkills.forEach((x) => { GEMMABLE[skillById[x.skill_id].name] = true; });

// ---------------------------------------------------------------- arguments
const argv = process.argv.slice(2);
const flag = (n) => argv.indexOf(n) > -1;
const val = (n, dflt) => { const i = argv.indexOf(n); return i > -1 ? argv[i + 1] : dflt; };
const TAKES_VALUE = ['--atk', '--ele', '--aff', '--top', '--own', '--skills', '--hunt'];
const name = argv.filter((a, i) => a.charAt(0) !== '-' && TAKES_VALUE.indexOf(argv[i - 1]) < 0)[0];
if (!name) {
  console.error('usage: node suggest.js "Weapon Name" [--gems] [--damage-only]' +
    ' [--atk N --ele N --aff N] [--top N] [--own "Piece=Skill"] [--skills "A 1, B 2"]');
  process.exit(2);
}

// ---------------------------------------------------------------- the weapon
const gradeOf = {};
d.weaponGrades.forEach((x) => { gradeOf[x.weapon_id + '|' + x.grade] = x; });
const levelOf = {};
d.weaponLevels.forEach((l) => { (levelOf[l.weapon_grade_id] = levelOf[l.weapon_grade_id] || {})[l.level] = l; });

const wRow = d.weapons.filter((x) => x.name.toLowerCase() === name.toLowerCase())[0];
if (!wRow) { console.error('no weapon called "' + name + '"'); process.exit(2); }
const gr = gradeOf[wRow.id + '|' + wRow.max_grade];
const st = levelOf[gr.id] && levelOf[gr.id][5];
if (!st) { console.error(name + ' has no 10-5 stats'); process.exit(2); }

// A weapon's own skills count towards the set and must be seeded, not ignored.
const weaponSkills = {};
d.weaponGradeSkills.forEach((ws) => {
  if (ws.weapon_grade_id !== gr.id) return;
  weaponSkills[skillById[ws.skill_id].name] = ws.level;
});

const W = {
  name: wRow.name, category: wRow.category_label, element: wRow.element_label,
  atk: st.attack + Number(val('--atk', 0)),
  ele: st.element_attack + Number(val('--ele', 0)),
  aff: st.affinity + Number(val('--aff', 0)),
  skills: weaponSkills,
  // Style selection changed which skills a ranged weapon wants.
  styleSelectable: wRow.style_selectable === 1,
  // Ammo types this weapon carries, so the ammo boosts are only offered when
  // there is ammo for them to boost.
  ammo: (d.weaponAmmo || []).filter((a) => a.weapon_id === wRow.id)
    .map((a) => a.ammo_type)
    .filter((t, i, arr) => arr.indexOf(t) === i),
  // Magazine size and handling tier per round, which is what Recoil Down's
  // worth is worked out from.
  rounds: (d.weaponAmmo || []).filter((a) => a.weapon_id === wRow.id)
    .map((a) => ({ type: a.ammo_type, capacity: a.capacity,
      recoil: a.recoil, reload: a.reload })),
};
const isStatus = E.STATUS.indexOf(W.element) >= 0;
const DAMAGE_ONLY = flag('--damage-only');
const GEMS = flag('--gems');
// Style customisation's three stat slots. Off unless asked for, since an
// uncustomised weapon does not have them.
W.statSlots = flag('--stat-slots');
if (W.statSlots && !W.styleSelectable) {
  console.error(W.name + ' is not customisable, so it has no stat slots');
  process.exit(2);
}

// Hunt length drives Latent Power's uptime and how far Rising Tide ramps.
// 75s is a standard hunt, a base defence runs about 150.
E.ASSUME.huntSeconds = Number(val('--hunt', E.ASSUME.huntSeconds));

// Blast stacking depends enormously on whether other players are also procing.
E.ASSUME.multiplayer = flag('--group');

console.log(W.name + '  ' + W.category + '  ' + W.element);
console.log('  attack ' + W.atk + '   ' + (isStatus ? 'buildup ' : 'element ') + W.ele +
  (isStatus ? ' (status: excluded from damage)' : '') + '   affinity ' + W.aff + '%');
if (Object.keys(weaponSkills).length) {
  console.log('  the weapon brings: ' +
    Object.keys(weaponSkills).map((n) => n + ' ' + weaponSkills[n]).join(', '));
}

// --skills scores one explicit build, so the engine can be checked against a
// figure derived independently.
const explicit = val('--skills', null);
if (explicit) {
  const totals = {};
  explicit.split(',').forEach((part) => {
    const m = part.trim().match(/^(.*?)\s+(\d+)$/);
    if (!m) { console.error('cannot read "' + part.trim() + '"'); process.exit(2); }
    totals[m[1].trim()] = Number(m[2]);
  });
  const known = E.knownSkills(W);
  const unknown = Object.keys(totals).filter((n) => !known.has(n));
  const s = E.score(totals, W);
  console.log('\n  ' + Object.keys(totals).map((n) => n + ' ' + totals[n]).join(', '));
  console.log('  damage ' + s.dmg.toFixed(1) +
    (s.util ? '   utility x' + (1 + s.util).toFixed(2) + ' -> ' + s.total.toFixed(1) : ''));
  if (unknown.length) console.log('  NOT PRICED (scored as zero): ' + unknown.join(', '));
  process.exit(0);
}

// ---------------------------------------------------------------- your gems
const own = {};
(val('--own', '') || '').split(',').map((s) => s.trim()).filter(Boolean).forEach((part) => {
  const m = part.match(/^(.*?)=(.*?)(?:\s+(\d+))?$/);
  if (!m) { console.error('cannot read --own entry "' + part + '"'); process.exit(2); }
  const piece = m[1].trim(), skill = m[2].trim(), lv = Number(m[3] || 1);
  own[piece] = own[piece] || {};
  own[piece][skill] = (own[piece][skill] || 0) + lv;
});
if (Object.keys(own).length) {
  console.log('  your driftstone skills:');
  Object.keys(own).forEach((p) => {
    const exists = ARMOUR.some((a) => a.name === p);
    console.log('     ' + p.padEnd(22) + Object.keys(own[p]).map((s) => s + ' ' + own[p][s]).join(', ') +
      (exists ? '' : '   <-- NO SUCH PIECE, ignored'));
  });
}
console.log('  hunt ' + E.ASSUME.huntSeconds + 's, ' + (E.ASSUME.multiplayer ? 'group' : 'solo') +
  ' — Latent Power up for ' +
  Math.round(Math.max(0, (E.ASSUME.huntSeconds - E.ASSUME.latentPowerStart) / E.ASSUME.huntSeconds) * 100) + '%');
console.log('  driftsmelt: ' + (GEMS ? 'assumed to hold the set\'s most useful skill' : 'ignored'));
if (DAMAGE_ONLY) console.log('  ranking: damage only, utility weights ignored');

// ---------------------------------------------------------------- search
const TOP = Number(val('--top', 5));
const t0 = Date.now();
const out = S.run(ARMOUR, W, {
  gems: GEMS, damageOnly: DAMAGE_ONLY, own: own, top: TOP, gemmable: GEMMABLE,
});
console.log('  search space: ' + S.SLOTS.map((s) => out.bundles[s].length).join(' x ') +
  ' = ' + out.space.toLocaleString() + ' sets   (' + ((Date.now() - t0) / 1000).toFixed(1) + 's)');
if (GEMS) {
  const no = out.names.filter((n) => !E.UTILITY[n] && !GEMMABLE[n]);
  if (no.length) console.log('  no driftgem exists for: ' + no.join(', '));
}

console.log('\nBest ' + TOP + ' sets:');
out.results.forEach((r, i) => {
  // Damage leads in both modes, so the two can be compared at a glance. A score
  // is damage times the utility weights and is always the larger number.
  console.log('\n  #' + (i + 1) + '  damage ' + r.detail.dmg.toFixed(0) + '   ' + (DAMAGE_ONLY
    ? (r.detail.util ? '(utility ignored; it would add x' + (1 + r.detail.util).toFixed(2) + ')' : '')
    : (r.detail.util ? 'ranked on score ' + r.detail.total.toFixed(0) +
        ' (x' + (1 + r.detail.util).toFixed(2) + ' utility)' : '(no utility skills)')));
  S.SLOTS.forEach((slot, j) => {
    const b = r.picks[j];
    const names = b.pieces.map((p) => p.name);
    const shown = names.slice(0, 2).join(' / ') +
      (names.length > 2 ? ' (+' + (names.length - 2) + ' equivalent)' : '');
    console.log('     ' + SLOT_LABEL[slot].padEnd(6) + shown.padEnd(44) +
      Object.keys(b.v).map((n) => n + ' ' + b.v[n]).join(', '));
  });
  if (r.style) {
    console.log('     style  ' + r.style +
      (r.styleFree ? '   (either style reaches this set — the handling skill did not make it)' : ''));
  }
  if (r.detail.statSlots) console.log('     stats  ' + r.detail.statSlots);
  if (r.gemText) console.log('     gems   ' + r.gemText + '   (' + r.slots + ' slot(s))');
  else if (r.gemPotential) {
    const gain = r.gemPotential.detail.dmg - r.detail.dmg;
    console.log('     slots  ' + r.slots + ' — best ' + r.gemPotential.used + ' gem(s): ' +
      r.gemPotential.text + '  ->  damage ' + r.gemPotential.detail.dmg.toFixed(0) +
      ' (+' + gain.toFixed(0) + ', not counted in the ranking)');
  } else if (r.slots) console.log('     slots  ' + r.slots + ', nothing useful to put in them');
  console.log('     totals ' + Object.keys(r.totals).sort().map((n) => n + ' ' + r.totals[n]).join(', '));
});

const ignored = {};
out.results[0].picks.forEach((b) => {
  Object.keys(b.pieces[0].skills || {}).forEach((n) => { if (!out.known[n]) ignored[n] = true; });
});
if (Object.keys(ignored).length) {
  console.log('\n  Skills on the winning set that this engine does not price: ' +
    Object.keys(ignored).sort().join(', '));
}
