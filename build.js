/**
 * Monster Hunter Now — seed generator.
 *
 * Source: monsterhunternow.com. The official /en/armor and /en/skills pages
 * are server-rendered islands, and each ships the game's own data table in a
 * `props` attribute — armour, series, skills, driftstones, plus the string
 * table. We parse that rather than scraping rendered HTML or a wiki, so the
 * IDs in the database are the game's real IDs and the data is as current as
 * the site.
 *
 *   node build.js            -> writes seed.sql + data.json, prints a report
 *
 * Written for the Node 10 on this box: CommonJS, no fetch, no matchAll.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const zlib = require('zlib');

const HERE = __dirname;
const HOST = 'monsterhunternow.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) mhnow-db/2.0';

const ARMOR_PAGE = '/en/armor';
const SKILLS_PAGE = '/en/skills';
const WEAPONS_PAGE = '/en/weapons';

// Game category enum -> the label the game shows. Overridden by the site's own
// string table when present; this is only a fallback.
const CATEGORY_FALLBACK = {
  ATTACK_BOOST: 'Attack',
  ELEMENT_BOOST: 'Element',
  BATTLE_ACTION: 'Action',
  DEFENCE_BOOST: 'Defense/Resistance',
  OTHERS: 'Other',
};

const warnings = [];

// --- fetching ---------------------------------------------------------------

function get(p) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      { host: HOST, path: p, headers: { 'User-Agent': UA, 'Accept-Encoding': 'gzip, deflate' } },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(res.statusCode + ' fetching ' + p));
        }
        const enc = res.headers['content-encoding'];
        let stream = res;
        if (enc === 'gzip') stream = res.pipe(zlib.createGunzip());
        else if (enc === 'deflate') stream = res.pipe(zlib.createInflate());
        const chunks = [];
        stream.on('data', (c) => chunks.push(c));
        stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        stream.on('error', reject);
      }
    );
    req.on('error', reject);
  });
}

function htmlUnescape(s) {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

// The island's data lives in props="{...}" with the JSON HTML-escaped, so the
// closing quote is unambiguous. Take the largest one on the page.
function extractProps(html) {
  const re = /props="([^"]*)"/g;
  let m;
  let best = '';
  while ((m = re.exec(html)) !== null) if (m[1].length > best.length) best = m[1];
  if (!best) throw new Error('no props payload found — the site layout probably changed');
  return JSON.parse(htmlUnescape(best));
}

// --- transforms -------------------------------------------------------------

// Descriptions ship as templates: "Increases attack power by {effect_amount_1}."
function renderDescription(template, effect, condition) {
  if (!template) return '';
  return template
    .replace(/\{effect_amount_(\d+)\}/g, (whole, i) => {
      const v = effect[Number(i) - 1];
      return v === undefined ? whole : String(v);
    })
    .replace(/\{condition_amount_(\d+)\}/g, (whole, i) => {
      const v = condition[Number(i) - 1];
      return v === undefined ? whole : String(v);
    });
}

function buildSkills(skillProps) {
  const T = skillProps.guideTranslations;
  const rows = [];
  const levels = [];

  Object.keys(skillProps.skills).forEach((kind) => {
    const s = skillProps.skills[kind];
    const name = T[s.name] || T['SKILL_NAME_' + s.skillId];
    if (!name) warnings.push('skill ' + kind + ' has no name translation');

    rows.push({
      id: s.skillId,
      kind: s.kind,
      name: name || s.kind,
      category: s.category,
      category_label: T[s.category] || CATEGORY_FALLBACK[s.category] || s.category,
      max_level: s.maxLevel,
      sort_order: s.sortOrder,
    });

    (s.levels || []).forEach((l) => {
      const effect = l.effectAmount || [];
      const condition = l.conditionAmount || [];
      const template = T[l.description];
      if (template === undefined) warnings.push('missing description string ' + l.description);
      const rendered = renderDescription(template || '', effect, condition);
      if (/\{[a-z_]+_\d+\}/.test(rendered)) {
        warnings.push('unsubstituted placeholder in ' + s.kind + ' Lv' + l.level + ': ' + rendered);
      }
      levels.push({
        skill_id: s.skillId,
        level: l.level,
        description: rendered,
        description_template: template || '',
        effect_amounts: effect.length ? JSON.stringify(effect) : null,
        condition_amounts: condition.length ? JSON.stringify(condition) : null,
        effect_amount_1: effect.length ? effect[0] : null,
      });
    });
  });

  rows.sort((a, b) => a.id - b.id);
  levels.sort((a, b) => a.skill_id - b.skill_id || a.level - b.level);
  return { skills: rows, skillLevels: levels };
}

function buildArmor(armorProps, skillIdByKind) {
  const T = armorProps.guideTranslations;

  const series = [];   // built separately now — see buildSeries()

  const armor = [];
  const grades = [];
  const defense = [];
  const gradeSkills = [];

  let armorId = 0;
  let gradeId = 0;

  Object.keys(armorProps.armor)
    .sort()
    .forEach((kind) => {
      const a = armorProps.armor[kind];
      const gs = (a.grades || []).slice().sort((x, y) => x.grade - y.grade);
      if (!gs.length) {
        warnings.push('armor ' + kind + ' has no grades');
        return;
      }

      // Only the first grade carries a name string, and it has a trailing
      // internal tier marker (" 1") that is not part of the display name.
      const rawName = T['ARMOR_NAME_' + gs[0].armorId];
      if (!rawName) warnings.push('armor ' + kind + ' has no name translation');
      const name = String(rawName || kind).replace(/\s+\d+$/, '');

      armorId++;
      armor.push({
        id: armorId,
        kind: a.id,
        series_id: a.seriesId,
        slot: a.category,
        name: name,
        asset_key: a.assetKey || null,
        min_grade: gs[0].grade,
        max_grade: gs[gs.length - 1].grade,
      });

      gs.forEach((g) => {
        gradeId++;
        grades.push({
          id: gradeId,
          armor_id: armorId,
          grade: g.grade,
          game_armor_id: g.armorId,
          driftsmelt_slots: g.driftsmeltSlots || 0,
        });

        (g.defense || []).forEach((d, i) => {
          defense.push({ armor_grade_id: gradeId, step: i + 1, defense: d });
        });

        const seen = {};
        (g.skills || []).forEach((sk) => {
          const sid = skillIdByKind[sk.kind];
          if (sid === undefined) {
            warnings.push('armor ' + kind + ' grade ' + g.grade + ' references unknown skill ' + sk.kind);
            return;
          }
          // Same skill listed twice at one grade would collide on the PK.
          if (seen[sid]) {
            seen[sid].level += sk.level;
            return;
          }
          const row = { armor_grade_id: gradeId, skill_id: sid, level: sk.level };
          seen[sid] = row;
          gradeSkills.push(row);
        });
      });
    });

  return { series: series, armor: armor, grades: grades, defense: defense, gradeSkills: gradeSkills };
}

function buildDriftstones(skillProps, skillIdByKind) {
  const T = skillProps.guideTranslations;
  const stones = [];
  const stoneSkills = [];

  Object.keys(skillProps.driftstones).forEach((kind) => {
    const d = skillProps.driftstones[kind];
    const id = Number(d.id);
    const list = d.skills || [];

    stones.push({
      id: id,
      kind: d.name || kind,
      name: T['DRIFTSTONE_NAME_' + (d.name || kind)] || d.name || kind,
      points: d.points,
      walking_distance_m: d.walkingDistanceMeters === undefined ? null : d.walkingDistanceMeters,
      is_random_pool: list.length > 1 ? 1 : 0,
    });

    const seen = {};
    list.forEach((sk) => {
      const sid = skillIdByKind[sk.skillKind];
      if (sid === undefined) {
        warnings.push('driftstone ' + kind + ' references unknown skill ' + sk.skillKind);
        return;
      }
      const key = sid + ':' + sk.skillLevel;
      if (seen[key]) return;
      seen[key] = true;
      stoneSkills.push({
        driftstone_id: id,
        skill_id: sid,
        level: sk.skillLevel,
        weight: sk.weight,
        sort_id: sk.sortId,
      });
    });
  });

  stones.sort((a, b) => a.id - b.id);
  return { driftstones: stones, driftstoneSkills: stoneSkills };
}

// Series come from both payloads: weapons reference series that no armour uses
// (104 vs 69), so building this from the armour page alone would orphan them.
function buildSeries(armorProps, weaponProps) {
  const out = {};
  [armorProps, weaponProps].forEach((P) => {
    if (!P || !P.series) return;
    const T = P.guideTranslations || {};
    Object.keys(P.series).forEach((k) => {
      const s = P.series[k];
      const name = T['SERIES_NAME_' + s.id];
      if (!out[s.id] || (name && out[s.id].name === out[s.id].kind)) {
        out[s.id] = { id: s.id, kind: s.series, name: name || (out[s.id] && out[s.id].name) || s.series, sort_order: s.sortOrder };
      }
    });
  });

  // Drop series nothing references, so the table has no dead rows.
  const used = {};
  Object.keys(armorProps.armor).forEach((k) => { used[armorProps.armor[k].seriesId] = true; });
  if (weaponProps && weaponProps.weapons) {
    Object.keys(weaponProps.weapons).forEach((k) => { used[weaponProps.weapons[k].seriesId] = true; });
  }

  return Object.keys(out).map((k) => out[k])
    .filter((s) => used[s.id])
    .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
}

// The display name for a weapon type is keyed by INDEX, not by the enum:
// WEAPON_TYPE_00 = Great Sword. Keying on the enum silently yields the enum
// back, which looks like it worked.
const WEAPON_TYPE_INDEX = {
  GREAT_SWORD: '00', SWORD_SHIELD: '01', DUAL_BLADES: '02', LONG_SWORD: '03',
  HAMMER: '04', HUNTING_HORN: '05', LANCE: '06', GUNLANCE: '07',
  SWITCH_AXE: '08', CHARGE_BLADE: '09', INSECT_GLAIVE: '10', BOW: '11',
  HEAVY_BOWGUN: '12', LIGHT_BOWGUN: '13',
};

function buildWeapons(P, skillIdByKind) {
  const T = P.guideTranslations;
  const label = (key, fallback) => T[key] || fallback;
  const clean = (s) => String(s || '').replace(/\s+\d+$/, '');
  // NO_ELEMENT's string is under ELEMENT_NO, not ELEMENT_NO_ELEMENT.
  const elementLabel = (e) => T['ELEMENT_' + e] || T[e === 'NO_ELEMENT' ? 'ELEMENT_NO' : ''] || e;

  const weapons = [], grades = [], levels = [], gradeSkills = [];
  const ammo = [], arrows = [], melodies = [];
  let wid = 0, gid = 0;

  Object.keys(P.weapons).sort().forEach((kind) => {
    const w = P.weapons[kind];
    const gs = (w.grades || []).slice().sort((a, b) => a.grade - b.grade);
    if (!gs.length) { warnings.push('weapon ' + kind + ' has no grades'); return; }

    const named = gs.filter((g) => T[g.name]);
    if (!named.length) { warnings.push('weapon ' + kind + ' has no name at any grade'); return; }
    const topName = clean(T[named[named.length - 1].name]);
    const lowName = named.length > 1 ? clean(T[named[0].name]) : null;

    wid++;
    const sa = w.switchAxeSpec || {}, cb = w.chargeBladeSpec || {};
    const kn = w.insectGlaiveSpec || {}, gl = w.gunlanceSpec || {};
    const hh = w.huntingHornSpec || {}, cu = w.customizationSpec || {};

    weapons.push({
      id: wid,
      kind: w.id,
      series_id: w.seriesId,
      category: w.category,
      category_label: label('WEAPON_TYPE_' + WEAPON_TYPE_INDEX[w.category], w.category),
      element: w.element,
      element_label: elementLabel(w.element),
      name: topName,
      // Always the low-grade name, even when the weapon is never renamed —
      // then it simply equals `name`. low_name_grade NULL means no rename.
      low_name: lowName || topName,
      low_name_grade: named.length > 1 && lowName !== topName ? named[named.length - 1].grade : null,
      min_grade: gs[0].grade,
      max_grade: gs[gs.length - 1].grade,
      sort_order: Number(w.sortOrder) || 0,
      shelling_type: gl.shellingType || null,
      phial_type: sa.phialType || cb.phialType || null,
      sword_mode_element_attack: sa.swordModeElementAttack === undefined ? null : sa.swordModeElementAttack,
      kinsect_type: kn.kinsectType || null,
      kinsect_attack_type: kn.attackType || null,
      kinsect_attack_attribute: kn.attackAttribute || null,
      kinsect_parameter_type: kn.parameterType || null,
      kinsect_attack_level: kn.attackLevel || null,
      kinsect_stamina_level: kn.staminaLevel || null,
      kinsect_bonus_kind: kn.bonusKind || null,
      horn_pattern: hh.uniquePattern || null,
      customizable: cu.customizable === undefined ? null : (cu.customizable ? 1 : 0),
      style_selectable: cu.styleSelectable === undefined ? null : (cu.styleSelectable ? 1 : 0),
    });

    gs.forEach((g) => {
      gid++;
      grades.push({
        id: gid, weapon_id: wid, grade: g.grade, game_weapon_id: g.weaponId,
        special_skill: g.specialSkill ? g.specialSkill.kind : null,
        special_skill_level: g.specialSkill ? g.specialSkill.level : null,
      });
      (g.levels || []).forEach((l) => {
        levels.push({
          weapon_grade_id: gid, level: l.level,
          attack: l.attack || 0, element_attack: l.elementAttack || 0, affinity: l.critical || 0,
        });
      });
      const seen = {};
      (g.skills || []).forEach((sk) => {
        const sid = skillIdByKind[sk.kind];
        if (sid === undefined) { warnings.push('weapon ' + kind + ' grade ' + g.grade + ' unknown skill ' + sk.kind); return; }
        if (seen[sid]) return;
        seen[sid] = true;
        gradeSkills.push({ weapon_grade_id: gid, skill_id: sid, level: sk.level });
      });
    });

    (((w.bowgunSpec || {}).ammo) || []).forEach((a, i) => {
      ammo.push({
        weapon_id: wid, position: i + 1,
        ammo_id: a.type.id, ammo_type: a.type.type, element: a.type.element,
        name: label('AMMO_NAME_' + a.type.id, a.type.type),
        capacity: Number(a.capacity) || 0,
        recoil: a.recoil, reload: a.reload,
      });
    });
    (((w.bowSpec || {}).arrows) || []).forEach((a, i) => {
      arrows.push({
        weapon_id: wid, position: i + 1, kind: a,
        family: (a.match(/^ARROW_([A-Z]+)/) || [null, 'UNKNOWN'])[1],
        name: label(a, a),
      });
    });
    (((w.huntingHornSpec || {}).melody) || []).forEach((m, i) => {
      melodies.push({ weapon_id: wid, position: i + 1, kind: m, name: label(m, m) });
    });
  });

  fixInsectGlaiveStyle(weapons, warnings);

  return { weapons: weapons, weaponGrades: grades, weaponLevels: levels,
    weaponGradeSkills: gradeSkills, weaponAmmo: ammo, weaponArrows: arrows, weaponMelodies: melodies };
}

// Insect glaives became style selectable in game, but the source still reports
// styleSelectable=false for every one of them while reporting customizable=true.
// For all thirteen other weapon types the two flags agree exactly, and the
// glaives the source marks customisable are precisely those from monsters whose
// other weapons are already style selectable — so the false is a stale value
// rather than a real distinction, and it is corrected here.
//
// This is written to be self-cancelling: once the source publishes the change,
// every glaive already has the flag set, nothing is touched, and the note below
// stops appearing. If instead the counts stop lining up, the note says so, which
// is the signal to revisit rather than to keep patching silently.
function fixInsectGlaiveStyle(weapons, warnings) {
  const glaives = weapons.filter((w) => w.category === 'INSECT_GLAIVE');
  const stale = glaives.filter((w) => w.customizable === 1 && w.style_selectable === 0);
  const odd = glaives.filter((w) => w.customizable !== 1 && w.style_selectable === 1);
  if (odd.length) {
    warnings.push('insect glaive style fix: ' + odd.length + ' glaive(s) are style selectable ' +
      'without being customisable, which breaks the assumption behind this fix — check it');
  }
  if (!stale.length) return;
  stale.forEach((w) => { w.style_selectable = 1; });
  console.log('  insect glaive style selectable: corrected ' + stale.length + ' of ' +
    glaives.length + ' (source still reports these as customisable but not style selectable)');
}

// Monsters whose weapons became customisable and style selectable in game before
// the source published it. Add a series name here when the game shows the change
// and the source has not caught up; remove nothing, because the entry turns into
// a no-op by itself once the source agrees.
//
// Customisation is all-or-nothing per monster: every series that has any
// customisable weapon has ALL of them customisable, with no partial series
// anywhere in the data. Subspecies count as their own monster — Azure Rathalos,
// Black Diablos, Pink Rathian and Viper Tobi-Kadachi are all still off while
// their base species are on — so a subspecies has to be listed separately and is
// never implied by the base.
const CUSTOMISATION_LIVE_IN_GAME = [
  'Mizutsune Set',   // user 2026-08-20
  'Paolumu Set',     // user 2026-08-20; Nightshade Paolumu is a separate monster
];

function fixSeriesCustomisation(wp, series, warnings) {
  const idByName = {};
  series.forEach((s) => { idByName[s.name] = s.id; });

  const bySeries = {};
  wp.weapons.forEach((w) => { (bySeries[w.series_id] = bySeries[w.series_id] || []).push(w); });

  // The all-or-nothing rule is the whole basis for flipping a series wholesale,
  // so it is re-checked on every build rather than trusted. Only weapons the
  // source actually has a customisation entry for count: a null is the absence of
  // an entry, not a "no", and event weapons carry nulls for everything.
  Object.keys(bySeries).forEach((sid) => {
    const ws = bySeries[sid];
    const on = ws.filter((w) => w.customizable === 1).length;
    const off = ws.filter((w) => w.customizable === 0).length;
    if (on && off) {
      const name = (series.filter((s) => s.id === +sid)[0] || {}).name || sid;
      warnings.push('series "' + name + '" has ' + on + ' customisable and ' + off + ' not — ' +
        'customisation has always been all-or-nothing per monster, so this needs a look');
    }
  });

  CUSTOMISATION_LIVE_IN_GAME.forEach((name) => {
    const sid = idByName[name];
    if (sid === undefined) { warnings.push('customisation fix: no series named "' + name + '"'); return; }
    const ws = bySeries[sid] || [];
    const todo = ws.filter((w) => w.customizable !== 1 || w.style_selectable !== 1);
    if (!todo.length) return;                       // source has caught up
    todo.forEach((w) => { w.customizable = 1; w.style_selectable = 1; });
    console.log('  customisation: marked ' + todo.length + ' of ' + ws.length +
      ' ' + name + ' weapon(s) customisable and style selectable (not yet in the source)');
  });
}

const MANUAL_FILE = path.join(HERE, 'manual-weapons.json');

// Event SKILLS are missing from the source for the same reason event weapons
// are, and an event weapon usually carries one — so they have to be merged
// before the weapons that reference them.
function mergeManualSkills(s, skillIdByName) {
  if (!fs.existsSync(MANUAL_FILE)) return 0;
  const M = JSON.parse(fs.readFileSync(MANUAL_FILE, 'utf8'));
  const byId = {};
  s.skills.forEach((x) => { byId[x.id] = true; });

  let added = 0;
  (M.skills || []).forEach((ms) => {
    if (skillIdByName[ms.name] !== undefined) {
      warnings.push('manual skill "' + ms.name + '" already exists in the source — skipped');
      return;
    }
    if (byId[ms.id]) throw new Error('manual skill id ' + ms.id + ' collides with a real skill');
    s.skills.push({
      id: ms.id, kind: ms.kind, name: ms.name,
      category: ms.category || 'OTHERS', category_label: ms.category_label || 'Other',
      max_level: (ms.levels || []).length || 1,
      sort_order: 999000000 + ms.id,
    });
    (ms.levels || []).forEach((text, i) => {
      s.skillLevels.push({
        skill_id: ms.id, level: i + 1, description: text, description_template: text,
        effect_amounts: null, condition_amounts: null, effect_amount_1: null,
      });
    });
    skillIdByName[ms.name] = ms.id;
    byId[ms.id] = true;
    added++;
  });
  return added;
}

// Event weapons are absent from the source entirely — there is no event series
// in the payload — so they can only ever come from manual-weapons.json. Merged
// here on every build so they survive a rebuild.
function mergeManualWeapons(wp, series, skillIdByName) {
  const file = MANUAL_FILE;
  if (!fs.existsSync(file)) return 0;

  const M = JSON.parse(fs.readFileSync(file, 'utf8'));
  const seriesIds = {};
  series.forEach((s) => { seriesIds[s.id] = true; });

  (M.series || []).forEach((s) => {
    if (seriesIds[s.id]) {
      throw new Error('manual series id ' + s.id + ' collides with a real game series');
    }
    series.push({ id: s.id, kind: s.kind, name: s.name, sort_order: s.sort_order });
    seriesIds[s.id] = true;
  });

  const usedGameIds = {};
  wp.weaponGrades.forEach((g) => { usedGameIds[g.game_weapon_id] = true; });
  const usedKinds = {};
  wp.weapons.forEach((w) => { usedKinds[w.kind] = true; });

  let wid = wp.weapons.reduce(function (m, w) { return Math.max(m, w.id); }, 0);
  let gid = wp.weaponGrades.reduce(function (m, g) { return Math.max(m, g.id); }, 0);
  let added = 0;

  // weapon_ammo.ammo_id is SMALLINT UNSIGNED, so a synthetic id has to stay
  // under 65535. Real game ammo ids top out around 4200, so counting up from
  // 60000 is clear of them with room to spare.
  let synthAmmoId = 60000;

  (M.weapons || []).forEach((mw) => {
    if (usedKinds[mw.kind]) {
      warnings.push('manual weapon ' + mw.kind + ' already exists in the source — skipped');
      return;
    }
    if (!seriesIds[mw.series_id]) {
      throw new Error('manual weapon ' + mw.kind + ' references unknown series ' + mw.series_id);
    }
    const grades = (mw.grades || []).slice().sort((a, b) => a.grade - b.grade);
    if (!grades.length) { warnings.push('manual weapon ' + mw.kind + ' has no grades — skipped'); return; }

    wid++;
    wp.weapons.push({
      id: wid, kind: mw.kind, series_id: mw.series_id,
      category: mw.category, category_label: mw.category_label,
      element: mw.element, element_label: mw.element_label,
      name: mw.name, low_name: mw.low_name || mw.name,
      low_name_grade: null,
      min_grade: grades[0].grade, max_grade: grades[grades.length - 1].grade,
      sort_order: 999000000 + wid,
      shelling_type: mw.shelling_type || null,
      phial_type: mw.phial_type || null,
      sword_mode_element_attack: mw.sword_mode_element_attack === undefined ? null : mw.sword_mode_element_attack,
      kinsect_type: mw.kinsect_type || null,
      kinsect_attack_type: mw.kinsect_attack_type || null,
      kinsect_attack_attribute: mw.kinsect_attack_attribute || null,
      kinsect_parameter_type: mw.kinsect_parameter_type || null,
      kinsect_attack_level: mw.kinsect_attack_level || null,
      kinsect_stamina_level: mw.kinsect_stamina_level || null,
      kinsect_bonus_kind: mw.kinsect_bonus_kind || null,
      horn_pattern: mw.horn_pattern || null,
      customizable: mw.customizable === undefined ? null : mw.customizable,
      style_selectable: mw.style_selectable === undefined ? null : mw.style_selectable,
    });

    grades.forEach((g) => {
      if (usedGameIds[g.game_weapon_id]) {
        throw new Error('manual game_weapon_id ' + g.game_weapon_id + ' collides with a real one');
      }
      usedGameIds[g.game_weapon_id] = true;
      gid++;
      wp.weaponGrades.push({
        id: gid, weapon_id: wid, grade: g.grade, game_weapon_id: g.game_weapon_id,
        special_skill: g.special_skill || null,
        special_skill_level: g.special_skill_level === undefined ? null : g.special_skill_level,
      });
      (g.levels || []).forEach((l) => {
        wp.weaponLevels.push({
          weapon_grade_id: gid, level: l.level,
          attack: l.attack || 0, element_attack: l.element_attack || 0, affinity: l.affinity || 0,
        });
      });
      (g.skills || []).forEach((sk) => {
        const sid = skillIdByName[sk.skill];
        if (sid === undefined) {
          warnings.push('manual weapon ' + mw.kind + ' references unknown skill "' + sk.skill + '"');
          return;
        }
        wp.weaponGradeSkills.push({ weapon_grade_id: gid, skill_id: sid, level: sk.level });
      });
    });

    (mw.ammo || []).forEach((a, i) => {
      wp.weaponAmmo.push({
        weapon_id: wid, position: i + 1,
        ammo_id: ++synthAmmoId, ammo_type: a.ammo_type, element: a.element,
        name: a.name, capacity: a.capacity, recoil: a.recoil, reload: a.reload,
      });
    });
    (mw.arrows || []).forEach((a, i) => {
      wp.weaponArrows.push({ weapon_id: wid, position: i + 1, kind: a.kind, family: a.family, name: a.name });
    });
    (mw.melodies || []).forEach((m, i) => {
      wp.weaponMelodies.push({ weapon_id: wid, position: i + 1, kind: m.kind, name: m.name });
    });
    added++;
  });

  return added;
}

// --- SQL emission -----------------------------------------------------------

function q(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  return "'" + String(v).replace(/\\/g, '\\\\').replace(/'/g, "''") + "'";
}

// Chunked so no single statement approaches max_allowed_packet.
function insertStatements(table, cols, rows, chunkSize) {
  if (!rows.length) return [];
  const size = chunkSize || 500;
  const out = [];
  for (let i = 0; i < rows.length; i += size) {
    const slice = rows.slice(i, i + size);
    const body = slice
      .map((r) => '  (' + cols.map((c) => q(r[c])).join(', ') + ')')
      .join(',\n');
    out.push(
      'INSERT INTO `' + table + '` (' + cols.map((c) => '`' + c + '`').join(',') + ') VALUES\n' + body + ';'
    );
  }
  return out;
}

function buildSql(d) {
  const out = [];
  out.push('-- Generated by build.js — do not edit by hand.');
  out.push('-- Source: https://' + HOST + ' (official game data), fetched ' + new Date().toISOString().slice(0, 10) + '.');
  out.push('');
  out.push('SET NAMES utf8mb4;');
  out.push('USE `mhnow`;');
  out.push('');
  out.push('SET FOREIGN_KEY_CHECKS = 0;');
  ['driftstone_skill', 'driftstone', 'armor_grade_skill', 'armor_grade_defense',
   'weapon_horn_melody', 'weapon_bow_arrow', 'weapon_ammo', 'weapon_grade_skill',
   'weapon_grade_level', 'weapon_grade', 'weapon',
   'armor_grade', 'armor', 'series', 'skill_level', 'skill'].forEach((t) => {
    out.push('TRUNCATE TABLE `' + t + '`;');
  });
  out.push('SET FOREIGN_KEY_CHECKS = 1;');
  out.push('');

  const push = (title, stmts) => {
    out.push('-- ' + title + ' ' + '-'.repeat(Math.max(0, 60 - title.length)));
    out.push(stmts.join('\n'));
    out.push('');
  };

  push('skills', insertStatements('skill',
    ['id', 'kind', 'name', 'category', 'category_label', 'max_level', 'sort_order'], d.skills));
  push('skill levels', insertStatements('skill_level',
    ['skill_id', 'level', 'description', 'description_template', 'effect_amounts', 'condition_amounts', 'effect_amount_1'], d.skillLevels));
  push('series (armour + weapons)', insertStatements('series',
    ['id', 'kind', 'name', 'sort_order'], d.series));
  push('armour', insertStatements('armor',
    ['id', 'kind', 'series_id', 'slot', 'name', 'asset_key', 'min_grade', 'max_grade'], d.armor));
  push('armour grades', insertStatements('armor_grade',
    ['id', 'armor_id', 'grade', 'game_armor_id', 'driftsmelt_slots'], d.grades));
  push('armour defence per grade step', insertStatements('armor_grade_defense',
    ['armor_grade_id', 'step', 'defense'], d.defense, 1000));
  push('armour skills per grade', insertStatements('armor_grade_skill',
    ['armor_grade_id', 'skill_id', 'level'], d.gradeSkills, 1000));
  push('driftstones', insertStatements('driftstone',
    ['id', 'kind', 'name', 'points', 'walking_distance_m', 'is_random_pool'], d.driftstones));
  push('driftstone skills', insertStatements('driftstone_skill',
    ['driftstone_id', 'skill_id', 'level', 'weight', 'sort_id'], d.driftstoneSkills));

  push('weapons', insertStatements('weapon',
    ['id', 'kind', 'series_id', 'category', 'category_label', 'element', 'element_label',
     'name', 'low_name', 'low_name_grade', 'min_grade', 'max_grade', 'sort_order',
     'shelling_type', 'phial_type', 'sword_mode_element_attack',
     'kinsect_type', 'kinsect_attack_type', 'kinsect_attack_attribute',
     'kinsect_parameter_type', 'kinsect_attack_level', 'kinsect_stamina_level',
     'kinsect_bonus_kind', 'horn_pattern', 'customizable', 'style_selectable'], d.weapons));
  push('weapon grades', insertStatements('weapon_grade',
    ['id', 'weapon_id', 'grade', 'game_weapon_id', 'special_skill', 'special_skill_level'], d.weaponGrades));
  push('weapon stats per grade level', insertStatements('weapon_grade_level',
    ['weapon_grade_id', 'level', 'attack', 'element_attack', 'affinity'], d.weaponLevels, 1000));
  push('weapon skills per grade', insertStatements('weapon_grade_skill',
    ['weapon_grade_id', 'skill_id', 'level'], d.weaponGradeSkills, 1000));
  push('bowgun ammo', insertStatements('weapon_ammo',
    ['weapon_id', 'position', 'ammo_id', 'ammo_type', 'element', 'name', 'capacity', 'recoil', 'reload'], d.weaponAmmo));
  push('bow arrows', insertStatements('weapon_bow_arrow',
    ['weapon_id', 'position', 'kind', 'family', 'name'], d.weaponArrows));
  push('hunting horn melodies', insertStatements('weapon_horn_melody',
    ['weapon_id', 'position', 'kind', 'name'], d.weaponMelodies));

  return out.join('\n');
}

// --- main -------------------------------------------------------------------

async function main() {
  const armorHtml = await get(ARMOR_PAGE);
  const skillsHtml = await get(SKILLS_PAGE);
  const weaponsHtml = await get(WEAPONS_PAGE);

  const armorProps = extractProps(armorHtml);
  const skillProps = extractProps(skillsHtml);
  const weaponProps = extractProps(weaponsHtml);

  const s = buildSkills(skillProps);
  const skillIdByKind = {};
  s.skills.forEach((x) => (skillIdByKind[x.kind] = x.id));

  const a = buildArmor(armorProps, skillIdByKind);
  const ds = buildDriftstones(skillProps, skillIdByKind);
  const wp = buildWeapons(weaponProps, skillIdByKind);
  a.series = buildSeries(armorProps, weaponProps);

  const skillIdByName = {};
  s.skills.forEach((x) => (skillIdByName[x.name] = x.id));
  const manualSkills = mergeManualSkills(s, skillIdByName);
  const manualCount = mergeManualWeapons(wp, a.series, skillIdByName);
  fixSeriesCustomisation(wp, a.series, warnings);

  const data = {
    skills: s.skills,
    skillLevels: s.skillLevels,
    series: a.series,
    armor: a.armor,
    grades: a.grades,
    defense: a.defense,
    gradeSkills: a.gradeSkills,
    driftstones: ds.driftstones,
    driftstoneSkills: ds.driftstoneSkills,
    weapons: wp.weapons,
    weaponGrades: wp.weaponGrades,
    weaponLevels: wp.weaponLevels,
    weaponGradeSkills: wp.weaponGradeSkills,
    weaponAmmo: wp.weaponAmmo,
    weaponArrows: wp.weaponArrows,
    weaponMelodies: wp.weaponMelodies,
  };

  // Keep the previous snapshot so `node diff.js` can say what actually
  // changed. Row counts alone hide rebalances.
  //
  // Only snapshot when the fetched data actually DIFFERS. Snapshotting on
  // every run means a second run destroys the baseline — run build twice
  // after an update and data.prev.json becomes post-update too, so the diff
  // reports "no changes" for a release that plainly changed things. That
  // happened once; do not simplify this back.
  const dataPath = path.join(HERE, 'data.json');
  const nextJson = JSON.stringify(data, null, 2);
  let unchanged = false;
  if (fs.existsSync(dataPath)) {
    if (fs.readFileSync(dataPath, 'utf8') === nextJson) unchanged = true;
    else fs.copyFileSync(dataPath, path.join(HERE, 'data.prev.json'));
  }

  fs.writeFileSync(path.join(HERE, 'seed.sql'), buildSql(data), 'utf8');
  fs.writeFileSync(dataPath, nextJson, 'utf8');

  // --- report ---------------------------------------------------------------

  console.log('wrote seed.sql and data.json');
  if (unchanged) console.log('  source identical to last run — data.prev.json baseline kept');
  const counts = {};
  Object.keys(data).forEach((k) => (counts[k] = data[k].length));
  console.log('counts:', JSON.stringify(counts));

  if (manualSkills) console.log('  merged ' + manualSkills + ' manual skill(s) the source does not publish');
  if (manualCount) console.log('  merged ' + manualCount + ' manual weapon(s) the source does not publish');

  const bySlot = {};
  data.armor.forEach((x) => (bySlot[x.slot] = (bySlot[x.slot] || 0) + 1));
  console.log('armour by slot:', JSON.stringify(bySlot));

  const byCat = {};
  data.skills.forEach((x) => (byCat[x.category_label] = (byCat[x.category_label] || 0) + 1));
  console.log('skills by category:', JSON.stringify(byCat));

  const gradeSpan = {};
  data.armor.forEach((x) => {
    const k = x.min_grade + '-' + x.max_grade;
    gradeSpan[k] = (gradeSpan[k] || 0) + 1;
  });
  console.log('armour grade spans:', JSON.stringify(gradeSpan));

  if (warnings.length) console.log('warnings (' + warnings.length + '):\n  ' + warnings.slice(0, 30).join('\n  '));
  else console.log('no warnings');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
