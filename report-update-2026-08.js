/**
 * Reports the skill improvements in the August 2026 balance update, grouped by
 * armour series, with the level at grade 8 and grade 10.
 *
 *   node report-update-2026-08.js   -> writes UPDATE-2026-08.md
 *
 * PROVENANCE — read before trusting the "was" column.
 * The pre-update snapshot no longer exists: build.js used to overwrite
 * data.prev.json on every run, and a second run after the update destroyed it.
 * So the "was" values below are NOT re-derivable by running diff.js today.
 * They are transcribed from the two records made while both states existed:
 *   1. the user's own `npm run check` run, which caught the real 178-change
 *      diff at the moment the source updated;
 *   2. a comparison of the live database against a scratch import of the new
 *      seed, run before the database was re-imported.
 * The two agree everywhere they overlap.
 *
 * The "now" columns are read live from data.json, so they are always current.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const OUT = path.join(HERE, 'UPDATE-2026-08.md');

// piece, skill, level before the update. 0 = the skill was not on the piece.
const IMPROVED = [
  // Elder dragon sets — verified in game piece by piece, and the source later
  // agreed with every one of them.
  ['Kushala Glare', 'Reload Speed', 1],
  ['Kushala Grip', 'Focus', 1],
  ['Kushala Cocoon', 'Weakness Exploit', 1],
  ['Kushala Crus', 'Skyward Striker', 1],
  ['Kaiser Crown', 'Latent Power', 1],
  ['Kaiser Mail', 'Critical Eye', 1],
  ['Kaiser Vambraces', 'Artillery', 1],
  ['Kaiser Coil', 'Burst', 1],
  ['Kaiser Greaves', 'Critical Boost', 1],
  ['Nergigante Helm', 'Critical Eye', 1],
  ['Nergigante Mail', 'Sneak Attack', 1],
  ['Nergigante Coil', 'Attack Boost', 1],

  // Early released monster sets.
  ['Anja Coil', 'Fire Resistance', 1],
  ['Barroth Helm', 'Offensive Guard', 1],
  ['Barroth Coil', 'Defense Boost', 1],
  ['Diablos Mail', 'Slugger', 1],
  ['Diablos Coil', 'Offensive Guard', 1],
  ['Girros Mail', 'Sneak Attack', 1],
  ['Girros Mask', 'Paralysis Resistance', 2],
  ['Jagras Vambraces', 'Firm Foothold', 1],
  ['Jyura Coil', 'Water Resistance', 2],
  ['Kadachi Helm', 'Artful Dodger', 1],
  ['Kadachi Greaves', 'Thunder Resistance', 1],
  ['Legiana Helm', 'Divine Blessing', 1],
  ['Legiana Greaves', 'Reload Speed', 1],
  ['Lumu Hat', 'Concentration', 1],
  ['Lumu Greaves', 'Windproof', 2],
  ['Lumu Mail', 'Windproof', 0],          // skill added outright
  ['Pukei Mail', 'Focus', 1],
  ['Pukei Vambraces', 'Poison Attack', 1],
  ['Pukei Greaves', 'Poison Resistance', 1],
  ['Rathalos Vambraces', 'Attack Boost', 1],
  ['Rathalos Coil', 'Focus', 1],
  ['Rathalos Greaves', 'Fire Resistance', 1],
  ['Rathian Coil', 'Poison Resistance', 1],
];

// Driftsmelt-slot changes, listed separately — not skill improvements.
const SLOTS = [
  ['Kushala Cista', 'slot 1 from grade 6, slot 2 from grade 8 (was slot 1 only, from grade 8)'],
  ['Anja Greaves', 'second slot at grades 8-10 (was one)'],
];

const SLOT_LABEL = { HEAD: 'Head', CHEST: 'Chest', ARMS: 'Arms', TORSO: 'Waist', LEGS: 'Legs' };
const SLOT_ORDER = ['HEAD', 'CHEST', 'ARMS', 'TORSO', 'LEGS'];

const d = JSON.parse(fs.readFileSync(path.join(HERE, 'data.json'), 'utf8'));
const skillName = {};
d.skills.forEach((s) => { skillName[s.id] = s.name; });
const skillMax = {};
d.skills.forEach((s) => { skillMax[s.name] = s.max_level; });
const armorById = {};
d.armor.forEach((a) => { armorById[a.id] = a; });
const seriesById = {};
d.series.forEach((s) => { seriesById[s.id] = s.name; });
const gradeById = {};
d.grades.forEach((g) => { gradeById[g.id] = g; });

const armorByName = {};
d.armor.forEach((a) => { armorByName[a.name] = a; });

// (armour name, skill name, grade) -> level
const levelAt = {};
d.gradeSkills.forEach((gs) => {
  const g = gradeById[gs.armor_grade_id];
  const a = armorById[g.armor_id];
  levelAt[a.name + '|' + skillName[gs.skill_id] + '|' + g.grade] = gs.level;
});

const problems = [];
const rows = IMPROVED.map(([piece, skill, was]) => {
  const a = armorByName[piece];
  if (!a) { problems.push('unknown piece: ' + piece); return null; }
  const g8 = levelAt[piece + '|' + skill + '|8'];
  const g10 = levelAt[piece + '|' + skill + '|' + a.max_grade];
  if (g10 === undefined) problems.push('no ' + skill + ' on ' + piece + ' at max grade');
  if (g10 !== undefined && g10 <= was) {
    problems.push(piece + ' ' + skill + ': recorded was=' + was + ' but source now has ' + g10);
  }
  return {
    series: seriesById[a.series_id],
    piece: piece,
    slot: a.slot,
    skill: skill,
    was: was,
    g8: g8,
    g10: g10,
    cap: skillMax[skill],
    minGrade: a.min_grade,
  };
}).filter(Boolean);

// group by series, ordered by how many pieces improved
const bySeries = {};
rows.forEach((r) => { (bySeries[r.series] = bySeries[r.series] || []).push(r); });
const seriesOrder = Object.keys(bySeries).sort((a, b) =>
  bySeries[b].length - bySeries[a].length || a.localeCompare(b));

const out = [];
const w = (s) => out.push(s === undefined ? '' : s);

w('# Skill improvements — August 2026 balance update');
w('');
w('Grouped by armour series, most improved first. ' + rows.length +
  ' pieces across ' + seriesOrder.length + ' series.');
w('');
w('`Was` is the level before the update. `G8` and `G10` are the levels now, read');
w('live from `data.json`. The buff is grade-tiered on the older monster sets, so');
w('G8 and G10 often differ — the max-grade number alone hides that.');
w('');

seriesOrder.forEach((s) => {
  const list = bySeries[s].sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot));
  w('## ' + s + '  —  ' + list.length + ' piece' + (list.length === 1 ? '' : 's'));
  w('');
  w('| Piece | Slot | Skill | Was | G8 | G10 | Cap |');
  w('| --- | --- | --- | --- | --- | --- | --- |');
  list.forEach((r) => {
    const wasTxt = r.was === 0 ? '_absent_' : r.was;
    const g8Txt = r.g8 === undefined ? '—' : (r.g8 > r.was ? '**' + r.g8 + '**' : String(r.g8));
    const g10Txt = r.g10 === undefined ? '—' : '**' + r.g10 + '**';
    w('| ' + r.piece + ' | ' + SLOT_LABEL[r.slot] + ' | ' + r.skill + ' | ' + wasTxt +
      ' | ' + g8Txt + ' | ' + g10Txt + ' | ' + r.cap + ' |');
  });
  w('');
});

w('## Biggest gains at grade 10');
w('');
w('| Piece | Skill | Was | Now | Gain |');
w('| --- | --- | --- | --- | --- |');
rows.filter((r) => r.g10 !== undefined)
  .sort((a, b) => (b.g10 - b.was) - (a.g10 - a.was) || a.piece.localeCompare(b.piece))
  .slice(0, 10)
  .forEach((r) => w('| ' + r.piece + ' | ' + r.skill + ' | ' + (r.was === 0 ? '_absent_' : r.was) +
    ' | ' + r.g10 + ' | +' + (r.g10 - r.was) + ' |'));
w('');

w('## Driftsmelt slots (not skill changes)');
w('');
w('| Piece | Change |');
w('| --- | --- |');
SLOTS.forEach(([p, note]) => w('| ' + p + ' | ' + note + ' |'));
w('');

w('## Also in this update');
w('');
w('- New skill **Stunning Impact** (Attack, max Lv5).');
w('- New driftstone **Burst Driftgem**, granting Pursuit Lv1.');
w('- **Stunning Impact Driftgem** finally has its skill attached.');
w('');

// Flat one-line-per-piece listing: `node report-update-2026-08.js --flat`
if (process.argv.indexOf('--flat') > -1) {
  const flat = [];
  seriesOrder.forEach((s) => {
    flat.push('');
    flat.push(s);
    bySeries[s]
      .sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot))
      .forEach((r) => {
        const from = r.was === 0 ? 'none' : 'Lv' + r.was;
        flat.push('  ' + r.piece + ' - ' + r.skill + ' - (' + from + ' -> Lv' + r.g10 + ')');
      });
  });
  console.log(flat.join('\n').trim());
  process.exit(0);
}

fs.writeFileSync(OUT, out.join('\n'), 'utf8');

console.log('wrote ' + path.basename(OUT));
console.log('  ' + rows.length + ' improved pieces across ' + seriesOrder.length + ' series');
seriesOrder.forEach((s) => console.log('    ' + s.padEnd(18) + bySeries[s].length));
if (problems.length) {
  console.log('  CONSISTENCY PROBLEMS:');
  problems.forEach((p) => console.log('    ' + p));
} else {
  console.log('  every recorded "was" is lower than what the source now has — consistent');
}
