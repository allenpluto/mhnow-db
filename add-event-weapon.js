/**
 * Adds event weapons to manual-weapons.json from the shorthand lines the user
 * reads out of the game.
 *
 *   node add-event-weapon.js --line "Name | Type | Element | ATK | AFF | Skill +Lv1"
 *   node add-event-weapon.js --file lines.txt
 *   ... add --write to actually save; without it this is a dry run.
 *
 * LINE FORMAT
 *   Name | Type | Element[ value] | ATK | AFF | Skill +LvN[; Skill2 +LvN] [| attrs...]
 *
 *   Attack and element default to the GRADE 10 LEVEL 1 reading, because that is
 *   what the game shows for a weapon that is not maxed. Suffix a value with
 *   "(max)" when it is the 10-5 figure instead.
 *
 *   Shorthand: "Esperanza Whatever (hope)" fills in everything that is constant
 *   across the Hope Set. Melee gets Lock On 1; a ranged Hope weapon must state
 *   its skill, because all three differ.
 *
 *   Attribute tails, any of:
 *     ammo: Name / capacity / recoil / reload; Name / ...
 *     arrows: Rapid 1, Rapid 2, Rapid 3, Spread 4
 *     shelling: Wide          phial: Power        melodies: A, B, C
 *
 * 10-1 -> 10-5 CONVERSION
 *   Every 10-1 value in the source maps to exactly one 10-5 value, so the
 *   conversion is a lookup, not a guess. When a value is not one of the known
 *   tiers the weapon is still added, but the figure is marked estimated using
 *   round(x * 1.198027) — the best fit over all source weapons, never out by
 *   more than 1.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const MANUAL = path.join(HERE, 'manual-weapons.json');
const WRITE = process.argv.indexOf('--write') > -1;
const K_ATTACK = 1.198027;

const CATEGORY = { 'Great Sword': 'GREAT_SWORD', 'Long Sword': 'LONG_SWORD',
  'Sword & Shield': 'SWORD_SHIELD', 'Sword and Shield': 'SWORD_SHIELD', 'Dual Blades': 'DUAL_BLADES',
  'Hammer': 'HAMMER', 'Hunting Horn': 'HUNTING_HORN', 'Lance': 'LANCE', 'Gunlance': 'GUNLANCE',
  'Switch Axe': 'SWITCH_AXE', 'Charge Blade': 'CHARGE_BLADE', 'Insect Glaive': 'INSECT_GLAIVE',
  'Light Bowgun': 'LIGHT_BOWGUN', 'Heavy Bowgun': 'HEAVY_BOWGUN', 'Bow': 'BOW' };

const ELEMENT = { 'none': ['NO_ELEMENT', 'No Element'], 'no element': ['NO_ELEMENT', 'No Element'],
  'fire': ['FIRE', 'Fire'], 'water': ['WATER', 'Water'], 'thunder': ['THUNDER', 'Thunder'],
  'ice': ['ICE', 'Ice'], 'dragon': ['DRAGON', 'Dragon'], 'poison': ['POISON', 'Poison'],
  'paralysis': ['PARALYSIS', 'Paralysis'], 'paralyse': ['PARALYSIS', 'Paralysis'],
  'paralyze': ['PARALYSIS', 'Paralysis'], 'sleep': ['SLEEP', 'Sleep'], 'blast': ['BLAST', 'Blast'] };

const RECOIL = { 'low': 'RECOIL_SMALL', 'average': 'RECOIL_MEDIUM', 'high': 'RECOIL_LARGE',
  'very high': 'RECOIL_EXTRA_LARGE', 'wyvern': 'RECOIL_WYVERN' };
const RELOAD = { 'fast': 'RELOAD_SMALL', 'normal': 'RELOAD_MEDIUM', 'slow': 'RELOAD_LARGE',
  'very slow': 'RELOAD_EXTRA_LARGE' };
const ARROW = { rapid: 'RAPID', spread: 'SPREAD', pierce: 'PIERCE' };
const STATUS_ELEMENTS = ['BLAST', 'POISON', 'PARALYSIS', 'SLEEP'];
const RANGED = ['Bow', 'Light Bowgun', 'Heavy Bowgun'];

// Constant across the Hope Set; verified against the 12 already loaded.
const HOPE = { attack5: 2251, affinity: 0, element: 'NO_ELEMENT', element_label: 'No Element',
  element_attack: 0, set: 'Hope Set', meleeSkill: { skill: 'Lock On', level: 1 } };

function ammoType(n) {
  n = n.toLowerCase();
  if (n.indexOf('cluster') > -1) return 'CLUSTER';
  if (n.indexOf('pierc') > -1) return 'PIERCING';
  if (n.indexOf('spread') > -1) return 'SPREAD';
  if (n.indexOf('sticky') > -1) return 'STICKY';
  if (n.indexOf('slicing') > -1) return 'SLICING';
  if (n.indexOf('wyvern') > -1) return 'WYVERN';
  return 'NORMAL';
}
function ammoElement(n) {
  n = n.toLowerCase();
  if (/fire|flaming/.test(n)) return 'FIRE';
  if (/water/.test(n)) return 'WATER';
  if (/thunder/.test(n)) return 'THUNDER';
  if (/ice|freeze/.test(n)) return 'ICE';
  if (/dragon/.test(n)) return 'DRAGON';
  if (/poison/.test(n)) return 'POISON';
  if (/sleep/.test(n)) return 'SLEEP';
  if (/paraly/.test(n)) return 'PARALYSIS';
  return 'NO_ELEMENT';
}

// --- tier tables from the source -------------------------------------------
function tiers() {
  const d = JSON.parse(fs.readFileSync(path.join(HERE, 'data.json'), 'utf8'));
  const g = {}; d.weaponGrades.forEach((x) => { g[x.id] = x; });
  const w = {}; d.weapons.forEach((x) => { w[x.id] = x; });
  const lv = {};
  d.weaponLevels.forEach((l) => {
    const gr = g[l.weapon_grade_id]; if (!gr) return;
    const we = w[gr.weapon_id]; if (!we || gr.grade !== we.max_grade) return;
    (lv[we.id] = lv[we.id] || {})[l.level] = l;
  });
  const atk = {}, eleReal = {}, eleStatus = {};
  const atk5 = new Set(), ele5 = new Set();
  Object.keys(lv).forEach((id) => {
    const a = lv[id][1], b = lv[id][5]; if (!a || !b) return;
    atk[a.attack] = b.attack; atk5.add(b.attack);
    if (a.element_attack) {
      const st = STATUS_ELEMENTS.indexOf(w[id].element) >= 0;
      (st ? eleStatus : eleReal)[a.element_attack] = b.element_attack;
      ele5.add(b.element_attack);
    }
  });
  // melody name -> the game's own kind, so manual horns group with the real ones
  const melody = {};
  d.weaponMelodies.forEach((m) => { if (m.kind !== 'MELODY_MANUAL') melody[m.name.toLowerCase()] = m.kind; });

  return { atk, eleReal, eleStatus, atk5, ele5, melody, skills: d.skills.map((s) => s.name) };
}

// --- parsing ---------------------------------------------------------------
function parseValue(raw) {
  const m = String(raw).trim().match(/^([\d.]+)\s*(\(max\))?$/i);
  if (!m) return null;
  return { value: Number(m[1]), isMax: !!m[2] };
}

function parseSkills(raw) {
  return String(raw).split(';').map((s) => s.trim()).filter(Boolean).map((s) => {
    const m = s.match(/^(.*?)\s*\+?\s*Lv\.?\s*(\d+)$/i);
    if (m) return { skill: m[1].trim(), level: Number(m[2]) };
    return { skill: s, level: 1, _levelAssumed: true };
  });
}

function parseLine(line) {
  const parts = line.split('|').map((s) => s.trim());
  const nameField = parts[0];
  const hope = /\(hope\)\s*$/i.test(nameField);
  const name = nameField.replace(/\s*\(hope\)\s*$/i, '').trim();

  const out = { name, hope, warnings: [], attrs: {} };

  // attribute tails can appear anywhere after the fixed fields
  const fixed = [];
  parts.slice(1).forEach((p) => {
    const m = p.match(/^(ammo|arrows|shelling|phial|melodies|kinsect|set|low)\s*:\s*(.*)$/i);
    if (m) out.attrs[m[1].toLowerCase()] = m[2].trim();
    else fixed.push(p);
  });

  if (hope && !fixed.length) return out;                 // pure shorthand

  out.type = fixed[0];
  const eleField = fixed[1] || '';
  const em = eleField.match(/^([A-Za-z ]+?)\s*([\d.]+\s*(?:\(max\))?)?$/);
  if (em) {
    out.elementName = em[1].trim();
    out.element = em[2] ? parseValue(em[2]) : null;
  }
  out.attack = parseValue(fixed[2] || '');
  out.affinity = fixed[3] === undefined || fixed[3] === '' ? null : Number(fixed[3]);
  out.skills = fixed[4] ? parseSkills(fixed[4]) : [];
  return out;
}

// --- build one entry -------------------------------------------------------
function build(parsed, T, M) {
  const warn = parsed.warnings;
  const e = { name: parsed.name };

  const typeLabel = parsed.type || null;
  if (typeLabel && !CATEGORY[typeLabel]) warn.push('unknown weapon type "' + typeLabel + '"');

  if (parsed.hope) {
    e.set = HOPE.set;
    e.element = HOPE.element; e.element_label = HOPE.element_label;
    e.attack = HOPE.attack5; e.element_attack = HOPE.element_attack; e.affinity = HOPE.affinity;
    e.category_label = typeLabel;
    e.low_name = 'Hope ' + parsed.name.split(' ').pop();
    e.skills = parsed.skills && parsed.skills.length ? parsed.skills : null;
    if (!e.skills) {
      if (typeLabel && RANGED.indexOf(typeLabel) >= 0) {
        warn.push('ranged Hope weapon with no skill given — every ranged Hope weapon differs, so this must be stated');
      } else {
        e.skills = [HOPE.meleeSkill];
        e._skillAssumed = true;
      }
    }
    e.estimated = false;
    return e;
  }

  e.category_label = typeLabel;
  const el = ELEMENT[String(parsed.elementName || '').toLowerCase()];
  if (!el) warn.push('unknown element "' + parsed.elementName + '"');
  else { e.element = el[0]; e.element_label = el[1]; }

  // attack
  if (!parsed.attack) warn.push('could not read the attack value');
  else if (parsed.attack.isMax) {
    e.attack = parsed.attack.value;
    if (!T.atk5.has(e.attack)) warn.push('attack ' + e.attack + ' marked (max) is not a known 10-5 tier');
  } else {
    const hit = T.atk[parsed.attack.value];
    if (hit) e.attack = hit;
    else {
      e.attack = Math.round(parsed.attack.value * K_ATTACK);
      e.estimated = true;
      warn.push('10-1 attack ' + parsed.attack.value + ' is not a known tier; 10-5 estimated as ' +
        e.attack + ' (could be out by 1)');
    }
  }

  // element
  e.element_attack = 0;
  if (parsed.element) {
    const status = STATUS_ELEMENTS.indexOf(e.element) >= 0;
    if (parsed.element.isMax) {
      e.element_attack = parsed.element.value;
      if (!T.ele5.has(e.element_attack)) warn.push('element ' + e.element_attack + ' marked (max) is not a known 10-5 tier');
    } else {
      const tbl = status ? T.eleStatus : T.eleReal;
      const hit = tbl[parsed.element.value];
      if (hit) e.element_attack = hit;
      else {
        e.element_attack = parsed.element.value;
        e.estimated = true;
        warn.push('10-1 element ' + parsed.element.value + ' is not a known tier; stored unconverted');
      }
    }
  }

  e.affinity = parsed.affinity === null ? 0 : parsed.affinity;
  if (parsed.affinity === null) warn.push('no affinity given, assuming 0');
  e.skills = parsed.skills;
  e.low_name = parsed.attrs.low || parsed.name;
  e.set = parsed.attrs.set || null;
  if (!e.set) warn.push('no set given — will need one to group it');
  return e;
}

function buildAttrs(parsed, e, warn, T) {
  const A = parsed.attrs;
  if (A.ammo) {
    e.ammo = A.ammo.split(';').map((s) => s.trim()).filter(Boolean).map((s) => {
      const p = s.split('/').map((x) => x.trim());
      if (p.length < 4) { warn.push('ammo entry "' + s + '" is not Name / capacity / recoil / reload'); return null; }
      const rc = RECOIL[p[2].toLowerCase()], rl = RELOAD[p[3].toLowerCase()];
      if (!rc) warn.push('unknown recoil "' + p[2] + '"');
      if (!rl) warn.push('unknown reload "' + p[3] + '"');
      return { ammo_type: ammoType(p[0]), element: ammoElement(p[0]), name: p[0],
        capacity: Number(p[1]), recoil: rc || 'RECOIL_MEDIUM', reload: rl || 'RELOAD_MEDIUM',
        _ingame: p[2] + ' recoil, ' + p[3] + ' reload' };
    }).filter(Boolean);
  }
  if (A.arrows) {
    e.arrows = A.arrows.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
      const m = s.match(/^([A-Za-z]+)\s*(\d)$/);
      if (!m || !ARROW[m[1].toLowerCase()]) { warn.push('arrow "' + s + '" not understood'); return null; }
      const fam = ARROW[m[1].toLowerCase()];
      return { kind: 'ARROW_' + fam + '_0' + m[2], family: fam,
        name: fam.charAt(0) + fam.slice(1).toLowerCase() + ' Lv. ' + m[2] };
    }).filter(Boolean);
  }
  // Insect glaive. The game shows several kinsect attributes on one line; only the
  // words below are understood, and an unrecognised one is reported rather than
  // guessed at, because a wrong enum is worse than a missing one.
  if (A.kinsect) {
    // The game shows four kinsect attributes, in this order:
    //   Kinsect type / Performance type / Attack type / Kinsect bonus
    // These are the display names, read in game and matched against glaives whose
    // enums the source publishes, so they are measured rather than inferred.
    //
    // The enum names do NOT match the display names and in one case invert them:
    // "Harvest Bonus" is EXTEND_ENHANCEMENT, while ENHANCEMENT_HARVEST_UP shows as
    // "Charged Harvest Bonus". Never match these by word similarity.
    const K = { kinsect_attack_type: { flight: 'PIERCE', assist: 'SMASH', powder: 'POWDER' },
      kinsect_parameter_type: { power: 'PARAMETER_TYPE_POWER', rapid: 'PARAMETER_TYPE_QUICK',
        stamina: 'PARAMETER_TYPE_STAMINA' },
      kinsect_attack_attribute: { severing: 'ATTACK_ATTRIBUTE_CUT', blunt: 'ATTACK_ATTRIBUTE_BLUNT' },
      kinsect_bonus_kind: { 'follow-up bonus': 'PIERCE_TYPE_1', 'aerial bonus': 'PIERCE_TYPE_2',
        'stamina bonus': 'POWDER_TYPE_1', 'stun bonus': 'SMASH_TYPE_1', 'assist bonus': 'SMASH_TYPE_2',
        'elemental bonus': 'SMASH_TYPE_3', 'harvest bonus': 'EXTEND_ENHANCEMENT',
        'charged harvest bonus': 'ENHANCEMENT_HARVEST_UP' } };
    A.kinsect.split('/').map((s) => s.trim()).filter(Boolean).forEach((tok) => {
      const key = tok.toLowerCase();
      const field = Object.keys(K).filter((f) => K[f][key])[0];
      if (!field) { warn.push('kinsect attribute "' + tok + '" is not one the source publishes — left unset'); return; }
      if (e[field]) warn.push('two kinsect values map to ' + field + '; keeping "' + e[field] + '"');
      else e[field] = K[field][key];
    });
  }
  if (A.shelling) e.shelling_type = 'SHELLING_' + A.shelling.trim().toUpperCase();
  if (A.phial) e.phial_type = 'PHIAL_' + A.phial.trim().replace(/\s*phial$/i, '').toUpperCase().replace(/\s+/g, '_');
  if (A.melodies) e.melodies = A.melodies.split(',').map((s) => s.trim()).filter(Boolean)
    .map((m) => {
      const kind = T.melody[m.toLowerCase()];
      if (!kind) warn.push('melody "' + m + '" does not match any melody the source publishes — ' +
        'it will not group with the real ones in the filter');
      return { kind: kind || 'MELODY_MANUAL', name: m };
    });
}

// --- main ------------------------------------------------------------------
const lines = [];
const fi = process.argv.indexOf('--file');
if (fi > -1) fs.readFileSync(process.argv[fi + 1], 'utf8').split(/\r?\n/)
  .map((l) => l.trim()).filter((l) => l && l.charAt(0) !== '#').forEach((l) => lines.push(l));
const li = process.argv.indexOf('--line');
if (li > -1) lines.push(process.argv[li + 1]);
if (!lines.length) { console.error('give me --line "..." or --file lines.txt'); process.exit(2); }

const T = tiers();
const M = JSON.parse(fs.readFileSync(MANUAL, 'utf8'));
const knownSkills = new Set(T.skills.concat((M.skills || []).map((s) => s.name)));
const haveNames = new Set(M.weapons.map((w) => w.name));

let added = 0, blocked = 0;
lines.forEach((line) => {
  const parsed = parseLine(line);
  const e = build(parsed, T, M);
  buildAttrs(parsed, e, parsed.warnings, T);

  (e.skills || []).forEach((s) => {
    if (!knownSkills.has(s.skill)) parsed.warnings.push('skill "' + s.skill + '" is not known — add it to manual skills first');
    if (s._levelAssumed) parsed.warnings.push('no level given for "' + s.skill + '", assuming 1');
  });
  if (haveNames.has(e.name)) parsed.warnings.push('already in manual-weapons.json — skipping');

  const blocking = parsed.warnings.filter((x) =>
    /unknown weapon type|unknown element|could not read|must be stated|is not known|already in/.test(x));

  console.log('\n' + e.name + (e.set ? '  [' + e.set + ']' : ''));
  console.log('   ' + String(e.category_label).padEnd(16) + String(e.element_label).padEnd(12) +
    'atk ' + e.attack + (e.estimated ? ' (estimated)' : '') +
    (e.element_attack ? '   ele ' + e.element_attack : '') + '   aff ' + e.affinity);
  console.log('   skills: ' + (e.skills || []).map((s) => s.skill + ' ' + s.level).join(', ') +
    (e._skillAssumed ? '   (assumed, melee Hope default)' : ''));
  if (e.ammo) console.log('   ammo: ' + e.ammo.map((a) => a.name + ' x' + a.capacity).join('; '));
  if (e.arrows) console.log('   arrows: ' + e.arrows.map((a) => a.name).join(', '));
  if (e.shelling_type) console.log('   ' + e.shelling_type);
  if (e.phial_type) console.log('   ' + e.phial_type);
  if (e.melodies) console.log('   melodies: ' + e.melodies.map((m) => m.name).join(', '));
  parsed.warnings.forEach((x) => console.log('   ' + (blocking.indexOf(x) > -1 ? 'BLOCKED' : 'note') + ': ' + x));

  if (blocking.length) { blocked++; return; }
  if (!WRITE) { added++; return; }

  let ser = M.series.filter((s) => s.name === e.set)[0];
  if (!ser) {
    const next = Math.max.apply(null, M.series.map((s) => s.id)) + 1;
    ser = { id: next, kind: 'SERIES_MANUAL_' + String(e.set).toUpperCase().replace(/[^A-Z0-9]+/g, '_'),
      name: e.set, sort_order: 999000000 + next };
    M.series.push(ser);
  }
  const nextGame = Math.max.apply(null, M.weapons.map((w) =>
    Math.max.apply(null, w.grades.map((g) => g.game_weapon_id)))) + 1;

  const rec = {
    kind: 'MANUAL_' + e.name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, ''),
    name: e.name, low_name: e.low_name, series_id: ser.id,
    category: CATEGORY[e.category_label], category_label: e.category_label,
    element: e.element, element_label: e.element_label,
    _source: 'user-supplied: ' + line,
    grades: [{ grade: 10, game_weapon_id: nextGame,
      levels: [{ level: 5, attack: e.attack, element_attack: e.element_attack, affinity: e.affinity }],
      skills: (e.skills || []).map((s) => ({ skill: s.skill, level: s.level })) }],
  };
  if (e.estimated) rec._estimated = 'a 10-1 value was off-table; the 10-5 figure may be out by 1';
  if (e._skillAssumed) rec._assumed = 'skill assumed to be the Hope Set melee default, Lock On 1';
  ['ammo', 'arrows', 'melodies', 'shelling_type', 'phial_type', 'kinsect_attack_type',
    'kinsect_attack_attribute', 'kinsect_parameter_type', 'kinsect_bonus_kind']
    .forEach((k) => { if (e[k]) rec[k] = e[k]; });
  M.weapons.push(rec);
  haveNames.add(e.name);
  added++;
});

if (WRITE && added) {
  fs.writeFileSync(MANUAL, JSON.stringify(M, null, 2), 'utf8');
  console.log('\nwrote ' + added + ' weapon(s) to manual-weapons.json');
} else if (!WRITE) {
  console.log('\n(dry run — ' + added + ' would be added, ' + blocked + ' blocked; pass --write to save)');
} else {
  console.log('\nnothing added; ' + blocked + ' blocked');
}
