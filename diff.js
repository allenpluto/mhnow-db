/**
 * Compares two data.json snapshots and reports what actually changed.
 *
 *   node diff.js                       -> data.prev.json vs data.json
 *   node diff.js old.json new.json
 *
 * Row counts staying the same proves nothing: a rebalance can change effect
 * numbers, level text or an armour piece's skills without moving any count.
 * This compares on STABLE keys (game ids and enum kinds), never on the
 * synthetic auto-increment ids in the snapshot, which shift if ordering moves.
 *
 * Exits 0 whether or not it finds changes, so `npm run check` stays quiet.
 * Pass --exit-code to get 1 on changes (2 on error) for gating a rebuild.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const HERE = __dirname;

// Strip flags before reading positional paths, or `diff.js --exit-code` treats
// the flag itself as the old snapshot and dies looking for a file named that.
const wantExitCode = process.argv.indexOf('--exit-code') > -1;
const positional = process.argv.slice(2).filter((a) => a.charAt(0) !== '-');
const oldPath = positional[0] || path.join(HERE, 'data.prev.json');
const newPath = positional[1] || path.join(HERE, 'data.json');

function load(p) {
  if (!fs.existsSync(p)) {
    console.error('missing snapshot: ' + p);
    process.exit(2);
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

const A = load(oldPath);
const B = load(newPath);

const lines = [];
let changes = 0;
const say = (s) => lines.push(s);
const section = (t) => { say(''); say('== ' + t + ' '.repeat(Math.max(0, 40 - t.length)).replace(/ /g, '=')); };

function index(rows, keyFn) {
  const m = {};
  (rows || []).forEach((r) => { m[keyFn(r)] = r; });
  return m;
}

/** Generic keyed comparison over a list of fields. */
function compare(label, oldRows, newRows, keyFn, fields, describe) {
  const a = index(oldRows, keyFn);
  const b = index(newRows, keyFn);
  const added = Object.keys(b).filter((k) => !(k in a));
  const removed = Object.keys(a).filter((k) => !(k in b));
  const changed = [];

  Object.keys(b).forEach((k) => {
    if (!(k in a)) return;
    const diffs = [];
    fields.forEach((f) => {
      const x = a[k][f], y = b[k][f];
      if (JSON.stringify(x) !== JSON.stringify(y)) {
        diffs.push('    ' + f + ': ' + JSON.stringify(x) + '  ->  ' + JSON.stringify(y));
      }
    });
    if (diffs.length) changed.push({ k: k, diffs: diffs });
  });

  if (!added.length && !removed.length && !changed.length) {
    say('  ' + label + ': unchanged (' + Object.keys(b).length + ')');
    return;
  }

  changes += added.length + removed.length + changed.length;
  say('  ' + label + ':');
  added.forEach((k) => say('    + ADDED   ' + (describe ? describe(b[k]) : k)));
  removed.forEach((k) => say('    - REMOVED ' + (describe ? describe(a[k]) : k)));
  changed.forEach((c) => {
    say('    ~ CHANGED ' + (describe ? describe(b[c.k]) : c.k));
    c.diffs.forEach((d) => say(d));
  });
}

// --- skills ---------------------------------------------------------------

section('Skills');
compare('skill definitions', A.skills, B.skills,
  (s) => s.kind,
  ['name', 'category', 'category_label', 'max_level'],
  (s) => s.name + ' [' + s.kind + ']');

// Level rows keyed by skill kind + level, so a renumbered skillId does not
// masquerade as a change.
const skillKindById = {};
[A, B].forEach((snap, i) => {
  const m = {};
  snap.skills.forEach((s) => { m[s.id] = s.kind; });
  skillKindById[i] = m;
});
const levelKey = (which) => (l) => skillKindById[which][l.skill_id] + '#' + l.level;

