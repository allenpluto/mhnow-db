/**
 * Weapon census: total per weapon type, and every weapon that does NOT come
 * from a monster.
 *
 *   node weapon-census.js
 *
 * "Not from a monster" means the weapon's series has no monster behind it —
 * the crafted Ore and Bone lines, plus anything added by hand in
 * manual-weapons.json. Event weapons are exactly this shape, so comparing this
 * list against what the game shows is how you find event weapons the source
 * never published.
 *
 * The series-to-monster link is not in the database, so it is resolved from the
 * live payload the same way build.js does: the series enum suffix names the
 * monster.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const zlib = require('zlib');

const HERE = __dirname;
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
  if (!b) throw new Error('no payload — site layout changed');
  return JSON.parse(un(b));
}
const norm = (x) => String(x).toLowerCase().replace(/[^a-z0-9]/g, '');

const TYPE_ORDER = ['Great Sword', 'Long Sword', 'Sword & Shield', 'Dual Blades', 'Hammer',
  'Hunting Horn', 'Lance', 'Gunlance', 'Switch Axe', 'Charge Blade', 'Insect Glaive',
  'Light Bowgun', 'Heavy Bowgun', 'Bow'];

(async () => {
  const d = JSON.parse(fs.readFileSync(path.join(HERE, 'data.json'), 'utf8'));
  const P = props(await get('/en/armor'));
  const T = P.guideTranslations;

  const monsterByNorm = {};
  Object.keys(P.monsters).forEach((k) => { monsterByNorm[norm(k)] = k; });

  // The source publishes no SERIES_NAME for the bone weapon line, and splits it
  // across five enums by weapon type. Collapse that to one readable label.
  const friendly = (s) => {
    if (s.name !== s.kind) return s.name;
    if (/^SERIES_BONE_WEAPON/.test(s.kind)) return 'Bone Set (unnamed)';
    return s.kind.replace(/^SERIES_/, '').replace(/_/g, ' ').toLowerCase()
      .replace(/\b\w/g, (m) => m.toUpperCase());
  };

  const seriesById = {};
  d.series.forEach((s) => {
    const mk = monsterByNorm[norm(String(s.kind).replace(/^SERIES_/, ''))];
    seriesById[s.id] = {
      name: friendly(s),
      monster: mk ? (T['MONSTER_NAME_' + mk.toUpperCase()] || mk) : null,
    };
  });

  const gradeById = {}; d.weaponGrades.forEach((g) => { gradeById[g.id] = g; });
  const wById = {}; d.weapons.forEach((w) => { wById[w.id] = w; });
  const stat = {};
  d.weaponLevels.forEach((l) => {
    const g = gradeById[l.weapon_grade_id]; if (!g) return;
    const w = wById[g.weapon_id]; if (!w) return;
    if (g.grade === w.max_grade && l.level === 5) stat[w.id] = l;
  });
  const skillOf = {};
  d.weaponGradeSkills.forEach((s) => {
    const g = gradeById[s.weapon_grade_id]; if (!g) return;
    const w = wById[g.weapon_id]; if (!w || g.grade !== w.max_grade) return;
    if (!skillOf[w.id]) {
      const sk = d.skills.filter((x) => x.id === s.skill_id)[0];
      skillOf[w.id] = (sk ? sk.name : s.skill_id) + ' ' + s.level;
    }
  });

  // --- totals by type -----------------------------------------------------
  const byType = {}, specialByType = {};
  d.weapons.forEach((w) => {
    byType[w.category_label] = (byType[w.category_label] || 0) + 1;
    const ser = seriesById[w.series_id] || {};
    if (!ser.monster) (specialByType[w.category_label] = specialByType[w.category_label] || []).push({ w: w, ser: ser });
  });

  const types = TYPE_ORDER.filter((t) => byType[t]).concat(
    Object.keys(byType).filter((t) => TYPE_ORDER.indexOf(t) < 0).sort());

  console.log('WEAPONS BY TYPE');
  console.log('  ' + 'Type'.padEnd(16) + 'total'.padStart(6) + '  from a monster'.padStart(16) + '  special'.padStart(9));
  let tot = 0, totSpecial = 0;
  types.forEach((t) => {
    const s = (specialByType[t] || []).length;
    tot += byType[t]; totSpecial += s;
    console.log('  ' + t.padEnd(16) + String(byType[t]).padStart(6) +
      String(byType[t] - s).padStart(16) + String(s).padStart(9));
  });
  console.log('  ' + 'TOTAL'.padEnd(16) + String(tot).padStart(6) +
    String(tot - totSpecial).padStart(16) + String(totSpecial).padStart(9));

  // --- the special ones ---------------------------------------------------
  console.log('\n\nSPECIAL WEAPONS — no monster behind the series (' + totSpecial + ')');
  types.forEach((t) => {
    const list = specialByType[t];
    if (!list || !list.length) return;
    console.log('\n' + t + '  (' + list.length + ')');
    list.sort((a, b) => a.ser.name.localeCompare(b.ser.name) || a.w.name.localeCompare(b.w.name));
    const pad = (s, n) => { s = String(s === null || s === undefined ? '' : s); return s.length >= n ? s + '  ' : s.padEnd(n); };
    list.forEach((x) => {
      const st = stat[x.w.id];
      console.log('   ' + pad(x.w.name, 24) + pad(x.w.low_name, 24) + pad(x.ser.name, 22) +
        pad(st ? 'atk ' + st.attack : '', 10) + pad(st ? 'aff ' + st.affinity + '%' : '', 10) +
        (skillOf[x.w.id] || ''));
    });
  });

  // --- series with no monster, for reference -------------------------------
  const specialSeries = {};
  d.weapons.forEach((w) => {
    const ser = seriesById[w.series_id] || {};
    if (!ser.monster) specialSeries[ser.name] = (specialSeries[ser.name] || 0) + 1;
  });
  console.log('\n\nSERIES WITH NO MONSTER');
  Object.keys(specialSeries).sort().forEach((s) => console.log('   ' + s.padEnd(40) + specialSeries[s]));
})().catch((e) => { console.error(e.message || e); process.exit(1); });
