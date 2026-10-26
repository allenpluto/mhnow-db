/**
 * Adds event ARMOUR to manual-weapons.json from the shorthand the user reads out
 * of the game. Companion to add-event-weapon.js; same dry-run-first behaviour.
 *
 *   node add-event-armour.js --line "Name | Set | Slot | Slots | Skill +Lv1"
 *   node add-event-armour.js --file lines.txt
 *   ... add --write to save; without it nothing is written.
 *
 * LINE FORMAT
 *   Name | Set | Slot | Driftsmelt slots | Skill +LvN [Skill2 +LvN]
 *
 *   Slot is the game's word — Head, Chest, Arms, Waist or Legs. Waist is stored
 *   as TORSO, which is what the source calls it.
 *
 *   Skills may be separated by ";" or by nothing at all: the parser splits on
 *   the "+LvN" markers, so "Sweltering Summer 2025 +Lv1 Valor +Lv1" is read as
 *   two skills rather than one skill with a very long name.
 *
 * WHAT IS NOT ASKED FOR
 *   Defence. Across all 355 source pieces it varies by grade and step alone,
 *   never by piece or slot, so grade 10 is always 182/186/190/193/197 and
 *   build.js fills that in. A piece that genuinely differs needs a `defense`
 *   array added to its entry by hand.
 *
 *   Grade. Every source piece maxes at 10 and event pieces are stored at max
 *   grade only, matching how the event weapons are held.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const MANUAL = path.join(HERE, 'manual-weapons.json');
const WRITE = process.argv.indexOf('--write') > -1;

const SLOTS = { head: 'HEAD', chest: 'CHEST', arms: 'ARMS', waist: 'TORSO', torso: 'TORSO', legs: 'LEGS' };
const GRADE = 10;
const GAME_ARMOR_ID_BASE = 900000;   // reserved for manual rows, like weapons

function parseSkills(raw) {
  const out = [];

  // No "Lv" anywhere means no levels were given, so the whole field is one
  // skill per ";" at level 1. Detecting that first matters: a name like
  // "Happy New Year (2024)" has digits in it, and a regex looking for a
  // trailing number would read 2024 as the level.
  if (!/Lv/i.test(raw)) {
    raw.split(';').map((s) => s.trim()).filter(Boolean)
      .forEach((s) => out.push({ skill: s, level: 1, levelAssumed: true }));
    return out;
  }

  // Otherwise split on the "+LvN" markers, so a missing separator between two
  // skills does not merge them into one very long name.
  const re = /([^;+]+?)\s*\+?\s*Lv\.?\s*(\d+)/gi;
  let m;
  while ((m = re.exec(raw)) !== null) {
    const name = m[1].replace(/^[;\s]+/, '').trim();
    if (name) out.push({ skill: name, level: Number(m[2]) });
  }
  return out;
}

function parseLine(line) {
  const all = line.split('|').map((s) => s.trim());
  // "monster: X" may appear anywhere after the fixed fields.
  let monster = null;
  const p = [];
  all.forEach((f) => {
    const m = f.match(/^monster\s*:\s*(.*)$/i);
    if (m) monster = m[1].trim(); else p.push(f);
  });
  return {
    name: p[0] || '',
    set: p[1] || '',
    slotWord: p[2] || '',
    slots: p[3] === undefined || p[3] === '' ? null : Number(p[3]),
    skills: parseSkills(p[4] || ''),
    monster: monster,
    grade: /grade\s*(\d+)/i.test(line) ? Number(line.match(/grade\s*(\d+)/i)[1]) : GRADE,
  };
}

// --- load what already exists ----------------------------------------------
const d = JSON.parse(fs.readFileSync(path.join(HERE, 'data.json'), 'utf8'));
const M = JSON.parse(fs.readFileSync(MANUAL, 'utf8'));
if (!M.armor) M.armor = [];

const skillByName = {};
d.skills.forEach((s) => { skillByName[s.name] = s; });
(M.skills || []).forEach((s) => { if (!skillByName[s.name]) skillByName[s.name] = s; });

const haveNames = {};
d.armor.forEach((x) => { haveNames[x.name] = 'the source'; });
M.armor.forEach((x) => { haveNames[x.name] = 'manual-weapons.json'; });

const lines = [];
const fi = process.argv.indexOf('--file');
if (fi > -1) {
  fs.readFileSync(process.argv[fi + 1], 'utf8').split(/\r?\n/)
    .map((l) => l.trim()).filter((l) => l && l.charAt(0) !== '#').forEach((l) => lines.push(l));
}
const li = process.argv.indexOf('--line');
if (li > -1) lines.push(process.argv[li + 1]);
if (!lines.length) { console.error('give me --line "..." or --file lines.txt'); process.exit(2); }

let added = 0, blocked = 0;

lines.forEach((line) => {
  const p = parseLine(line);
  const warn = [], block = [];

  const slot = SLOTS[p.slotWord.toLowerCase()];
  if (!p.name) block.push('no name');
  if (!slot) block.push('slot "' + p.slotWord + '" is not Head, Chest, Arms, Waist or Legs');
  if (!p.set) block.push('no set given');
  if (haveNames[p.name]) block.push('"' + p.name + '" already exists in ' + haveNames[p.name]);
  if (!p.skills.length) block.push('no skills read from "' + (line.split('|')[4] || '') + '"');
  if (p.slots === null) { p.slots = 0; warn.push('no driftsmelt slot count given, assuming 0'); }
  else if (p.slots < 0 || p.slots > 2) block.push('driftsmelt slots ' + p.slots + ' is outside 0-2');

  p.skills.forEach((s) => {
    if (s.levelAssumed) warn.push('no level given for "' + s.skill + '", assuming Lv1');
    const k = skillByName[s.skill];
    if (!k) block.push('skill "' + s.skill + '" is not known — add it to manual skills first');
    else if (s.level > k.max_level) {
      block.push('skill "' + s.skill + '" Lv' + s.level + ' exceeds its max of ' + k.max_level);
    }
  });

  console.log('\n' + (p.name || '(unnamed)') + (p.set ? '  [' + p.set + ']' : ''));
  console.log('   ' + String(slot || p.slotWord).padEnd(8) + 'grade ' + p.grade +
    '   driftsmelt slots ' + p.slots + '   defence 197 (standard ladder)');
  console.log('   skills: ' + p.skills.map((s) => s.skill + ' ' + s.level).join(', '));
  warn.forEach((x) => console.log('   note: ' + x));
  block.forEach((x) => console.log('   BLOCKED: ' + x));

  if (block.length) { blocked++; return; }
  if (!WRITE) { added++; return; }

  let ser = (M.series || []).filter((s) => s.name === p.set)[0];
  if (!ser) {
    const next = Math.max.apply(null, M.series.map((s) => s.id)) + 1;
    ser = { id: next, kind: 'SERIES_MANUAL_' + p.set.toUpperCase().replace(/[^A-Z0-9]+/g, '_'),
      name: p.set, sort_order: 999000000 + next };
    M.series.push(ser);
    console.log('   created series ' + ser.id + ' "' + p.set + '"');
  }

  const usedGame = M.armor.map((x) => x.grades[0].game_armor_id);
  const nextGame = usedGame.length ? Math.max.apply(null, usedGame) + 1 : GAME_ARMOR_ID_BASE;

  const rec = {
    kind: 'MANUAL_' + p.name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, ''),
    name: p.name,
    series_id: ser.id,
    slot: slot,
    _source: 'user-supplied: ' + line,
  };
  if (p.monster) {
    // The monster an event piece is built or upgraded from, not a monster that
    // drops it. Kept here because the schema does not model monsters at all yet
    // (see README, "Not covered yet"), and the spreadsheet does carry the field.
    rec.monster_name = p.monster;
    rec._monster = 'Required for upgrade material, not the source of the piece.';
  }
  M.armor.push(Object.assign(rec, {
    grades: [{
      grade: p.grade,
      game_armor_id: nextGame,
      driftsmelt_slots: p.slots,
      skills: p.skills.map((s) => ({ skill: s.skill, level: s.level })),
    }],
  }));
  haveNames[p.name] = 'manual-weapons.json';
  added++;
});

if (WRITE && added) {
  fs.writeFileSync(MANUAL, JSON.stringify(M, null, 2), 'utf8');
  console.log('\nwrote ' + added + ' armour piece(s) to manual-weapons.json');
} else if (!WRITE) {
  console.log('\n(dry run — ' + added + ' would be added, ' + blocked + ' blocked; pass --write to save)');
} else {
  console.log('\nnothing added; ' + blocked + ' blocked');
}