// Not routed through compare(): the key depends on which snapshot the row came
// from, since skill_id -> kind is resolved per snapshot.
(function compareLevels() {
  const a = index(A.skillLevels, levelKey(0));
  const b = index(B.skillLevels, levelKey(1));
  const added = Object.keys(b).filter((k) => !(k in a));
  const removed = Object.keys(a).filter((k) => !(k in b));
  const changed = [];
  Object.keys(b).forEach((k) => {
    if (!(k in a)) return;
    const diffs = [];
    ['description', 'effect_amounts', 'condition_amounts'].forEach((f) => {
      if (JSON.stringify(a[k][f]) !== JSON.stringify(b[k][f])) {
        diffs.push('    ' + f + ':\n      old: ' + JSON.stringify(a[k][f]) +
                   '\n      new: ' + JSON.stringify(b[k][f]));
      }
    });
    if (diffs.length) changed.push({ k: k, diffs: diffs });
  });
  if (!added.length && !removed.length && !changed.length) {
    say('  level effects: unchanged (' + Object.keys(b).length + ')');
    return;
  }
  changes += added.length + removed.length + changed.length;
  say('  level effects:');
  added.forEach((k) => say('    + ADDED   ' + k));
  removed.forEach((k) => say('    - REMOVED ' + k));
  changed.forEach((c) => { say('    ~ CHANGED ' + c.k); c.diffs.forEach((d) => say(d)); });
})();

// --- armour ---------------------------------------------------------------

section('Armour');
const seriesNameById = {};
[A, B].forEach((snap, i) => {
  const m = {};
  snap.series.forEach((s) => { m[s.id] = s.name; });
  seriesNameById[i] = m;
});

compare('series', A.series, B.series, (s) => s.kind, ['name'], (s) => s.name);
compare('pieces', A.armor, B.armor, (a) => a.kind,
  ['name', 'slot', 'min_grade', 'max_grade'],
  (a) => a.name + ' [' + a.kind + ']');

// Grades keyed by the game's own armorId.
compare('grades', A.grades, B.grades, (g) => 'g' + g.game_armor_id,
  ['grade', 'driftsmelt_slots'], (g) => 'armorId ' + g.game_armor_id);

// Skills per grade: key by game_armor_id + skill kind.
(function compareGradeSkills() {
  function flatten(snap, which) {
    const gameIdByGradeId = {};
    snap.grades.forEach((g) => { gameIdByGradeId[g.id] = g.game_armor_id; });
    const armorNameById = {};
    snap.armor.forEach((a) => { armorNameById[a.id] = a.name; });
    const armorIdByGradeId = {};
    snap.grades.forEach((g) => { armorIdByGradeId[g.id] = g.armor_id; });
    const gradeByGradeId = {};
    snap.grades.forEach((g) => { gradeByGradeId[g.id] = g.grade; });

    const out = {};
    snap.gradeSkills.forEach((gs) => {
      const kind = skillKindById[which][gs.skill_id];
      const key = gameIdByGradeId[gs.armor_grade_id] + '#' + kind;
      out[key] = {
        level: gs.level,
        label: armorNameById[armorIdByGradeId[gs.armor_grade_id]] +
               ' grade ' + gradeByGradeId[gs.armor_grade_id] + ' — ' + kind,
      };
    });
    return out;
  }

  const a = flatten(A, 0), b = flatten(B, 1);
  const added = Object.keys(b).filter((k) => !(k in a));
  const removed = Object.keys(a).filter((k) => !(k in b));
  const changed = Object.keys(b).filter((k) => k in a && a[k].level !== b[k].level);

  if (!added.length && !removed.length && !changed.length) {
    say('  skills on armour: unchanged (' + Object.keys(b).length + ')');
    return;
  }
  changes += added.length + removed.length + changed.length;
  say('  skills on armour:');
  added.slice(0, 60).forEach((k) => say('    + ADDED   ' + b[k].label + ' Lv' + b[k].level));
  removed.slice(0, 60).forEach((k) => say('    - REMOVED ' + a[k].label + ' Lv' + a[k].level));
  changed.slice(0, 60).forEach((k) => say('    ~ CHANGED ' + b[k].label + ': Lv' + a[k].level + ' -> Lv' + b[k].level));
  const shown = Math.min(added.length, 60) + Math.min(removed.length, 60) + Math.min(changed.length, 60);
  const total = added.length + removed.length + changed.length;
  if (total > shown) say('    ... and ' + (total - shown) + ' more');
})();

