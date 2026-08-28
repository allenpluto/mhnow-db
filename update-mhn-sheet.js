/**
 * Updates the hand-built MHN.xlsx with current data, keeping its layout.
 *
 *   node update-mhn-sheet.js [in.xlsx] [out.xlsx]
 *   defaults: MHN.xlsx -> MHN-updated.xlsx
 *
 * It NEVER writes over the input. The original is left untouched.
 *
 * WHAT IT TOUCHES
 *   Monster          append monsters whose armour exists but which are absent
 *   Skill            refresh max_level + Lv1..Lv5 text, add new skills, re-sort
 *   Equipment        refresh skill_slot, add new armour, apply source renames
 *   Equipment_Skill  refresh levels, add rows for new armour, mirror renames
 *
 * WHAT IT DELIBERATELY DOES NOT TOUCH
 *   Weapon columns R..U — R is a second skill, S/T/U are the sheet's own
 *   per-type attribute slots (horn melodies, bowgun ammo, shelling, phials).
 *   Everything this script adds to that sheet goes in V..AA. An earlier
 *   version wrote over R..U and destroyed 566 values; the guard in the Weapon
 *   section now refuses to run if the destination range is occupied.
 *   Weapon_Filtered — a hand-filtered subset whose rule is not recorded
 *   anywhere, so it is left exactly as found.
 *
 * WHAT IT PRESERVES
 *   Rows the official source does not carry — event gear (Jack-o'-Head, the
 *   Swimmer set, ...) and event skills (MrBeast Challenge!, Eggsplosive, ...).
 *   Those are real entries in this workbook that simply are not published, so
 *   they are kept, never overwritten and never deleted.
 *
 * Column meanings were verified against the data before writing, not assumed:
 *   Equipment.skill_slot      = driftsmelt slots at max grade (295/297 matched)
 *   Equipment_Skill col D     = the skill's level on that piece (483 matched)
 *
 * ORDERING
 * The workbook is ordered by in-game display order, which no data source
 * exposes. So the monster order is derived from the order already in the
 * workbook, with explicit edits declared in MONSTER_ORDER_EDITS below. Adding
 * a monster later means adding one line there, not re-typing the list.
 *
 * Equipment (and Equipment_Skill, which is derived from it) is then sorted to
 * follow that monster order, in three bands, matching how the sheet is already
 * arranged:
 *   1. sets with no monster that the source knows about  (Leather, Alloy)
 *   2. monster sets, in monster order, then Helm/Mail/Vambraces/Coil/Greaves
 *   3. event sets the source does not publish            (Halloween, Swimmer)
 * Band 3 stays last even though Bunny Head and Swimmer are attributed to
 * Lagombi and Arzuros — they are event gear, not part of those monsters' sets.
 *
 * Ids in Monster, Equipment and Equipment_Skill are renumbered 1..N after
 * sorting. Nothing keys off them: every cross-sheet formula is a VLOOKUP on a
 * name, so renumbering is safe.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const zlib = require('zlib');
const ExcelJS = require('exceljs');

const HERE = __dirname;
const IN = process.argv[2] || path.join(HERE, 'MHN.xlsx');
const OUT = process.argv[3] || path.join(HERE, 'MHN-updated.xlsx');

if (path.resolve(IN) === path.resolve(OUT)) {
  console.error('refusing to overwrite the input workbook');
  process.exit(2);
}

const BODY_PART = { HEAD: 'Helm', CHEST: 'Mail', ARMS: 'Vambraces', TORSO: 'Coil', LEGS: 'Greaves' };
const PART_ORDER = ['Helm', 'Mail', 'Vambraces', 'Coil', 'Greaves'];

// Columns this script ADDS to the Weapon sheet.
//
// The sheet's own columns run A..Q, and R..U are the user's: R is a second
// skill, S/T/U are the per-type attribute slots (hunting horn melodies,
// bowgun ammo, shelling, phials). Writing anything there destroys real data —
// which is exactly what an earlier version of this script did. Additions
// therefore start at V, and assertNoClobber() below refuses to run if the
// input already has content in the range.
const WCOL = {
  atk82: 22,        // V
  aff82: 23,        // W
  ele82: 24,        // X
  style: 25,        // Y
  ammoTypes: 26,    // Z
  attrs: 27,        // AA
};
const WCOL_FIRST = 22;
const WCOL_LAST = 27;

// Ammo the source types NORMAL but which is really status ammo; it gains
// nothing from Normal Ammo Boost, so it is reported separately.
const STATUS_AMMO_ELEMENTS = ['POISON', 'SLEEP', 'PARALYSIS'];

// Names the workbook got wrong. Applied to the Monster sheet AND to
// Equipment.monster_name, so the VLOOKUP keeps resolving.
const MONSTER_RENAMES = {
  'Golden Rathian': 'Gold Rathian',
};

// In-game display order, expressed as edits to the order already in the
// workbook. `after` places a monster immediately after another; `append` puts
// it at the end, in the order listed.
const MONSTER_ORDER_EDITS = {
  after: [
    ['Tobi-Kadachi', 'Viper Tobi-Kadachi'],
    ['Zinogre', 'Stygian Zinogre'],
  ],
  append: [
    'Quematrice', 'Goss Harag', 'Astalos', 'Almudron',
    'Seregios', 'Shogun Ceanataur', 'Velkhana',
  ],
};

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) mhnow-db/2.0';
function get(p) {
  return new Promise((res, rej) => {
    https.get({ host: 'monsterhunternow.com', path: p, headers: { 'User-Agent': UA, 'Accept-Encoding': 'gzip' } }, (r) => {
      if (r.statusCode !== 200) { r.resume(); return rej(new Error(r.statusCode + ' fetching ' + p)); }
      const s = r.headers['content-encoding'] === 'gzip' ? r.pipe(zlib.createGunzip()) : r;
      const c = [];
      s.on('data', (x) => c.push(x));
      s.on('end', () => res(Buffer.concat(c).toString('utf8')));
      s.on('error', rej);
    }).on('error', rej);
  });
}
const un = (s) => s.replace(/&quot;/g, '"').replace(/&#(\d+);/g, (m, n) => String.fromCharCode(Number(n)))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
function props(html) {
  const re = /props="([^"]*)"/g; let m, b = '';
  while ((m = re.exec(html)) !== null) if (m[1].length > b.length) b = m[1];
  if (!b) throw new Error('no payload on page — site layout changed');
  return JSON.parse(un(b));
}

const raw = (c) => {
  const v = c.value;
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if (v.result !== undefined) return v.result;
    if (v.formula !== undefined) return '';
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if (v.text) return v.text;
  }
  return v;
};
const str = (c) => String(raw(c) === null ? '' : raw(c)).trim();

const colLetter = (n) => {
  let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; }
  return s;
};

const report = [];
const say = (s) => { report.push(s); console.log(s); };

async function main() {
  // ---- current data ------------------------------------------------------
  const d = JSON.parse(fs.readFileSync(path.join(HERE, 'data.json'), 'utf8'));

  const skillById = {}; d.skills.forEach((s) => { skillById[s.id] = s; });
  const armorById = {}; d.armor.forEach((a) => { armorById[a.id] = a; });
  const gradeById = {}; d.grades.forEach((g) => { gradeById[g.id] = g; });
  const seriesById = {}; d.series.forEach((s) => { seriesById[s.id] = s; });

  const levelsBySkill = {};
  d.skillLevels.forEach((l) => { (levelsBySkill[l.skill_id] = levelsBySkill[l.skill_id] || [])[l.level - 1] = l.description; });

  // armour at max grade: skills (in payload order) and driftsmelt slots
  const skillsOf = {}, slotsOf = {};
  d.gradeSkills.forEach((gs) => {
    const g = gradeById[gs.armor_grade_id], a = armorById[g.armor_id];
    if (g.grade !== a.max_grade) return;
    (skillsOf[a.name] = skillsOf[a.name] || []).push({ skill: skillById[gs.skill_id].name, level: gs.level });
  });
  d.grades.forEach((g) => { const a = armorById[g.armor_id]; if (g.grade === a.max_grade) slotsOf[a.name] = g.driftsmelt_slots; });

  // series -> monster display name, from the live payload
  const P = props(await get('/en/armor'));
  const T = P.guideTranslations;
  const norm = (x) => String(x).toLowerCase().replace(/[^a-z0-9]/g, '');
  const monsterKeyByNorm = {};
  Object.keys(P.monsters).forEach((k) => { monsterKeyByNorm[norm(k)] = k; });

  const monsterOfSeriesKind = {};
  Object.keys(P.series).forEach((k) => {
    const s = P.series[k];
    const mk = monsterKeyByNorm[norm(s.series.replace(/^SERIES_/, ''))];
    if (mk) monsterOfSeriesKind[s.series] = T['MONSTER_NAME_' + mk.toUpperCase()] || null;
  });

  const monsterOfArmour = {};
  d.armor.forEach((a) => {
    const s = seriesById[a.series_id];
    monsterOfArmour[a.name] = (s && monsterOfSeriesKind[s.kind]) || '';
  });
  const seriesNameOfArmour = {};
  d.armor.forEach((a) => { seriesNameOfArmour[a.name] = (seriesById[a.series_id] || {}).name || ''; });

  // ---- workbook ----------------------------------------------------------
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(IN);

  const shMon = wb.getWorksheet('Monster');
  const shEq = wb.getWorksheet('Equipment');
  const shSk = wb.getWorksheet('Skill');
  const shEs = wb.getWorksheet('Equipment_Skill');

  // Existing armour names, and the source's current names, to spot renames.
  const sheetArmour = new Map();  // name -> row
  for (let r = 2; r <= shEq.rowCount; r++) {
    const n = str(shEq.getRow(r).getCell(2));
    if (n) sheetArmour.set(n, r);
  }
  const currentNames = new Set(d.armor.map((a) => a.name));

  // A rename is a piece that vanished from the source but whose set+slot has
  // exactly one new name. Matching on set + body part avoids guessing.
  const renames = new Map();
  const gone = [...sheetArmour.keys()].filter((n) => !currentNames.has(n));
  const unmatched = d.armor.filter((a) => !sheetArmour.has(a.name));
  gone.forEach((oldName) => {
    const row = shEq.getRow(sheetArmour.get(oldName));
    const set = str(row.getCell(3)), part = str(row.getCell(4));
    const cands = unmatched.filter((a) => seriesNameOfArmour[a.name] === set && BODY_PART[a.slot] === part);
    if (cands.length === 1) renames.set(oldName, cands[0].name);
  });

  // ---- monster name corrections, before anything keys off them ------------
  for (let r = 2; r <= shMon.rowCount; r++) {
    const c = shMon.getRow(r).getCell(2);
    const n = str(c);
    if (MONSTER_RENAMES[n]) {
      c.value = MONSTER_RENAMES[n];
      shMon.getRow(r).commit();
      say('  Monster ~ renamed "' + n + '" -> "' + MONSTER_RENAMES[n] + '"');
    }
  }
  // Align Equipment.monster_name with the source for every set the source
  // knows. This fixes rows whose monster_name never matched a monster at all
  // (Kaiser Set said "Kaiser", so its monster_id VLOOKUP resolved to 0).
  // Event sets are not source series, so they are left alone.
  const monsterOfSeriesName = {};
  d.series.forEach((s) => {
    if (monsterOfSeriesKind[s.kind]) monsterOfSeriesName[s.name] = monsterOfSeriesKind[s.kind];
  });
  let mnFixed = 0;
  for (let r = 2; r <= shEq.rowCount; r++) {
    const row = shEq.getRow(r);
    if (!str(row.getCell(2))) continue;
    const set = str(row.getCell(3));
    const want = monsterOfSeriesName[set];
    if (!want) continue;
    const have = str(row.getCell(6));
    if (have !== want) {
      if (mnFixed === 0 || have !== '') say('  Equipment ~ ' + set + ' monster_name "' + have + '" -> "' + want + '"');
      row.getCell(6).value = want;
      row.commit();
      mnFixed++;
    }
  }
  if (mnFixed) say('  Equipment: ' + mnFixed + ' monster_name cells aligned with the source');

  // ---- Monster: append missing --------------------------------------------
  let monIds = [];
  const sheetMonsters = new Set();
  for (let r = 2; r <= shMon.rowCount; r++) {
    const n = str(shMon.getRow(r).getCell(2));
    if (n) { sheetMonsters.add(n); const id = Number(raw(shMon.getRow(r).getCell(1))); if (id) monIds.push(id); }
  }
  let lastMonRow = 1;
  for (let r = 2; r <= shMon.rowCount; r++) if (str(shMon.getRow(r).getCell(2))) lastMonRow = r;

  const neededMonsters = [];
  d.armor.forEach((a) => {
    const m = monsterOfArmour[a.name];
    if (m && !sheetMonsters.has(m) && neededMonsters.indexOf(m) < 0) neededMonsters.push(m);
  });

  let nextMonId = monIds.length ? Math.max.apply(null, monIds) + 1 : 1;
  neededMonsters.forEach((m) => {
    const pieces = d.armor.filter((a) => monsterOfArmour[a.name] === m);
    const seriesName = pieces.length ? seriesNameOfArmour[pieces[0].name] : m;
    const setPrefix = seriesName.replace(/\s+Set$/, '');
    // equipment_prefix = the words shared by every piece name in the series
    const words = pieces.map((p) => p.name.split(' ').slice(0, -1).join(' '));
    const eqPrefix = words.sort((a, b) => a.length - b.length)[0] || setPrefix;

    const r = ++lastMonRow;
    const row = shMon.getRow(r);
    row.getCell(1).value = nextMonId;
    row.getCell(2).value = m;
    row.getCell(3).value = setPrefix;
    row.getCell(4).value = eqPrefix;
    row.getCell(5).value = { formula: '$A' + r };
    for (let c = 1; c <= 5; c++) row.getCell(c).style = shMon.getRow(2).getCell(c).style;
    row.commit();
    say('  Monster + ' + m + ' (id ' + nextMonId + ', set_prefix "' + setPrefix + '", equipment_prefix "' + eqPrefix + '")');
    nextMonId++;
  });
  if (!neededMonsters.length) say('  Monster: nothing to add');

  // ---- Skill: refresh, add, keep event skills, re-sort ---------------------
  const bySkillName = {};
  d.skills.forEach((s) => { bySkillName[s.name] = s; });

  const existing = [];
  for (let r = 2; r <= shSk.rowCount; r++) {
    const n = str(shSk.getRow(r).getCell(2));
    if (!n) continue;
    const lv = [];
    for (let c = 5; c <= 9; c++) lv.push(str(shSk.getRow(r).getCell(c)));
    existing.push({ name: n, max: raw(shSk.getRow(r).getCell(3)), levels: lv, fromSource: !!bySkillName[n] });
  }
  const existingNames = new Set(existing.map((e) => e.name));

  let skAdded = 0, skChanged = 0;
  const merged = existing.map((e) => {
    const s = bySkillName[e.name];
    if (!s) return e;                                  // event skill — keep verbatim
    const lv = [];
    for (let i = 0; i < 5; i++) lv.push((levelsBySkill[s.id] || [])[i] || '');
    const changed = Number(e.max) !== s.max_level || lv.join(' ') !== e.levels.join(' ');
    if (changed) skChanged++;
    return { name: e.name, max: s.max_level, levels: lv, fromSource: true };
  });
  d.skills.forEach((s) => {
    if (existingNames.has(s.name)) return;
    const lv = [];
    for (let i = 0; i < 5; i++) lv.push((levelsBySkill[s.id] || [])[i] || '');
    merged.push({ name: s.name, max: s.max_level, levels: lv, fromSource: true });
    skAdded++;
  });
  merged.sort((a, b) => a.name.localeCompare(b.name));

  const skStyleRow = shSk.getRow(2);
  merged.forEach((m, i) => {
    const r = 2 + i;
    const row = shSk.getRow(r);
    row.getCell(2).value = m.name;
    row.getCell(3).value = m.max === '' ? null : Number(m.max);
    for (let c = 5; c <= 9; c++) row.getCell(c).value = m.levels[c - 5] || null;
    for (let c = 1; c <= 9; c++) if (!row.getCell(c).style || r > existing.length + 1) row.getCell(c).style = skStyleRow.getCell(c).style;
    row.commit();
  });
  for (let r = 2 + merged.length; r <= shSk.rowCount; r++) {
    const row = shSk.getRow(r);
    for (let c = 1; c <= 9; c++) row.getCell(c).value = null;
    row.commit();
  }
  say('  Skill: ' + skAdded + ' added, ' + skChanged + ' refreshed, ' +
      merged.filter((m) => !m.fromSource).length + ' event skills preserved, ' + merged.length + ' rows total');

  // ---- Equipment: renames, skill_slot, append new --------------------------
  let eqIds = [];
  let lastEqRow = 1;
  for (let r = 2; r <= shEq.rowCount; r++) {
    if (str(shEq.getRow(r).getCell(2))) {
      lastEqRow = r;
      const id = Number(raw(shEq.getRow(r).getCell(1)));
      if (id) eqIds.push(id);
    }
  }
  let slotFixed = 0, renamed = 0;
  for (let r = 2; r <= shEq.rowCount; r++) {
    const row = shEq.getRow(r);
    let n = str(row.getCell(2));
    if (!n) continue;
    if (renames.has(n)) {
      const nn = renames.get(n);
      row.getCell(2).value = nn;
      row.getCell(5).value = nn.split(' ').pop();
      say('  Equipment ~ renamed "' + n + '" -> "' + nn + '"');
      n = nn; renamed++;
    }
    if (slotsOf[n] !== undefined && Number(raw(row.getCell(8))) !== slotsOf[n]) {
      say('  Equipment ~ ' + n + ' skill_slot ' + raw(row.getCell(8)) + ' -> ' + slotsOf[n]);
      row.getCell(8).value = slotsOf[n];
      slotFixed++;
    }
    row.commit();
  }

  let nextEqId = eqIds.length ? Math.max.apply(null, eqIds) + 1 : 1;
  const eqStyle = shEq.getRow(2);
  const nowInSheet = new Set();
  for (let r = 2; r <= shEq.rowCount; r++) { const n = str(shEq.getRow(r).getCell(2)); if (n) nowInSheet.add(n); }

  const toAdd = d.armor.filter((a) => !nowInSheet.has(a.name))
    .sort((a, b) => (seriesNameOfArmour[a.name] || '').localeCompare(seriesNameOfArmour[b.name] || '') ||
                    ['HEAD', 'CHEST', 'ARMS', 'TORSO', 'LEGS'].indexOf(a.slot) - ['HEAD', 'CHEST', 'ARMS', 'TORSO', 'LEGS'].indexOf(b.slot));

  toAdd.forEach((a) => {
    const r = ++lastEqRow;
    const row = shEq.getRow(r);
    row.getCell(1).value = nextEqId;
    row.getCell(2).value = a.name;
    row.getCell(3).value = seriesNameOfArmour[a.name];
    row.getCell(4).value = BODY_PART[a.slot];
    row.getCell(5).value = a.name.split(' ').pop();
    row.getCell(6).value = monsterOfArmour[a.name] || null;
    row.getCell(7).value = { formula: 'IF(ISNA(VLOOKUP(F' + r + ',Monster!B:E,4,FALSE)),0,VLOOKUP(F' + r + ',Monster!B:E,4,FALSE))' };
    row.getCell(8).value = slotsOf[a.name] === undefined ? null : slotsOf[a.name];
    row.getCell(14).value = { formula: '$A' + r };
    for (let c = 1; c <= 14; c++) row.getCell(c).style = eqStyle.getCell(c).style;
    row.commit();
    nextEqId++;
  });
  say('  Equipment: ' + toAdd.length + ' added, ' + renamed + ' renamed, ' + slotFixed + ' skill_slot fixed');

  // ---- Equipment_Skill: renames, levels, append ---------------------------
  let esIds = [], lastEsRow = 1;
  const seen = new Set();
  let lvFixed = 0, esRenamed = 0;
  for (let r = 2; r <= shEs.rowCount; r++) {
    const row = shEs.getRow(r);
    let en = str(row.getCell(2));
    const sn = str(row.getCell(3));
    if (!en || !sn) continue;
    lastEsRow = r;
    const id = Number(raw(row.getCell(1)));
    if (id) esIds.push(id);
    if (renames.has(en)) { en = renames.get(en); row.getCell(2).value = en; esRenamed++; }
    seen.add(en + '|' + sn);
    const ours = (skillsOf[en] || []).find((x) => x.skill === sn);
    if (ours && Number(raw(row.getCell(4))) !== ours.level) {
      row.getCell(4).value = ours.level;
      lvFixed++;
    }
    row.commit();
  }

  let nextEsId = esIds.length ? Math.max.apply(null, esIds) + 1 : 1;
  const esStyle = shEs.getRow(2);
  let esAdded = 0;
  d.armor.forEach((a) => {
    (skillsOf[a.name] || []).forEach((e) => {
      if (seen.has(a.name + '|' + e.skill)) return;
      const r = ++lastEsRow;
      const row = shEs.getRow(r);
      row.getCell(1).value = nextEsId++;
      row.getCell(2).value = a.name;
      row.getCell(3).value = e.skill;
      row.getCell(4).value = e.level;
      row.getCell(5).value = { formula: 'VLOOKUP(C' + r + ',Skill!B:C,2,FALSE)' };
      row.getCell(6).value = { formula: 'VLOOKUP(B' + r + ',Equipment!B:N,3,FALSE)' };
      for (let c = 1; c <= 6; c++) row.getCell(c).style = esStyle.getCell(c).style;
      row.commit();
      esAdded++;
    });
  });
  say('  Equipment_Skill: ' + esAdded + ' added, ' + lvFixed + ' levels updated, ' + esRenamed + ' renamed');

  // ---- reorder everything to in-game display order -------------------------

  // Monster: take the order already in the sheet, then apply the declared edits.
  const monRows = [];
  for (let r = 2; r <= shMon.rowCount; r++) {
    const n = str(shMon.getRow(r).getCell(2));
    if (!n) continue;
    monRows.push({ name: n, setPrefix: str(shMon.getRow(r).getCell(3)), eqPrefix: str(shMon.getRow(r).getCell(4)) });
  }
  const monByName = {};
  monRows.forEach((m) => { monByName[m.name] = m; });

  const order = monRows.map((m) => m.name);
  const move = (name, toIndex) => {
    const j = order.indexOf(name);
    if (j > -1) order.splice(j, 1);
    if (toIndex === null) order.push(name);
    else order.splice(toIndex, 0, name);
  };
  MONSTER_ORDER_EDITS.after.forEach((pair) => {
    const anchor = pair[0], name = pair[1];
    if (!monByName[name]) { say('  WARNING order edit skipped, no such monster: ' + name); return; }
    const j = order.indexOf(name);
    if (j > -1) order.splice(j, 1);
    const k = order.indexOf(anchor);
    if (k < 0) { say('  WARNING anchor not found: ' + anchor + ' — ' + name + ' left at end'); order.push(name); }
    else order.splice(k + 1, 0, name);
  });
  MONSTER_ORDER_EDITS.append.forEach((name) => {
    if (!monByName[name]) { say('  WARNING order edit skipped, no such monster: ' + name); return; }
    move(name, null);
  });

  const monStyle = [];
  for (let c = 1; c <= 5; c++) monStyle.push(shMon.getRow(2).getCell(c).style);
  order.forEach((name, i) => {
    const r = 2 + i;
    const row = shMon.getRow(r);
    const m = monByName[name];
    row.getCell(1).value = i + 1;
    row.getCell(2).value = m.name;
    row.getCell(3).value = m.setPrefix || null;
    row.getCell(4).value = m.eqPrefix || null;
    row.getCell(5).value = { formula: '$A' + r };
    for (let c = 1; c <= 5; c++) row.getCell(c).style = monStyle[c - 1];
    row.commit();
  });
  for (let r = 2 + order.length; r <= shMon.rowCount; r++) {
    const row = shMon.getRow(r);
    for (let c = 1; c <= 5; c++) row.getCell(c).value = null;
    row.commit();
  }
  const monIndex = {};
  order.forEach((n, i) => { monIndex[n] = i; });
  say('\n  Monster: reordered to display order, ids renumbered 1..' + order.length);

  // Equipment: three bands, monster order inside band 2.
  const sourceSets = new Set(d.series.map((s) => s.name));
  const eqRows = [];
  for (let r = 2; r <= shEq.rowCount; r++) {
    const n = str(shEq.getRow(r).getCell(2));
    if (!n) continue;
    const vals = [];
    for (let c = 1; c <= 14; c++) vals.push(shEq.getRow(r).getCell(c).value);
    const set = str(shEq.getRow(r).getCell(3));
    const monster = monsterOfSeriesName[set];
    eqRows.push({
      name: n, set: set, part: str(shEq.getRow(r).getCell(4)), vals: vals,
      band: !sourceSets.has(set) ? 3 : (monster ? 2 : 1),
      mon: monster ? (monIndex[monster] === undefined ? 9999 : monIndex[monster]) : -1,
      seq: eqRows.length,
    });
  }
  eqRows.forEach((e) => {
    if (e.band === 2 && e.mon === 9999) say('  WARNING no monster order for set ' + e.set);
  });
  eqRows.sort((a, b) =>
    a.band - b.band ||
    (a.band === 2 ? (a.mon - b.mon || PART_ORDER.indexOf(a.part) - PART_ORDER.indexOf(b.part)) : 0) ||
    a.seq - b.seq);

  const eqStyle2 = [];
  for (let c = 1; c <= 14; c++) eqStyle2.push(shEq.getRow(2).getCell(c).style);
  eqRows.forEach((e, i) => {
    const r = 2 + i;
    const row = shEq.getRow(r);
    for (let c = 1; c <= 14; c++) row.getCell(c).value = e.vals[c - 1] === undefined ? null : e.vals[c - 1];
    row.getCell(1).value = i + 1;
    row.getCell(7).value = { formula: 'IF(ISNA(VLOOKUP(F' + r + ',Monster!B:E,4,FALSE)),0,VLOOKUP(F' + r + ',Monster!B:E,4,FALSE))' };
    row.getCell(14).value = { formula: '$A' + r };
    for (let c = 1; c <= 14; c++) row.getCell(c).style = eqStyle2[c - 1];
    row.commit();
  });
  for (let r = 2 + eqRows.length; r <= shEq.rowCount; r++) {
    const row = shEq.getRow(r);
    for (let c = 1; c <= 14; c++) row.getCell(c).value = null;
    row.commit();
  }
  const eqIndex = {};
  eqRows.forEach((e, i) => { eqIndex[e.name] = i; });
  say('  Equipment: reordered (' + eqRows.filter((e) => e.band === 1).length + ' starter, ' +
      eqRows.filter((e) => e.band === 2).length + ' monster, ' +
      eqRows.filter((e) => e.band === 3).length + ' event), ids renumbered 1..' + eqRows.length);

  // Equipment_Skill follows Equipment, each piece's skills kept together.
  const esRows = [];
  for (let r = 2; r <= shEs.rowCount; r++) {
    const en = str(shEs.getRow(r).getCell(2)), sn = str(shEs.getRow(r).getCell(3));
    if (!en || !sn) continue;
    esRows.push({ en: en, sn: sn, lv: shEs.getRow(r).getCell(4).value, seq: esRows.length });
  }
  esRows.sort((a, b) => {
    const ia = eqIndex[a.en] === undefined ? 99999 : eqIndex[a.en];
    const ib = eqIndex[b.en] === undefined ? 99999 : eqIndex[b.en];
    return ia - ib || a.seq - b.seq;
  });
  const esStyle2 = [];
  for (let c = 1; c <= 6; c++) esStyle2.push(shEs.getRow(2).getCell(c).style);
  esRows.forEach((e, i) => {
    const r = 2 + i;
    const row = shEs.getRow(r);
    row.getCell(1).value = i + 1;
    row.getCell(2).value = e.en;
    row.getCell(3).value = e.sn;
    row.getCell(4).value = e.lv;
    row.getCell(5).value = { formula: 'VLOOKUP(C' + r + ',Skill!B:C,2,FALSE)' };
    row.getCell(6).value = { formula: 'VLOOKUP(B' + r + ',Equipment!B:N,3,FALSE)' };
    for (let c = 1; c <= 6; c++) row.getCell(c).style = esStyle2[c - 1];
    row.commit();
  });
  for (let r = 2 + esRows.length; r <= shEs.rowCount; r++) {
    const row = shEs.getRow(r);
    for (let c = 1; c <= 6; c++) row.getCell(c).value = null;
    row.commit();
  }
  say('  Equipment_Skill: reordered to follow Equipment, ids renumbered 1..' + esRows.length);

  // ---- Weapon sheet --------------------------------------------------------
  // Their stat columns J/K/L held grade 10 LEVEL 1 values. They are rewritten
  // as 10-5 (fully maxed), which is the state that matters and the one the
  // sheet's own damage formula in column O should be computing from. The 8-2
  // state is added alongside in new columns rather than replacing anything.
  const shWp = wb.getWorksheet('Weapon');

  const seriesNameById = {};
  d.series.forEach((s) => { seriesNameById[s.id] = s.name; });
  const monsterOfSeriesId = {};
  d.series.forEach((s) => { if (monsterOfSeriesKind[s.kind]) monsterOfSeriesId[s.id] = monsterOfSeriesKind[s.kind]; });
  const skillNameById = {};
  d.skills.forEach((s) => { skillNameById[s.id] = s.name; });
  const weaponById = {};
  d.weapons.forEach((w) => { weaponById[w.id] = w; });

  const wByName = {}, wBySlot = {};
  d.weapons.forEach((w) => {
    wByName[w.name] = w;
    const key = (seriesNameById[w.series_id] || '') + '|' + w.category_label;
    wBySlot[key] = w;
  });

  const wGradeById = {};
  d.weaponGrades.forEach((g) => { wGradeById[g.id] = g; });
  const statOf = {};          // weaponId -> { '8-2': row, 'max': row }
  d.weaponLevels.forEach((l) => {
    const g = wGradeById[l.weapon_grade_id];
    if (!g) return;
    const w = weaponById[g.weapon_id];
    if (!w) return;
    statOf[w.id] = statOf[w.id] || {};
    if (g.grade === 8 && l.level === 2) statOf[w.id]['8-2'] = l;
    if (g.grade === w.max_grade && l.level === 5) statOf[w.id].max = l;
  });
  const wSkillOf = {};        // weaponId -> {name, level} at max grade
  d.weaponGradeSkills.forEach((gs) => {
    const g = wGradeById[gs.weapon_grade_id];
    if (!g) return;
    const w = weaponById[g.weapon_id];
    if (!w || g.grade !== w.max_grade) return;
    if (!wSkillOf[w.id]) wSkillOf[w.id] = { name: skillNameById[gs.skill_id], level: gs.level };
  });

  // Per-type attributes, flattened the same way the picker does it.
  const titled = (s, prefix) =>
    String(s || '').replace(prefix, '').replace(/_/g, ' ').toLowerCase()
      .replace(/\b\w/g, (m) => m.toUpperCase());

  const ammoOf = {}, arrowOf = {}, melodyOf = {}, ammoTypesOf = {};
  (d.weaponAmmo || []).forEach((a) => {
    (ammoOf[a.weapon_id] = ammoOf[a.weapon_id] || []).push(
      a.name + ' x' + a.capacity +
      ' (' + titled(a.recoil, 'RECOIL_') + ' recoil, ' + titled(a.reload, 'RELOAD_') + ' reload)');
    // Poison / Paralysis / Sleep ammo is typed NORMAL by the source but is not
    // Normal ammo in any useful sense, so it is reported as STATUS — matching
    // what the weapon picker filters on.
    const code = STATUS_AMMO_ELEMENTS.indexOf(a.element) > -1 ? 'STATUS' : a.ammo_type;
    const list = ammoTypesOf[a.weapon_id] = ammoTypesOf[a.weapon_id] || [];
    if (list.indexOf(code) < 0) list.push(code);
  });
  (d.weaponArrows || []).forEach((a) => { (arrowOf[a.weapon_id] = arrowOf[a.weapon_id] || []).push(a.name); });
  (d.weaponMelodies || []).forEach((m) => { (melodyOf[m.weapon_id] = melodyOf[m.weapon_id] || []).push(m.name); });

  function attributesOf(w) {
    const parts = [];
    if (w.style_selectable !== null && w.style_selectable !== undefined) {
      parts.push(w.style_selectable ? 'Style selectable' : 'Customisable, no style');
    }
    if (w.shelling_type) parts.push('Shelling: ' + titled(w.shelling_type, 'SHELLING_'));
    if (w.phial_type) parts.push('Phial: ' + titled(w.phial_type, 'PHIAL_'));
    if (w.sword_mode_element_attack) parts.push('Sword-mode element ' + w.sword_mode_element_attack);
    if (w.kinsect_attack_type) {
      parts.push('Kinsect: ' + titled(w.kinsect_attack_type, '') + ', ' +
        titled(w.kinsect_parameter_type, 'PARAMETER_TYPE_'));
    }
    if (w.horn_pattern) parts.push('Pattern ' + w.horn_pattern);
    return parts
      .concat(ammoOf[w.id] || [])
      .concat(arrowOf[w.id] || [])
      .concat(melodyOf[w.id] || [])
      .join(' · ');
  }

  // Refuse to write over anything already in the destination range.
  const occupied = [];
  for (let c = WCOL_FIRST; c <= WCOL_LAST; c++) {
    let n = 0;
    for (let r = 2; r <= shWp.rowCount; r++) if (str(shWp.getRow(r).getCell(c)) !== '') n++;
    if (n) occupied.push(colLetter(c) + ' (' + n + ' values)');
  }
  if (occupied.length) {
    throw new Error('Weapon columns ' + colLetter(WCOL_FIRST) + '..' + colLetter(WCOL_LAST) +
      ' are meant to be free for added data, but the input already has content in ' +
      occupied.join(', ') + '. Move WCOL further right rather than overwriting it.');
  }

  [
    [WCOL.atk82, 'weapon_attack_8_2'],
    [WCOL.aff82, 'weapon_affinity_8_2'],
    [WCOL.ele82, 'weapon_element_value_8_2'],
    [WCOL.style, 'weapon_style_selectable'],
    [WCOL.ammoTypes, 'weapon_ammo_types'],
    [WCOL.attrs, 'weapon_attributes'],
  ].forEach((h) => { shWp.getRow(1).getCell(h[0]).value = h[1]; });
  shWp.getRow(1).commit();

  const writeWeapon = (r, w) => {
    const row = shWp.getRow(r);
    const mx = (statOf[w.id] || {}).max, lo = (statOf[w.id] || {})['8-2'];
    const sk = wSkillOf[w.id];
    row.getCell(2).value = w.name;
    row.getCell(3).value = seriesNameById[w.series_id] || null;
    row.getCell(4).value = 'Weapon';
    row.getCell(5).value = w.category_label;
    row.getCell(6).value = monsterOfSeriesId[w.series_id] || null;
    row.getCell(7).value = { formula: 'IF(ISNA(VLOOKUP(F' + r + ',Monster!B:E,4,FALSE)),0,VLOOKUP(F' + r + ',Monster!B:E,4,FALSE))' };
    row.getCell(9).value = w.low_name || w.name;
    if (mx) { row.getCell(10).value = mx.attack; row.getCell(11).value = mx.affinity; row.getCell(12).value = mx.element_attack; }
    row.getCell(13).value = w.element_label;
    row.getCell(15).value = { formula: '((NOT(ISNA(VLOOKUP(M' + r + ',Monster!$H$2:$I$6,2,FALSE)))*L' + r + ')+J' + r + ')*(1+K' + r + '/100*0.25)' };
    if (sk) { row.getCell(16).value = sk.name; row.getCell(17).value = sk.level; }
    // R..U (18..21) belong to the sheet — a second skill and the per-type
    // attribute slots. Never written here.
    if (lo) {
      row.getCell(WCOL.atk82).value = lo.attack;
      row.getCell(WCOL.aff82).value = lo.affinity;
      row.getCell(WCOL.ele82).value = lo.element_attack;
    }
    row.getCell(WCOL.style).value = w.style_selectable === null || w.style_selectable === undefined
      ? null : (w.style_selectable ? 'Yes' : 'No');
    row.getCell(WCOL.ammoTypes).value = (ammoTypesOf[w.id] || []).join(', ') || null;
    row.getCell(WCOL.attrs).value = attributesOf(w) || null;
    row.commit();
  };

  const usedWeapon = {};
  let wRefreshed = 0, wFilled = 0, wAppended = 0, wKept = 0;
  let lastWpRow = 1;
  const placeholders = [];
  for (let r = 2; r <= shWp.rowCount; r++) {
    const row = shWp.getRow(r);
    const nm = str(row.getCell(2)), ty = str(row.getCell(5));
    if (!nm && !ty) continue;
    lastWpRow = r;
    if (nm) {
      const w = wByName[nm];
      if (w) { usedWeapon[w.id] = true; writeWeapon(r, w); wRefreshed++; }
      else wKept++;                       // event/collab weapon the source lacks
    } else {
      placeholders.push({ row: r, set: str(row.getCell(3)), type: ty });
    }
  }

  placeholders.forEach((p) => {
    const w = wBySlot[p.set + '|' + p.type];
    if (w && !usedWeapon[w.id]) { usedWeapon[w.id] = true; writeWeapon(p.row, w); wFilled++; }
  });

  const wStyle = [];
  for (let c = 1; c <= WCOL_LAST; c++) wStyle.push(shWp.getRow(2).getCell(c).style);
  d.weapons.forEach((w) => {
    if (usedWeapon[w.id]) return;
    const r = ++lastWpRow;
    writeWeapon(r, w);
    for (let c = 1; c <= WCOL_LAST; c++) if (!shWp.getRow(r).getCell(c).style) shWp.getRow(r).getCell(c).style = wStyle[c - 1];
    shWp.getRow(r).commit();
    wAppended++;
  });

  // Renumber the id column over every populated row.
  let wid = 0;
  for (let r = 2; r <= shWp.rowCount; r++) {
    const row = shWp.getRow(r);
    if (!str(row.getCell(2)) && !str(row.getCell(5))) continue;
    row.getCell(1).value = ++wid;
    row.commit();
  }

  say('  Weapon: ' + wRefreshed + ' refreshed, ' + wFilled + ' placeholders filled, ' +
      wAppended + ' appended, ' + wKept + ' event/collab kept as-is, ' + wid + ' rows total');
  const unfilled = placeholders.length - wFilled;
  if (unfilled) say('  Weapon: ' + unfilled + ' placeholders had no matching weapon and were left blank');
  say('  Weapon: J/K/L are now grade 10-5; additions in columns ' + colLetter(WCOL_FIRST) + '..' + colLetter(WCOL_LAST) + ' (R..U left untouched)');
  say('  Weapon_Filtered: untouched — it is a hand-filtered subset, tell me the rule to regenerate it');

  await wb.xlsx.writeFile(OUT);
  say('\nwrote ' + path.basename(OUT) + ' (' + (fs.statSync(OUT).size / 1024).toFixed(1) + ' KB)');
  say('input ' + path.basename(IN) + ' left unmodified');
}

main().catch((e) => { console.error(e.stack || e.message || e); process.exit(1); });
