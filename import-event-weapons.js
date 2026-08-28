/**
 * Converts the event weapons recorded in MHN.xlsx into manual-weapons.json
 * entries, since the source publishes none of them.
 *
 *   node import-event-weapons.js            print what it would produce
 *   node import-event-weapons.js --write    merge into manual-weapons.json
 *
 * The sheet records weapons at grade 10 LEVEL 1. Every 10-1 stat value in the
 * game maps to exactly one 10-5 value — verified across all 695 source weapons,
 * 46 distinct attack tiers and 29 element tiers with zero ambiguity — so the
 * 10-5 figures here are looked up, not estimated. A value that is off-table is
 * reported and skipped rather than guessed at.
 *
 * Affinity is identical at every level (0 of 695 weapons vary it), so the
 * sheet's affinity carries over unchanged.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const HERE = __dirname;
const WRITE = process.argv.indexOf('--write') > -1;
const SHEET = path.join(HERE, 'MHN.xlsx');
const MANUAL = path.join(HERE, 'manual-weapons.json');

// The sheet's wording -> the source's enum vocabulary. Derived by matching 192
// ammo entries in the sheet against the same entries in the source.
const RECOIL = { 'low': 'RECOIL_SMALL', 'average': 'RECOIL_MEDIUM', 'high': 'RECOIL_LARGE',
  'very high': 'RECOIL_EXTRA_LARGE', 'wyvern': 'RECOIL_WYVERN' };
const RELOAD = { 'fast': 'RELOAD_SMALL', 'normal': 'RELOAD_MEDIUM', 'slow': 'RELOAD_LARGE',
  'very slow': 'RELOAD_EXTRA_LARGE' };

const CATEGORY = { 'Great Sword': 'GREAT_SWORD', 'Long Sword': 'LONG_SWORD',
  'Sword & Shield': 'SWORD_SHIELD', 'Dual Blades': 'DUAL_BLADES', 'Hammer': 'HAMMER',
  'Hunting Horn': 'HUNTING_HORN', 'Lance': 'LANCE', 'Gunlance': 'GUNLANCE',
  'Switch Axe': 'SWITCH_AXE', 'Charge Blade': 'CHARGE_BLADE', 'Insect Glaive': 'INSECT_GLAIVE',
  'Light Bowgun': 'LIGHT_BOWGUN', 'Heavy Bowgun': 'HEAVY_BOWGUN', 'Bow': 'BOW' };

const ELEMENT = { 'No Element': 'NO_ELEMENT', 'None': 'NO_ELEMENT', 'Fire': 'FIRE', 'Water': 'WATER',
  'Thunder': 'THUNDER', 'Ice': 'ICE', 'Dragon': 'DRAGON', 'Poison': 'POISON',
  'Paralysis': 'PARALYSIS', 'Sleep': 'SLEEP', 'Blast': 'BLAST' };

const ARROW_FAMILY = { R: 'RAPID', S: 'SPREAD', P: 'PIERCE' };

// Corrections and additions supplied directly, which win over the sheet.
// Keyed by weapon name.
const OVERRIDES = {
  'Esperanza Bow': {
    _note: 'skill read in game 2026-08-14; the sheet had Lock On, which is a melee skill',
    skills: [{ skill: 'Focus', level: 1 }],
  },
  'Esperanza Cannon': {
    _note: 'read in game at 10-4 by the user, 2026-08-14',
    skills: [{ skill: 'Guard', level: 1 }],
    ammo: [
      { name: 'Pierce Ammo 1', capacity: 6, recoil: 'Average', reload: 'Very slow' },
      { name: 'Sticky Ammo 1', capacity: 4, recoil: 'High', reload: 'Very slow' },
      { name: 'Poison Ammo 1', capacity: 5, recoil: 'Average', reload: 'Slow' },
    ],
  },
};

const raw = (c) => {
  const v = c.value;
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if (v.result !== undefined) return v.result;
    if (v.formula !== undefined) return '';
    if (v.richText) return v.richText.map((t) => t.text).join('');
  }
  return v;
};
const str = (c) => String(raw(c)).trim();

// --- ammo name -> type + element -------------------------------------------
function ammoType(name) {
  const n = name.toLowerCase();
  if (n.indexOf('cluster') > -1) return 'CLUSTER';
  if (n.indexOf('pierc') > -1) return 'PIERCING';
  if (n.indexOf('spread') > -1) return 'SPREAD';
  if (n.indexOf('sticky') > -1) return 'STICKY';
  if (n.indexOf('slicing') > -1) return 'SLICING';
  if (n.indexOf('wyvern') > -1) return 'WYVERN';
  return 'NORMAL';
}
function ammoElement(name) {
  const n = name.toLowerCase();
  if (n.indexOf('fire') > -1 || n.indexOf('flaming') > -1) return 'FIRE';
  if (n.indexOf('water') > -1) return 'WATER';
  if (n.indexOf('thunder') > -1) return 'THUNDER';
  if (n.indexOf('ice') > -1 || n.indexOf('freeze') > -1) return 'ICE';
  if (n.indexOf('dragon') > -1) return 'DRAGON';
  if (n.indexOf('poison') > -1) return 'POISON';
  if (n.indexOf('sleep') > -1) return 'SLEEP';
  if (n.indexOf('paralysis') > -1) return 'PARALYSIS';
  return 'NO_ELEMENT';
}

(async () => {
  const d = JSON.parse(fs.readFileSync(path.join(HERE, 'data.json'), 'utf8'));

  // --- build the 10-1 -> 10-5 lookup from the source --------------------
  const gById = {}; d.weaponGrades.forEach((g) => { gById[g.id] = g; });
  const wById = {}; d.weapons.forEach((w) => { wById[w.id] = w; });
  const lv = {};
  d.weaponLevels.forEach((l) => {
    const g = gById[l.weapon_grade_id]; if (!g) return;
    const w = wById[g.weapon_id]; if (!w || g.grade !== w.max_grade) return;
    (lv[w.id] = lv[w.id] || {})[l.level] = l;
  });
  const atkMap = {}, eleMap = {};
  Object.keys(lv).forEach((id) => {
    const a = lv[id][1], e = lv[id][5]; if (!a || !e) return;
    atkMap[a.attack] = e.attack;
    if (a.element_attack) eleMap[a.element_attack] = e.element_attack;
  });

  // --- read the event weapons out of the sheet ---------------------------
  const srcNames = new Set(d.weapons.map((w) => w.name));
  const srcLow = new Set(d.weapons.map((w) => w.low_name));
  const sn = {}; d.series.forEach((s) => { sn[s.id] = s.name; });
  const slot = new Set(d.weapons.map((w) => sn[w.series_id] + '|' + w.category_label));

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(SHEET);
  const W = wb.getWorksheet('Weapon');

  const found = [], problems = [];
  for (let r = 2; r <= W.rowCount; r++) {
    const n = str(W.getRow(r).getCell(2)); if (!n) continue;
    if (srcNames.has(n) || srcLow.has(n) || srcNames.has(n + '+')) continue;
    const set = str(W.getRow(r).getCell(3)), ty = str(W.getRow(r).getCell(5));
    if (slot.has(set + '|' + ty)) continue;

    const o = OVERRIDES[n] || {};
    const atk1 = Number(str(W.getRow(r).getCell(10)));
    const ele1 = Number(str(W.getRow(r).getCell(12))) || 0;
    const aff = Number(str(W.getRow(r).getCell(11))) || 0;

    // The override supplies a 10-5 figure directly; otherwise look it up.
    const atk5 = atkMap[atk1];
    const ele5 = ele1 ? eleMap[ele1] : 0;
    if (!atk5) { problems.push(n + ': attack ' + atk1 + ' is not a known 10-1 tier'); continue; }
    if (ele1 && !ele5) { problems.push(n + ': element ' + ele1 + ' is not a known 10-1 tier'); continue; }

    const extras = [18, 19, 20, 21].map((c) => str(W.getRow(r).getCell(c))).filter(Boolean);
    const entry = {
      kind: 'MANUAL_' + n.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, ''),
      name: n,
      low_name: str(W.getRow(r).getCell(9)) || n,
      set: set,
      category: CATEGORY[ty],
      category_label: ty,
      element: ELEMENT[str(W.getRow(r).getCell(13))],
      element_label: str(W.getRow(r).getCell(13)) === 'None' ? 'No Element' : str(W.getRow(r).getCell(13)),
      attack: atk5, element_attack: ele5, affinity: aff,
      atk1: atk1, ele1: ele1,
      skills: o.skills || (str(W.getRow(r).getCell(16))
        ? [{ skill: str(W.getRow(r).getCell(16)), level: Number(str(W.getRow(r).getCell(17))) || 1 }] : []),
      extras: extras,
      ammo: o.ammo || null,
      overridden: !!OVERRIDES[n],
    };
    if (!entry.category) problems.push(n + ': unknown weapon type "' + ty + '"');
    if (!entry.element) problems.push(n + ': unknown element "' + str(W.getRow(r).getCell(13)) + '"');
    found.push(entry);
  }

  // --- parse the sheet's per-type attribute slots ------------------------
  found.forEach((e) => {
    if (!e.ammo) {
      const ammo = [];
      e.extras.forEach((x) => {
        const p = x.split(/\s+-\s+/).map((s) => s.trim());
        if (p.length < 4) return;
        ammo.push({ name: p[0], capacity: Number(p[1]), recoil: p[2], reload: p[3] });
      });
      if (ammo.length) e.ammo = ammo;
    }
    // shelling / phial / melodies / arrows from the remaining slots
    e.shelling = null; e.phial = null; e.melodies = []; e.arrows = null;
    e.extras.forEach((x) => {
      if (/^(Normal|Wide|Long)$/i.test(x)) e.shelling = 'SHELLING_' + x.toUpperCase();
      else if (/phial$/i.test(x)) e.phial = 'PHIAL_' + x.replace(/\s*phial$/i, '').trim().toUpperCase();
      else if (/^[RSP]( [RSP])+$/.test(x)) e.arrowFamilies = x.split(/\s+/);
      else if (/^[1-4]( [1-4])+$/.test(x)) e.arrowLevels = x.split(/\s+/).map(Number);
      else if (!/\s-\s/.test(x)) e.melodies.push(x);
    });
    if (e.arrowFamilies && e.arrowLevels && e.arrowFamilies.length === e.arrowLevels.length) {
      e.arrows = e.arrowFamilies.map((f, i) => {
        const fam = ARROW_FAMILY[f];
        const n = String(e.arrowLevels[i]);
        return { kind: 'ARROW_' + fam + '_0' + n, family: fam,
          name: fam.charAt(0) + fam.slice(1).toLowerCase() + ' Lv. ' + n };
      });
    }
  });

  // --- report ------------------------------------------------------------
  console.log('event weapons converted: ' + found.length);
  if (problems.length) {
    console.log('\nNOT converted (' + problems.length + ') — off-table, need the 10-5 value read in game:');
    problems.forEach((p) => console.log('   ' + p));
  }
  console.log('');
  found.forEach((e) => {
    console.log('  ' + e.name.padEnd(24) + e.category_label.padEnd(16) + e.element_label.padEnd(11) +
      ('atk ' + e.atk1 + '->' + e.attack).padEnd(18) +
      (e.ele1 ? ('ele ' + e.ele1 + '->' + e.element_attack).padEnd(18) : ''.padEnd(18)) +
      ('aff ' + e.affinity).padEnd(8) +
      e.skills.map((s) => s.skill + ' ' + s.level).join(', ') +
      (e.overridden ? '   [override]' : ''));
    const bits = [];
    if (e.ammo) bits.push('ammo x' + e.ammo.length);
    if (e.shelling) bits.push(e.shelling);
    if (e.phial) bits.push(e.phial);
    if (e.arrows) bits.push('arrows ' + e.arrows.map((a) => a.name).join('/'));
    if (e.melodies.length) bits.push('melodies ' + e.melodies.join(', '));
    if (bits.length) console.log('        ' + bits.join('  |  '));
  });

  if (!WRITE) { console.log('\n(dry run — pass --write to merge into manual-weapons.json)'); return; }

  // --- merge -------------------------------------------------------------
  const M = JSON.parse(fs.readFileSync(MANUAL, 'utf8'));
  const haveSeries = {};
  M.series.forEach((s) => { haveSeries[s.name] = s.id; });
  let nextSeriesId = Math.max.apply(null, M.series.map((s) => s.id)) + 1;
  let nextGameId = Math.max.apply(null, M.weapons.map((w) =>
    Math.max.apply(null, w.grades.map((g) => g.game_weapon_id)))) + 1;
  const haveKinds = {};
  M.weapons.forEach((w) => { haveKinds[w.kind] = true; });

  let added = 0;
  found.forEach((e) => {
    if (haveKinds[e.kind]) return;
    if (!haveSeries[e.set]) {
      M.series.push({ id: nextSeriesId, kind: 'SERIES_MANUAL_' + e.set.toUpperCase().replace(/[^A-Z0-9]+/g, '_'),
        name: e.set, sort_order: 999000000 + nextSeriesId });
      haveSeries[e.set] = nextSeriesId;
      nextSeriesId++;
    }
    const w = {
      kind: e.kind, name: e.name, low_name: e.low_name,
      series_id: haveSeries[e.set],
      category: e.category, category_label: e.category_label,
      element: e.element, element_label: e.element_label,
      _source: 'MHN.xlsx event weapon; 10-5 stats looked up from the 10-1 the sheet records'
        + (e.overridden ? '; ' + OVERRIDES[e.name]._note : ''),
      grades: [{ grade: 10, game_weapon_id: nextGameId++,
        levels: [{ level: 5, attack: e.attack, element_attack: e.element_attack, affinity: e.affinity }],
        skills: e.skills }],
    };
    if (e.shelling) w.shelling_type = e.shelling;
    if (e.phial) w.phial_type = e.phial;
    if (e.ammo) {
      w.ammo = e.ammo.map((a) => ({
        ammo_type: ammoType(a.name), element: ammoElement(a.name), name: a.name,
        capacity: a.capacity,
        recoil: RECOIL[String(a.recoil).toLowerCase()] || 'RECOIL_MEDIUM',
        reload: RELOAD[String(a.reload).toLowerCase()] || 'RELOAD_MEDIUM',
      }));
    }
    if (e.arrows) w.arrows = e.arrows;
    if (e.melodies.length) w.melodies = e.melodies.map((m) => ({ kind: 'MELODY_MANUAL', name: m }));
    M.weapons.push(w);
    added++;
  });

  fs.writeFileSync(MANUAL, JSON.stringify(M, null, 2), 'utf8');
  console.log('\nmerged ' + added + ' weapon(s) into manual-weapons.json');
})().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