// Defence keyed by game_armor_id + step.
(function compareDefence() {
  function flatten(snap) {
    const gameIdByGradeId = {};
    snap.grades.forEach((g) => { gameIdByGradeId[g.id] = g.game_armor_id; });
    const out = {};
    snap.defense.forEach((d) => {
      out[gameIdByGradeId[d.armor_grade_id] + '#' + d.step] = d.defense;
    });
    return out;
  }
  const a = flatten(A), b = flatten(B);
  const keys = Object.keys(b);
  const diff = keys.filter((k) => a[k] !== b[k]);
  if (!diff.length && keys.length === Object.keys(a).length) {
    say('  defence values: unchanged (' + keys.length + ')');
    return;
  }
  changes += diff.length;
  say('  defence values: ' + diff.length + ' changed');
  diff.slice(0, 20).forEach((k) => say('    ~ ' + k + ': ' + a[k] + ' -> ' + b[k]));
})();

// --- driftstones ----------------------------------------------------------

section('Driftsmelting');
compare('driftstones', A.driftstones, B.driftstones, (d) => d.kind,
  ['name', 'points', 'walking_distance_m', 'is_random_pool'], (d) => d.name);

(function compareStoneSkills() {
  function flatten(snap, which) {
    const nameById = {};
    snap.driftstones.forEach((d) => { nameById[d.id] = d.name; });
    const out = {};
    snap.driftstoneSkills.forEach((s) => {
      const kind = skillKindById[which][s.skill_id];
      out[s.driftstone_id + '#' + kind + '#' + s.level] =
        { weight: s.weight, label: nameById[s.driftstone_id] + ' — ' + kind + ' Lv' + s.level };
    });
    return out;
  }
  const a = flatten(A, 0), b = flatten(B, 1);
  const added = Object.keys(b).filter((k) => !(k in a));
  const removed = Object.keys(a).filter((k) => !(k in b));
  const changed = Object.keys(b).filter((k) => k in a && a[k].weight !== b[k].weight);
  if (!added.length && !removed.length && !changed.length) {
    say('  driftstone skills: unchanged (' + Object.keys(b).length + ')');
    return;
  }
  changes += added.length + removed.length + changed.length;
  say('  driftstone skills:');
  added.forEach((k) => say('    + ADDED   ' + b[k].label + ' (weight ' + b[k].weight + ')'));
  removed.forEach((k) => say('    - REMOVED ' + a[k].label));
  changed.forEach((k) => say('    ~ CHANGED ' + b[k].label + ' weight ' + a[k].weight + ' -> ' + b[k].weight));
})();

// --- weapons --------------------------------------------------------------

section('Weapons');

compare('weapon definitions', A.weapons, B.weapons, (w) => w.kind,
  ['name', 'low_name', 'category', 'element', 'min_grade', 'max_grade',
   'shelling_type', 'phial_type', 'sword_mode_element_attack',
   'kinsect_type', 'kinsect_attack_type', 'kinsect_attack_attribute',
   'kinsect_parameter_type', 'kinsect_attack_level', 'kinsect_stamina_level',
   'kinsect_bonus_kind', 'horn_pattern', 'customizable', 'style_selectable'],
  (w) => w.name + ' [' + w.kind + ']');

// Everything below hangs off weapon_grade, whose own id is synthetic. Key on
// the game's weaponId instead so a reordered build does not look like a change.
function weaponIndex(snap) {
  const kindById = {}; (snap.weapons || []).forEach((w) => { kindById[w.id] = w.kind; });
  const nameById = {}; (snap.weapons || []).forEach((w) => { nameById[w.id] = w.name; });
  const gameByGrade = {}, gradeNo = {}, weaponOfGrade = {};
  (snap.weaponGrades || []).forEach((g) => {
    gameByGrade[g.id] = g.game_weapon_id;
    gradeNo[g.id] = g.grade;
    weaponOfGrade[g.id] = kindById[g.weapon_id];
  });
  const skillKind = {}; (snap.skills || []).forEach((s) => { skillKind[s.id] = s.kind; });
  return { kindById, nameById, gameByGrade, gradeNo, weaponOfGrade, skillKind };
}
const WA = weaponIndex(A), WB = weaponIndex(B);

compare('weapon grades', A.weaponGrades, B.weaponGrades, (g) => 'wg' + g.game_weapon_id,
  ['grade', 'special_skill', 'special_skill_level'], (g) => 'weaponId ' + g.game_weapon_id);

function keyedRows(snap, idx, rows, keyFn, valFn) {
  const out = {};
  (rows || []).forEach((r) => { const k = keyFn(r, idx); if (k) out[k] = valFn(r, idx); });
  return out;
}

