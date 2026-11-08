/*
 * Exhaustive armour-set search. Shared by the CLI and the website; loads in Node
 * (require) and in the browser (<script>).
 *
 * Callers supply armour already shaped as:
 *   { name, slot, series, skills: {SkillName: level}, slots }
 * where `slots` is the piece's driftsmelt slot count at max grade.
 */

'use strict';

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./suggest-engine.js'));
  } else {
    root.SuggestSearch = factory(root.SuggestEngine);
  }
}(typeof self !== 'undefined' ? self : this, function (E) {

  var SLOTS = ['HEAD', 'CHEST', 'ARMS', 'TORSO', 'LEGS'];

  // Skills where "more is never worse" fails, so Pareto pruning must leave them
  // alone. Critical Ferocity and Raw Power buy something with affinity. Latent
  // Power is the mirror image: it RAISES affinity, which wrecks a Critical
  // Ferocity build by dragging the final figure back towards zero, so a bundle
  // carrying it is not automatically better than one without.
  var NON_MONOTONIC = { 'Critical Ferocity': 1, 'Raw Power': 1, 'Latent Power': 1 };

  /**
   * Collapse each slot's pieces into distinct skill bundles, then drop any
   * bundle another bundle matches or beats on every skill and on slot count.
   *
   * This is what makes the search exact rather than a sample: 2 billion sets
   * become about 2 million, because 76 head pieces only express 28 distinct
   * skill combinations and damage depends on skill TOTALS, not on which piece
   * supplied them.
   */
  function buildBundles(armour, known, own) {
    var out = {};
    SLOTS.forEach(function (slot) {
      var seen = {};
      armour.filter(function (a) { return a.slot === slot; }).forEach(function (a) {
        // A driftstone skill is applied BEFORE grouping: two pieces printing the
        // same skills stop being interchangeable once one carries a gem.
        var base = {};
        Object.keys(a.skills || {}).forEach(function (n) { base[n] = a.skills[n]; });
        if (own && own[a.name]) {
          Object.keys(own[a.name]).forEach(function (n) {
            base[n] = (base[n] || 0) + own[a.name][n];
          });
        }
        var v = {};
        Object.keys(base).forEach(function (n) { if (known[n]) v[n] = base[n]; });
        var k = Object.keys(v).sort().map(function (n) { return n + v[n]; }).join(',');
        if (!seen[k]) seen[k] = { v: v, slots: a.slots || 0, pieces: [] };
        seen[k].pieces.push(a);
        if ((a.slots || 0) > seen[k].slots) seen[k].slots = a.slots || 0;
      });
      var list = Object.keys(seen).map(function (k) { return seen[k]; });
      var hasNM = function (b) {
        return Object.keys(b.v).some(function (n) { return NON_MONOTONIC[n]; });
      };
      var dominated = function (x, y) {
        if (hasNM(x) || hasNM(y)) return false;
        if (y.slots < x.slots) return false;
        var keys = {};
        Object.keys(x.v).forEach(function (n) { keys[n] = 1; });
        Object.keys(y.v).forEach(function (n) { keys[n] = 1; });
        var strict = y.slots > x.slots;
        for (var n in keys) {
          var a = x.v[n] || 0, b = y.v[n] || 0;
          if (a > b) return false;
          if (b > a) strict = true;
        }
        return strict;
      };
      out[slot] = list.filter(function (x) {
        return !list.some(function (y) { return y !== x && dominated(x, y); });
      });
    });
    return out;
  }

  /**
   * opts: { gems, damageOnly, own, top, gemmable }
   *   gems      assume every driftsmelt slot carries the set's best skill
   *   gemmable  map of skill name -> true, the skills a driftgem can grant
   */
  /**
   * A bowgun fits more than one style, and each is a different build. Search
   * each separately and merge, so the leaders can come from different styles
   * and the best one wins on its merits rather than on a style chosen up front.
   */
  function run(armour, weapon, opts) {
    opts = opts || {};
    var variants = E.styleVariants(weapon);
    if (variants.length < 2) return runOne(armour, variants[0].weapon, opts);

    var merged = [], first = null;
    variants.forEach(function (v) {
      var out = runOne(armour, v.weapon, opts);
      if (!first) first = out;
      out.results.forEach(function (r) { r.style = v.label; });
      merged = merged.concat(out.results);
    });
    merged.sort(function (x, y) { return y.score - x.score; });

    // Two styles reaching the same skill totals is the same build twice: the
    // style only mattered through Recoil Down or Reload Speed, and neither made
    // the set. Listing it once, noting the style is free, beats presenting a
    // choice that is not one.
    var seen = {}, unique = [];
    merged.forEach(function (r) {
      var key = Object.keys(r.totals).sort().map(function (n) {
        return n + r.totals[n];
      }).join(',');
      if (seen[key]) { seen[key].styleFree = true; return; }
      seen[key] = r;
      unique.push(r);
    });

    first.results = unique.slice(0, opts.top || 5);
    first.variants = variants.map(function (v) { return v.label; });
    return first;
  }

  function runOne(armour, weapon, opts) {
    opts = opts || {};
    var top = opts.top || 5;
    var knownSet = E.knownSkills(weapon);
    var known = {};
    knownSet.forEach(function (n) { known[n] = 1; });

    var bundles = buildBundles(armour, known, opts.own);
    var space = SLOTS.reduce(function (n, s) { return n * bundles[s].length; }, 1);

    var SC = E.makeScorer(weapon, !!opts.damageOnly);
    var totals = new Int16Array(SC.names.length);

    // The weapon's OWN skills are part of every set and were being ignored
    // entirely. All 748 weapons carry at least one: Wyvern Strife brings
    // Critical Element 2, so it needs three more from armour rather than five,
    // and Bloom Snow Wail+ brings Elemental Release 1. Seeding them here means
    // the search sees what the armour actually has to supply, and the Lv5
    // thresholds that switch on the Advanced skills are measured correctly.
    var weaponSkills = {};
    Object.keys(weapon.skills || {}).forEach(function (n) {
      if (!known[n]) return;                 // not relevant to this weapon's damage
      weaponSkills[n] = weapon.skills[n];
      totals[SC.at[n]] += weapon.skills[n];
    });

    SLOTS.forEach(function (slot) {
      bundles[slot].forEach(function (b) {
        b.idx = [];
        Object.keys(b.v).forEach(function (n) {
          if (SC.at[n] !== undefined) b.idx.push([SC.at[n], b.v[n]]);
        });
      });
    });
    var addB = function (b, sign) {
      for (var i = 0; i < b.idx.length; i++) totals[b.idx[i][0]] += sign * b.idx[i][1];
    };

    // Each driftsmelt slot is independent, so five slots can hold five different
    // skills. Allocation is greedy: repeatedly take the gem with the best
    // marginal gain. That finds the threshold plays — reaching Lv5 to switch on
    // an Advanced skill shows up as the largest single gain there is.
    // Built whether or not gems are being assumed: with them off the ranking
    // ignores gems, but the finalists are still told what their slots could
    // hold. Choosing the set on its own merit and then learning what to aim for
    // is more useful than either hiding the slots or letting them bias the
    // search towards slot-heavy pieces.
    var gemIdx = [];
    SC.names.forEach(function (n) {
      if (!E.UTILITY[n] && (!opts.gemmable || opts.gemmable[n])) gemIdx.push(SC.at[n]);
    });
    function allocateGems(slots) {
      if (!slots || !gemIdx.length) return null;
      var taken = [];
      for (var s = 0; s < slots; s++) {
        var bestI = -1, bestV = -Infinity;
        for (var k = 0; k < gemIdx.length; k++) {
          var i = gemIdx[k];
          if (totals[i] >= 5) continue;
          totals[i]++;
          var v = SC.scoreVec(totals);
          totals[i]--;
          if (v > bestV) { bestV = v; bestI = i; }
        }
        if (bestI < 0) break;
        totals[bestI]++;
        taken.push(bestI);
      }
      var sc = SC.scoreVec(totals);
      taken.forEach(function (i) { totals[i]--; });
      return { score: sc, taken: taken };
    }

    // Keep only the leaders; collecting every result exhausted the heap.
    var results = [], worst = -Infinity;
    function offer(rec) {
      if (results.length >= top && rec.score <= worst) return;
      results.push(rec);
      results.sort(function (x, y) { return y.score - x.score; });
      if (results.length > top) results.length = top;
      worst = results[results.length - 1].score;
    }

    var H = bundles.HEAD, C = bundles.CHEST, A = bundles.ARMS, T = bundles.TORSO, L = bundles.LEGS;
    for (var hi = 0; hi < H.length; hi++) {
      addB(H[hi], 1);
      for (var ci = 0; ci < C.length; ci++) {
        addB(C[ci], 1);
        for (var ai = 0; ai < A.length; ai++) {
          addB(A[ai], 1);
          for (var ti = 0; ti < T.length; ti++) {
            addB(T[ti], 1);
            for (var li = 0; li < L.length; li++) {
              addB(L[li], 1);
              var picks = [H[hi], C[ci], A[ai], T[ti], L[li]];
              var slots = 0;
              for (var p = 0; p < 5; p++) slots += picks[p].slots;
              var sc, gems = null;
              if (opts.gems) {
                var g = allocateGems(slots);
                sc = g ? g.score : SC.scoreVec(totals);
                gems = g ? g.taken : null;
              } else {
                sc = SC.scoreVec(totals);
              }
              if (results.length < top || sc > worst) {
                offer({ score: sc, picks: picks, slots: slots, gems: gems });
              }
              addB(L[li], -1);
            }
            addB(T[ti], -1);
          }
          addB(A[ai], -1);
        }
        addB(C[ci], -1);
      }
      addB(H[hi], -1);
    }

    // Rebuild the detail for the finalists only.
    results.forEach(function (r) {
      var tot = {};
      Object.keys(weaponSkills).forEach(function (n) { tot[n] = weaponSkills[n]; });
      r.picks.forEach(function (b) {
        Object.keys(b.v).forEach(function (n) { tot[n] = (tot[n] || 0) + b.v[n]; });
      });
      if (r.gems) {
        var count = {};
        r.gems.forEach(function (i) { count[SC.names[i]] = (count[SC.names[i]] || 0) + 1; });
        r.gemText = Object.keys(count).map(function (n) { return count[n] + ' x ' + n; }).join(', ');
        Object.keys(count).forEach(function (n) { tot[n] = (tot[n] || 0) + count[n]; });
      }
      r.totals = tot;
      r.detail = E.score(tot, weapon);

      // Gems were not part of the ranking, so work out what the slots could
      // hold and what it would be worth. Only the finalists, so the cost is
      // nothing next to the search itself.
      // Capped, because the allocation optimises for damage with no notion of
      // how hard a roll is. Filling all five slots is a target you may never
      // reach; the first couple of rolls are the ones worth chasing.
      var preview = Math.min(r.slots, opts.gemPreview === undefined ? 2 : opts.gemPreview);
      if (!opts.gems && preview > 0 && gemIdx.length) {
        r.picks.forEach(function (b) { addB(b, 1); });
        var g = allocateGems(preview);
        r.picks.forEach(function (b) { addB(b, -1); });
        if (g && g.taken.length) {
          var c2 = {};
          g.taken.forEach(function (i) { c2[SC.names[i]] = (c2[SC.names[i]] || 0) + 1; });
          var withGems = {};
          Object.keys(tot).forEach(function (n) { withGems[n] = tot[n]; });
          Object.keys(c2).forEach(function (n) { withGems[n] = (withGems[n] || 0) + c2[n]; });
          r.gemPotential = {
            text: Object.keys(c2).map(function (n) { return c2[n] + ' x ' + n; }).join(', '),
            detail: E.score(withGems, weapon),
            used: g.taken.length,
          };
        }
      }
    });

    return { results: results, space: space, bundles: bundles, names: SC.names,
      known: known, weaponSkills: weaponSkills };
  }

  return { run: run, buildBundles: buildBundles, SLOTS: SLOTS };
}));
