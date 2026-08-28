/**
 * The in-game display names for the kinsect enums, and the check that keeps them
 * honest.
 *
 *   node kinsect-labels.js          verify the readings and print the mapping
 *
 * The source publishes kinsect attributes only as enums, and its enum names are
 * not the words the game shows — in one case they invert:
 *
 *     EXTEND_ENHANCEMENT      shows as  "Harvest Bonus"
 *     ENHANCEMENT_HARVEST_UP  shows as  "Charged Harvest Bonus"
 *
 * so a name-similarity match gets that pair exactly backwards. The mapping below
 * was derived instead from ten glaives read in game, chosen by set cover so that
 * between them they exhibit every distinct value of every kinsect field. Their
 * readings are in kinsect-readings.txt.
 *
 * Each reading carries three values that were already known from other glaives,
 * so every line after the first is a check as well as a source of new
 * information. This script re-runs all of those checks.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const HERE = __dirname;

// In-game display name -> source enum. Kinsect type, Performance type, Attack
// type and Kinsect bonus are the four attributes the game shows, in that order.
const LABELS = {
  kinsect_attack_type: { PIERCE: 'Flight', SMASH: 'Assist', POWDER: 'Powder' },
  kinsect_parameter_type: {
    PARAMETER_TYPE_POWER: 'Power',
    PARAMETER_TYPE_QUICK: 'Rapid',
    PARAMETER_TYPE_STAMINA: 'Stamina',
  },
  kinsect_attack_attribute: {
    ATTACK_ATTRIBUTE_CUT: 'Severing',
    ATTACK_ATTRIBUTE_BLUNT: 'Blunt',
  },
  kinsect_bonus_kind: {
    PIERCE_TYPE_1: 'Follow-Up Bonus',
    PIERCE_TYPE_2: 'Aerial Bonus',
    POWDER_TYPE_1: 'Stamina Bonus',
    POWDER_TYPE_2: 'Mighty Powder Bonus',
    POWDER_TYPE_3: 'Cluster Powder Bonus',
    SMASH_TYPE_1: 'Stun Bonus',
    SMASH_TYPE_2: 'Assist Bonus',
    SMASH_TYPE_3: 'Elemental Bonus',
    EXTEND_ENHANCEMENT: 'Harvest Bonus',
    ENHANCEMENT_HARVEST_UP: 'Charged Harvest Bonus',
  },
};

// The game does not show attack level or stamina level. They are perfectly
// correlated with each other — only three of the nine combinations occur — so
// they behave as one hidden stat axis rather than two fields.
const HIDDEN = ['kinsect_attack_level', 'kinsect_stamina_level'];

const ORDER = ['kinsect_attack_type', 'kinsect_parameter_type',
  'kinsect_attack_attribute', 'kinsect_bonus_kind'];

function verify() {
  const d = JSON.parse(fs.readFileSync(path.join(HERE, 'data.json'), 'utf8'));
  const byName = {};
  d.weapons.forEach((w) => { if (w.category === 'INSECT_GLAIVE') byName[w.name] = w; });

  const file = path.join(HERE, 'kinsect-readings.txt');
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
    .map((l) => l.trim()).filter((l) => l && l.charAt(0) !== '#');

  let checks = 0, bad = 0, unread = 0;
  lines.forEach((line) => {
    const parts = line.split('|');
    const name = parts[0].trim();
    const vals = (parts[1] || '').split(',').map((s) => s.trim());
    const w = byName[name];
    if (!w) { console.log('  ' + name + ': not a glaive in the data'); unread++; return; }
    if (vals.length !== ORDER.length) { console.log('  ' + name + ': expected 4 values'); bad++; return; }

    const wrong = [];
    ORDER.forEach((f, i) => {
      const expected = LABELS[f][w[f]];
      checks++;
      if (expected === undefined) wrong.push(f + ' has unmapped enum ' + w[f]);
      else if (expected !== vals[i]) wrong.push(f + ': game says "' + vals[i] +
        '", enum ' + w[f] + ' maps to "' + expected + '"');
    });
    if (wrong.length) { bad++; wrong.forEach((x) => console.log('  MISMATCH ' + name + ' — ' + x)); }
  });

  console.log(lines.length + ' readings, ' + checks + ' value checks, ' +
    bad + ' mismatched, ' + unread + ' not found');

  // Is every enum the source uses now named?
  const glaives = d.weapons.filter((w) => w.category === 'INSECT_GLAIVE' && w.kinsect_attack_type);
  let missing = 0;
  ORDER.forEach((f) => {
    const seen = {};
    glaives.forEach((w) => { if (w[f] && LABELS[f][w[f]] === undefined) seen[w[f]] = true; });
    Object.keys(seen).forEach((v) => { console.log('  no display name for ' + f + ' = ' + v); missing++; });
  });
  console.log('unmapped enums still in use: ' + missing);

  // And does the hidden axis still behave as one?
  // Event glaives have no level data at all — the game does not show it — so they
  // are excluded rather than counted as a combination of their own.
  const combos = {};
  glaives.filter((w) => w[HIDDEN[0]] && w[HIDDEN[1]])
    .forEach((w) => { combos[w[HIDDEN[0]] + '|' + w[HIDDEN[1]]] = true; });
  console.log('attack level / stamina level combinations: ' + Object.keys(combos).length +
    ' (a single hidden axis while this stays at 3)');

  return bad === 0 && missing === 0;
}

module.exports = { LABELS: LABELS, ORDER: ORDER };

if (require.main === module) {
  const ok = verify();
  console.log('\n' + (ok ? 'mapping verified' : 'mapping DOES NOT hold — see above'));
  ORDER.forEach((f) => {
    console.log('\n' + f);
    Object.keys(LABELS[f]).forEach((k) => console.log('   ' + k.padEnd(24) + LABELS[f][k]));
  });
}