function diffMap(label, a, b, describe) {
  const added = Object.keys(b).filter((k) => !(k in a));
  const removed = Object.keys(a).filter((k) => !(k in b));
  const changed = Object.keys(b).filter((k) => k in a && JSON.stringify(a[k].v) !== JSON.stringify(b[k].v));
  if (!added.length && !removed.length && !changed.length) {
    say('  ' + label + ': unchanged (' + Object.keys(b).length + ')');
    return;
  }
  changes += added.length + removed.length + changed.length;
  say('  ' + label + ':');
  added.slice(0, 40).forEach((k) => say('    + ADDED   ' + b[k].label));
  removed.slice(0, 40).forEach((k) => say('    - REMOVED ' + a[k].label));
  changed.slice(0, 40).forEach((k) =>
    say('    ~ CHANGED ' + b[k].label + ': ' + JSON.stringify(a[k].v) + ' -> ' + JSON.stringify(b[k].v)));
  const total = added.length + removed.length + changed.length;
  const shown = Math.min(added.length, 40) + Math.min(removed.length, 40) + Math.min(changed.length, 40);
  if (total > shown) say('    ... and ' + (total - shown) + ' more');
}

diffMap('weapon stats per grade level',
  keyedRows(A, WA, A.weaponLevels,
    (l, i) => i.gameByGrade[l.weapon_grade_id] + '#' + l.level,
    (l, i) => ({ v: [l.attack, l.element_attack, l.affinity],
      label: i.weaponOfGrade[l.weapon_grade_id] + ' g' + i.gradeNo[l.weapon_grade_id] + '-' + l.level })),
  keyedRows(B, WB, B.weaponLevels,
    (l, i) => i.gameByGrade[l.weapon_grade_id] + '#' + l.level,
    (l, i) => ({ v: [l.attack, l.element_attack, l.affinity],
      label: i.weaponOfGrade[l.weapon_grade_id] + ' g' + i.gradeNo[l.weapon_grade_id] + '-' + l.level })));

diffMap('skills on weapons',
  keyedRows(A, WA, A.weaponGradeSkills,
    (s, i) => i.gameByGrade[s.weapon_grade_id] + '#' + i.skillKind[s.skill_id],
    (s, i) => ({ v: s.level,
      label: i.weaponOfGrade[s.weapon_grade_id] + ' g' + i.gradeNo[s.weapon_grade_id] + ' — ' + i.skillKind[s.skill_id] })),
  keyedRows(B, WB, B.weaponGradeSkills,
    (s, i) => i.gameByGrade[s.weapon_grade_id] + '#' + i.skillKind[s.skill_id],
    (s, i) => ({ v: s.level,
      label: i.weaponOfGrade[s.weapon_grade_id] + ' g' + i.gradeNo[s.weapon_grade_id] + ' — ' + i.skillKind[s.skill_id] })));

[['bowgun ammo', 'weaponAmmo', (r) => [r.ammo_type, r.element, r.name, r.capacity, r.recoil, r.reload]],
 ['bow arrows', 'weaponArrows', (r) => [r.kind, r.family, r.name]],
 ['hunting horn melodies', 'weaponMelodies', (r) => [r.kind, r.name]]].forEach((spec) => {
  diffMap(spec[0],
    keyedRows(A, WA, A[spec[1]], (r, i) => i.kindById[r.weapon_id] + '#' + r.position,
      (r, i) => ({ v: spec[2](r), label: i.nameById[r.weapon_id] + ' slot ' + r.position })),
    keyedRows(B, WB, B[spec[1]], (r, i) => i.kindById[r.weapon_id] + '#' + r.position,
      (r, i) => ({ v: spec[2](r), label: i.nameById[r.weapon_id] + ' slot ' + r.position })));
});

// --- report ---------------------------------------------------------------

console.log('comparing');
console.log('  old: ' + oldPath);
console.log('  new: ' + newPath);
console.log(lines.join('\n'));
console.log('');
console.log(changes === 0 ? 'NO CHANGES' : 'CHANGES FOUND: ' + changes);

// Exit non-zero ONLY when asked for (see wantExitCode above). This normally
// runs interactively via `npm run check`, and npm treats any non-zero exit as
// a failed script and prints a wall of ELIFECYCLE errors — which reads as a
// crash when "changes found" is in fact the useful, successful outcome.
process.exit(wantExitCode && changes ? 1 : 0);
