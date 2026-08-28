/**
 * Builds a checklist of armour to verify in game after a balance patch.
 *
 *   node checklist.js        -> writes SKILL-CHECK.md
 *
 * Why this exists: when the game is patched but monsterhunternow.com has not
 * republished its data, the only way to learn the new values is to look at
 * them in game. 345 pieces is too many to check blind, so this narrows and
 * orders the work using the in-game notice ("boss material forged equipment,
 * and some early stage released monster material equipment"):
 *
 *   - Boss material  -> the series whose monster has species ELDER.
 *   - Early released -> ordered by the monster's own sortOrder, ascending.
 *
 * It also applies the pattern seen so far: the buff lands on the piece's
 * SECOND listed skill, taking it 1 -> 2. That is a hypothesis from one set
 * (Kushala, 4 of 5 pieces; chest untouched), so the file lists what the
 * source currently says and what a buff would look like, rather than
 * asserting anything.
 *
 * Reads the live payload so it is never stale relative to the source.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const zlib = require('zlib');

const HOST = 'monsterhunternow.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) mhnow-db/2.0';
const OUT = path.join(__dirname, 'SKILL-CHECK.md');

const SLOT_LABEL = { HEAD: 'Head', CHEST: 'Chest', ARMS: 'Arms', TORSO: 'Waist', LEGS: 'Legs' };
const SLOT_ORDER = ['HEAD', 'CHEST', 'ARMS', 'TORSO', 'LEGS'];

function get(p) {
  return new Promise((res, rej) => {
    https.get({ host: HOST, path: p, headers: { 'User-Agent': UA, 'Accept-Encoding': 'gzip' } }, (r) => {
      if (r.statusCode !== 200) { r.resume(); return rej(new Error(r.statusCode + ' fetching ' + p)); }
      const s = r.headers['content-encoding'] === 'gzip' ? r.pipe(zlib.createGunzip()) : r;
      const c = [];
      s.on('data', (x) => c.push(x));
      s.on('end', () => res(Buffer.concat(c).toString('utf8')));
      s.on('error', rej);
    }).on('error', rej);
  });
}

const unesc = (s) => s
  .replace(/&quot;/g, '"')
  .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(Number(n)))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

function extractProps(html) {
  const re = /props="([^"]*)"/g;
  let m, best = '';
  while ((m = re.exec(html)) !== null) if (m[1].length > best.length) best = m[1];
  if (!best) throw new Error('no props payload found — site layout changed');
  return JSON.parse(unesc(best));
}

const norm = (x) => String(x).toLowerCase().replace(/[^a-z0-9]/g, '');

async function main() {
  const [armorHtml, skillHtml] = [await get('/en/armor'), await get('/en/skills')];
  const A = extractProps(armorHtml);
  const S = extractProps(skillHtml);

  const T = A.guideTranslations;
  const skillName = {};
  const skillMax = {};
  Object.keys(S.skills).forEach((k) => {
    const s = S.skills[k];
    skillName[s.kind] = S.guideTranslations[s.name] || s.kind;
    skillMax[s.kind] = s.maxLevel;
  });

  // series -> monster, by enum suffix. Leather and Alloy have no monster.
  const monsterByNorm = {};
  Object.keys(A.monsters).forEach((k) => { monsterByNorm[norm(k)] = A.monsters[k]; });

  const usedSeries = {};
  Object.keys(A.armor).forEach((k) => { usedSeries[A.armor[k].seriesId] = true; });

  const series = {};
  Object.keys(A.series).forEach((k) => {
    const s = A.series[k];
    if (!usedSeries[s.id]) return;
    const mon = monsterByNorm[norm(s.series.replace(/^SERIES_/, ''))] || null;
    series[s.id] = {
      id: s.id,
      name: T['SERIES_NAME_' + s.id] || s.series,
      species: mon ? mon.species : null,
      monsterSort: mon ? mon.sortOrder : Infinity,
      minGrade: mon ? mon.minGrade : null,
    };
  });

  // pieces at max grade, skills in payload order
  const pieces = [];
  Object.keys(A.armor).forEach((k) => {
    const a = A.armor[k];
    const grades = (a.grades || []).slice().sort((x, y) => x.grade - y.grade);
    if (!grades.length) return;
    const top = grades[grades.length - 1];
    const name = String(T['ARMOR_NAME_' + grades[0].armorId] || a.id).replace(/\s+\d+$/, '');
    pieces.push({
      name: name,
      slot: a.category,
      seriesId: a.seriesId,
      skills: (top.skills || []).map((sk) => ({
        name: skillName[sk.kind] || sk.kind,
        level: sk.level,
        max: skillMax[sk.kind] || 1,
      })),
    });
  });

  // tier the series: boss (ELDER) first, then by the monster's release order
  const list = Object.keys(series).map((id) => series[id]);
  const elders = list.filter((s) => s.species === 'ELDER').sort((a, b) => a.monsterSort - b.monsterSort);
  const rest = list.filter((s) => s.species !== 'ELDER').sort((a, b) => a.monsterSort - b.monsterSort);

  const out = [];
  const w = (s) => out.push(s === undefined ? '' : s);

  w('# Which equipment got the balance buff?');
  w('');
  w('Generated ' + new Date().toISOString().slice(0, 10) +
    ' from the live ' + HOST + ' payload, which has **not** yet been updated for the patch.');
  w('');
  w('The in-game notice says the adjusted gear is *boss material forged equipment, and some');
  w('early stage released monster material equipment*. So this list is ordered:');
  w('');
  w('1. **Boss material** — the ' + elders.length + ' series whose monster is an Elder Dragon.');
  w('2. **Early released monsters** — every other series, oldest monster first.');
  w('');
  w('## The pattern so far');
  w('');
  w('On the Kushala Set, the piece\'s **second listed skill** went from Lv1 to Lv2 on 4 of 5');
  w('pieces. The chest (Kushala Cista, Partbreaker) did **not** change. That is one data');
  w('point, not a rule — the tables below print what the source says so you can compare');
  w('against the game, whatever the real rule turns out to be.');
  w('');
  w('Only pieces whose second skill is currently **Lv1 and has a cap above 1** can gain that');
  w('buff, so only those are listed — a skill like Lock On maxes at 1 and can never move.');
  w('`?` is for you to fill in.');
  w('');
  w('Legend: **bold** = the second skill, the buff candidate.');
  w('');

  let candidateCount = 0;
  let fixedCount = 0;

  // A piece can only gain the buff if it has a second skill, that skill is at
  // Lv1, and its cap is above 1. Anything else cannot move, so it is listed
  // separately as a control rather than dropped silently.
  const canMove = (p) => p.skills.length >= 2 && p.skills[1].level === 1 && p.skills[1].max > 1;
  const whyNot = (p) => {
    if (p.skills.length < 2) return 'only ' + p.skills.length + ' skill';
    if (p.skills[1].max <= 1) return p.skills[1].name + ' caps at Lv1';
    return p.skills[1].name + ' already Lv' + p.skills[1].level;
  };

  function section(title, arr, note) {
    w('---');
    w('');
    w('## ' + title);
    if (note) { w(''); w(note); }
    w('');
    arr.forEach((s) => {
      const all = pieces
        .filter((p) => p.seriesId === s.id)
        .sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot));
      const movers = all.filter(canMove);
      const fixed = all.filter((p) => !canMove(p));
      if (!all.length) return;
      candidateCount += movers.length;
      fixedCount += fixed.length;

      w('### ' + s.name + (s.species ? '  _(' + s.species.toLowerCase() + ')_' : '  _(crafted)_'));
      w('');
      if (movers.length) {
        w('| Piece | Slot | Skills as the source has them | If the rule holds | Matches game? |');
        w('| --- | --- | --- | --- | --- |');
        movers.forEach((p) => {
          const txt = p.skills.map((sk, i) =>
            (i === 1 ? '**' + sk.name + ' ' + sk.level + '**' : sk.name + ' ' + sk.level)).join(', ');
          w('| ' + p.name + ' | ' + SLOT_LABEL[p.slot] + ' | ' + txt + ' | ' +
            p.skills[1].name + ' → **2** | ? |');
        });
        w('');
      }
      if (fixed.length) {
        w('<details><summary>' + fixed.length + ' piece(s) that cannot change — spot-check only</summary>');
        w('');
        w('| Piece | Slot | Skills as the source has them | Why it cannot move |');
        w('| --- | --- | --- | --- |');
        fixed.forEach((p) => {
          w('| ' + p.name + ' | ' + SLOT_LABEL[p.slot] + ' | ' +
            p.skills.map((sk) => sk.name + ' ' + sk.level).join(', ') + ' | ' + whyNot(p) + ' |');
        });
        w('');
        w('</details>');
        w('');
      }
    });
  }

  const eldersOnly = process.argv.indexOf('--elders') > -1;

  section('Boss material (Elder Dragons)', elders,
    'Named directly by the notice. Mark the ones that do **not** match.');
  if (!eldersOnly) {
    section('Everything else, oldest monster first', rest,
      'The notice says *some* of these. Work down until you stop finding changes — ' +
      'that boundary is the answer.');
  } else {
    w('---');
    w('');
    w('_Non-elder series omitted (`node checklist.js` without `--elders` includes them)._');
    w('');
  }

  w('---');
  w('');
  w('When you have filled some in, tell me the piece and the new level and I can apply them');
  w('as overrides on top of the stale source, so the picker and spreadsheet are right before');
  w('the site catches up.');
  w('');

  fs.writeFileSync(OUT, out.join('\n'), 'utf8');

  console.log('wrote ' + path.basename(OUT));
  console.log('  elder-dragon series: ' + elders.length + ' (' + elders.map((s) => s.name).join(', ') + ')');
  console.log('  other series:        ' + rest.length);
  console.log('  pieces the rule could change: ' + candidateCount);
  console.log('  pieces that cannot change:    ' + fixedCount + ' (2nd skill already >Lv1, capped, or absent)');
  if (!eldersOnly) console.log('  first 8 by release:  ' + rest.slice(0, 8).map((s) => s.name).join(', '));
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
