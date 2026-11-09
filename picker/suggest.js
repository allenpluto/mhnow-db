/* MHN set suggester — UI only. The scoring is suggest-engine.js and the search
   is suggest-search.js, both shared with the command line tool. */

(function () {
  'use strict';

  var DATA = JSON.parse(document.getElementById('data').textContent);
  var E = window.SuggestEngine, S = window.SuggestSearch;
  var SLOT_LABEL = { HEAD: 'Head', CHEST: 'Chest', ARMS: 'Arms', TORSO: 'Waist', LEGS: 'Legs' };

  var elWeapon = document.getElementById('s-weapon');
  var elAtk = document.getElementById('s-atk');
  var elEle = document.getElementById('s-ele');
  var elAff = document.getElementById('s-aff');
  var elOpts = document.getElementById('s-opts');
  var elGo = document.getElementById('s-go');
  var elStatus = document.getElementById('s-status');
  var elOut = document.getElementById('s-out');
  var elNotes = document.getElementById('s-notes');

  // --- weapon list, grouped by type, narrowed by keywords ------------------
  //
  // 748 weapons is far too many to scroll. Keywords are comma separated and
  // every one must match, each against the name, the weapon type or the
  // element — so "bloom, charge blade, ice" narrows on all three at once.
  // Keywords are AND rather than OR because the point is to get to one weapon.
  var elFind = document.getElementById('s-find');
  var elFindMsg = document.getElementById('s-find-msg');

  function haystack(w) {
    return (w.name + ' ' + w.category + ' ' + w.element).toLowerCase();
  }

  function buildWeaponList() {
    var terms = (elFind.value || '').split(',')
      .map(function (s) { return s.trim().toLowerCase(); })
      .filter(Boolean);

    var list = DATA.weapons.filter(function (w) {
      var h = haystack(w);
      return terms.every(function (t) { return h.indexOf(t) > -1; });
    });

    var was = elWeapon.value;
    elWeapon.innerHTML = '';
    var blank = document.createElement('option');
    blank.value = '';
    blank.textContent = list.length ? 'choose a weapon' : 'nothing matches';
    elWeapon.appendChild(blank);

    var byCat = {};
    list.forEach(function (w) { (byCat[w.category] = byCat[w.category] || []).push(w); });
    Object.keys(byCat).forEach(function (cat) {
      var g = document.createElement('optgroup');
      g.label = cat;
      byCat[cat].forEach(function (w) {
        var o = document.createElement('option');
        o.value = w.name;
        o.textContent = w.name + '  —  ' + w.element + ' ' +
          (w.ele ? w.ele + ' ' : '') + 'atk ' + w.atk + ' aff ' + w.aff + '%';
        g.appendChild(o);
      });
      elWeapon.appendChild(g);
    });

    // Keep the chosen weapon if it survived the narrowing.
    var kept = list.some(function (w) { return w.name === was; });
    elWeapon.value = kept ? was : '';

    elFindMsg.textContent = !terms.length
      ? DATA.weapons.length + ' weapons'
      : list.length + ' of ' + DATA.weapons.length + ' match' +
        (was && !kept ? ' — your choice was cleared' : '');
    elFindMsg.className = list.length ? 'hint' : 'hint warn';
    return list;
  }

  elFind.addEventListener('input', buildWeaponList);
  buildWeaponList();

  var opts = { gems: false, damageOnly: true, multiplayer: false, statSlots: false };
  var slotBox = null;
  [['damageOnly', 'Damage only (ignore utility weights)'],
   ['gems', 'Assume ideal driftgems'],
   ['statSlots', 'Spend the 3 customisation stat slots'],
   ['multiplayer', 'Group hunt (blast stacks from other players)']].forEach(function (pair) {
    var lab = document.createElement('label');
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!opts[pair[0]];
    lab.className = cb.checked ? 'on' : '';
    cb.addEventListener('change', function () {
      opts[pair[0]] = cb.checked;
      lab.className = cb.checked ? 'on' : '';
    });
    lab.appendChild(cb);
    lab.appendChild(document.createTextNode(pair[1]));
    elOpts.appendChild(lab);
    if (pair[0] === 'statSlots') slotBox = { label: lab, input: cb };
  });

  /**
   * The stat slots only exist on a customised weapon, so the box turns itself
   * off and greys out when the chosen weapon has none — rather than silently
   * handing out three slots the weapon has not got.
   */
  function syncSlotBox(weapon) {
    if (!slotBox) return;
    var ok = !!(weapon && weapon.styleSelectable);
    slotBox.input.disabled = !ok;
    slotBox.label.title = ok ? '' : 'This weapon is not customisable, so it has no stat slots';
    slotBox.label.style.opacity = ok ? '' : '0.45';
    if (!ok && slotBox.input.checked) {
      slotBox.input.checked = false;
      opts.statSlots = false;
      slotBox.label.className = '';
    }
  }

  /**
   * Parse the "Piece = Skill" box.
   *
   * A misspelt piece name would otherwise be silently ignored and quietly
   * change the recommendation, so unknown names are reported back.
   */
  function parseOwn() {
    var elOwn = document.getElementById('s-own');
    var msg = document.getElementById('s-own-msg');
    var own = {}, bad = [], count = 0;
    var pieces = {};
    DATA.armour.forEach(function (a) { pieces[a.name.toLowerCase()] = a.name; });

    (elOwn.value || '').split('\n').forEach(function (line) {
      line = line.trim();
      if (!line) return;
      var m = line.match(/^(.*?)=\s*(.*?)(?:\s+(\d+))?$/);
      if (!m) { bad.push(line); return; }
      var piece = pieces[m[1].trim().toLowerCase()];
      var skill = m[2].trim();
      if (!piece || !skill) { bad.push(line); return; }
      own[piece] = own[piece] || {};
      own[piece][skill] = (own[piece][skill] || 0) + (Number(m[3]) || 1);
      count++;
    });

    msg.textContent = bad.length
      ? 'Not recognised, so ignored: ' + bad.join(' / ')
      : (count ? count + ' driftstone skill' + (count === 1 ? '' : 's') + ' applied.' : '');
    msg.className = bad.length ? 'hint warn' : 'hint';
    return own;
  }

  // --- run -----------------------------------------------------------------
  function run() {
    var pick = DATA.weapons.filter(function (w) { return w.name === elWeapon.value; })[0];
    if (!pick) { elStatus.textContent = 'Pick a weapon first.'; return; }

    var W = {
      name: pick.name, category: pick.category, element: pick.element,
      atk: pick.atk + (Number(elAtk.value) || 0),
      ele: pick.ele + (Number(elEle.value) || 0),
      aff: pick.aff + (Number(elAff.value) || 0),
      skills: pick.skills || {},      // the weapon's own skills count too
      styleSelectable: !!pick.styleSelectable,
      ammo: pick.ammo || [],
      // Magazine size and handling tier per round. Without these the handling
      // skills fall back to their flat tables instead of being priced off the
      // weapon's own cycle, which is most of what makes them worth anything.
      rounds: pick.rounds || [],
      statSlots: opts.statSlots && !!pick.styleSelectable,
    };
    var isStatus = E.STATUS.indexOf(W.element) >= 0;

    // Hunt length drives Latent Power's uptime and Rising Tide's ramp, so it
    // must be set before the scorer is built.
    E.ASSUME.huntSeconds = Number(document.getElementById('s-hunt').value) || 75;
    E.ASSUME.multiplayer = opts.multiplayer;

    elStatus.textContent = 'Searching…';
    elOut.innerHTML = '';
    // Let the browser paint "Searching…" before the loop blocks it.
    setTimeout(function () {
      var t0 = Date.now();
      var out = S.run(DATA.armour, W, {
        gems: opts.gems, damageOnly: opts.damageOnly, top: 5,
        gemmable: DATA.gemmable, own: parseOwn(),
      });
      var secs = ((Date.now() - t0) / 1000).toFixed(1);

      var brings = Object.keys(W.skills).map(function (n) { return n + ' ' + W.skills[n]; });
      elStatus.textContent = W.name + ' — ' + W.category + ' — ' + W.element +
        '  ·  attack ' + W.atk + ', ' + (isStatus ? 'buildup ' : 'element ') + W.ele +
        (isStatus ? ' (status, excluded from damage)' : '') + ', affinity ' + W.aff + '%' +
        (brings.length ? '  ·  weapon brings ' + brings.join(', ') : '') +
        '  ·  ' + out.space.toLocaleString() + ' sets searched in ' + secs + 's';

      render(out, W, isStatus);
    }, 20);
  }

  function render(out, W, isStatus) {
    elOut.innerHTML = '';
    out.results.forEach(function (r, i) {
      var box = document.createElement('div');
      box.className = 'setcard';

      // Always lead with damage, in both modes. Heading the utility ranking with
      // its score invited comparing that score against a damage figure from the
      // other mode — they are different units, and the score is always the
      // larger of the two, which made utility ranking look like more damage.
      var h = document.createElement('h2');
      h.textContent = '#' + (i + 1) + '  damage ' + Math.round(r.detail.dmg).toLocaleString();
      if (!opts.damageOnly) {
        var sm = document.createElement('span');
        sm.className = 'muted';
        sm.textContent = r.detail.util
          ? '  ·  ranked on score ' + Math.round(r.detail.total).toLocaleString() +
            ' (x' + (1 + r.detail.util).toFixed(2) + ' utility)'
          : '  ·  no utility skills, so score = damage';
        h.appendChild(sm);
      }
      box.appendChild(h);

      var tbl = document.createElement('table');
      tbl.className = 'setparts';
      S.SLOTS.forEach(function (slot, j) {
        var b = r.picks[j];
        var tr = document.createElement('tr');
        var names = b.pieces.map(function (p) { return p.name; });
        var cells = [
          SLOT_LABEL[slot],
          names[0] + (names.length > 1 ? ' (or ' + (names.length - 1) + ' equivalent)' : ''),
          b.pieces[0].series,
          Object.keys(b.v).map(function (n) { return n + ' ' + b.v[n]; }).join(', ') || '—',
        ];
        cells.forEach(function (t, k) {
          var td = document.createElement('td');
          td.textContent = t;
          if (k === 0) td.className = 'slot';
          if (k === 3) td.className = 'sk';
          tr.appendChild(td);
        });
        tbl.appendChild(tr);
      });
      box.appendChild(tbl);

      // The bowgun style and the three stat slots are both chosen with the
      // set rather than before it, so they belong on the card beside it.
      if (r.style) {
        var st = document.createElement('p');
        st.className = 'gems';
        st.textContent = 'Style: ' + r.style +
          (r.styleFree ? '  (either style reaches this set — the handling skill did not make it)' : '');
        box.appendChild(st);
      }
      if (r.detail.statSlots) {
        var ss = document.createElement('p');
        ss.className = 'gems';
        ss.textContent = 'Stat slots: ' + r.detail.statSlots;
        box.appendChild(ss);
      }

      if (r.gemText) {
        var g = document.createElement('p');
        g.className = 'gems';
        g.textContent = 'Driftgems: ' + r.gemText + '  (' + r.slots + ' slot' + (r.slots === 1 ? '' : 's') + ')';
        box.appendChild(g);
      } else if (r.gemPotential) {
        // Gems did not influence the ranking, so this is what the set's slots
        // are worth if you can roll them — stated as a gain, not folded in.
        var gp = document.createElement('p');
        gp.className = 'gems potential';
        var gain = Math.round(r.gemPotential.detail.dmg - r.detail.dmg);
        gp.textContent = r.slots + ' driftsmelt slot' + (r.slots === 1 ? '' : 's') +
          ' — your best ' + r.gemPotential.used + ' roll' + (r.gemPotential.used === 1 ? '' : 's') +
          ' would be ' + r.gemPotential.text +
          ', for damage ' + Math.round(r.gemPotential.detail.dmg).toLocaleString() +
          ' (+' + gain.toLocaleString() + '). Not counted in the ranking.';
        box.appendChild(gp);
      } else if (r.slots) {
        var gn = document.createElement('p');
        gn.className = 'gems potential';
        gn.textContent = r.slots + ' driftsmelt slot' + (r.slots === 1 ? '' : 's') +
          ', but nothing useful to put in them.';
        box.appendChild(gn);
      }

      var tot = document.createElement('p');
      tot.className = 'totals';
      tot.textContent = 'Totals: ' + Object.keys(r.totals).sort().map(function (n) {
        return n + ' ' + r.totals[n];
      }).join(', ');
      box.appendChild(tot);
      elOut.appendChild(box);
    });

    // Say plainly what the numbers rest on. Several of these are assumptions
    // rather than data, and the winning set often turns on one of them.
    var ignored = {};
    var RECOIL_WORD = ['Low', 'Average', 'High', 'Very high'];
    var RELOAD_WORD = ['Fast', 'Normal', 'Slow', 'Very slow'];

    /**
     * What this particular bowgun's firing looks like, in the measured numbers.
     *
     * The handling skills and the styles are the only part of this model that
     * rests on measurement rather than assumption, and they are also the part
     * whose value swings most from weapon to weapon — the same skill is worth
     * nothing on one gun and a third of its damage on another. So the figures
     * are shown for the weapon in hand, not as a general table.
     */
    function rangedNotes(weapon, winningStyle) {
      var rounds = weapon.rounds || [];
      if (!rounds.length) return [];
      var out = [];
      // Price the handling skills under the style the winning set is played
      // on, not unstyled — a style can take one of them to nothing.
      var variants = E.styleVariants(weapon);
      var played = weapon;
      variants.forEach(function (v) { if (v.label && v.label === winningStyle) played = v.weapon; });

      out.push('MEASURED, not assumed. Timed off gameplay video by decoding the ' +
        'on-screen hit counter frame by frame: a shot lands every 0.60s at Low ' +
        'recoil, 0.86s Average, 1.06s High and 2.06s Very high. Swapping magazine ' +
        'takes 1.90s into a Fast one, 2.85s Normal, 3.30s Slow and 4.83s Very slow. ' +
        'The tier on the weapon screen is the whole story — a magazine that Recoil ' +
        'Down has moved to Average fires exactly like one that is natively Average.');

      var seen = {};
      var mags = rounds.filter(function (r) {
        if (seen[r.type]) return false;
        seen[r.type] = 1;
        return true;
      });
      out.push('This weapon carries ' + mags.map(function (r) {
        return r.type.toLowerCase() + ' x' + r.capacity + ', ' +
          RECOIL_WORD[E.bandAfter(r.recoil, 0)] + ' recoil and ' +
          RELOAD_WORD[E.bandAfter(r.reload, 0)] + ' reload';
      }).join('; ') + '.');

      // Recoil Down and Reload Speed do not shave a percentage: they step down
      // a finer ladder, so a level can move one magazine a whole band and
      // another none at all. Spelling that out per magazine is the only way the
      // odd-looking skill values make sense.
      [['Recoil Down', 'recoil', RECOIL_WORD], ['Reload Speed', 'reload', RELOAD_WORD]]
        .forEach(function (pair) {
          var moves = mags.map(function (r) {
            var steps = [0, 1, 2, 3].map(function (lv) {
              return pair[2][E.bandAfter(r[pair[1]], lv)];
            });
            var same = steps.every(function (s) { return s === steps[0]; });
            return r.type.toLowerCase() + ' ' +
              (same ? 'stays ' + steps[0] + ' at every level'
                : steps[0] + ' then ' + steps.slice(1).join(', '));
          });
          var tbl = E.utilityTable(pair[0], played);
          var dead = [1, 2, 3].every(function (lv) { return !tbl[lv]; });
          var why = '';
          if (dead && played !== weapon) {
            why = pair[0] === 'Reload Speed'
              ? ' Nothing at all here: ' + winningStyle.split(',')[0] + ' swaps the magazine ' +
                'on a movement, so the reload tier never reaches the cycle.'
              : ' Nothing at all here: ' + winningStyle.split(',')[0] + ' fixes the cadence, ' +
                'so the recoil tier never reaches the firing.';
          }
          out.push(pair[0] + ', by magazine, at none then Lv1, Lv2, Lv3: ' +
            moves.join('; ') + '. Worth ' +
            [1, 2, 3].map(function (lv) {
              return Math.round((tbl[lv] || 0) * 100) + '%';
            }).join(' / ') + ' of this weapon\'s damage at Lv1 / Lv2 / Lv3' +
            (played !== weapon ? ' on ' + winningStyle.split(',')[0] : '') +
            ', worked out from how much of a magazine cycle it actually removes.' +
            why + ' The tiers above are what the weapon screen shows either way.');
        });

      var styled = variants.filter(function (v) { return v.label; });
      if (styled.length) {
        out.push('Styles change the firing by more than any skill does. Stepping shot ' +
          'replaces the shot with a dodge and fires at a fixed 0.975s whatever the ' +
          'recoil, so Recoil Down is worth nothing under it. Crouching shot opens near ' +
          '0.60s, accelerates to 0.30s while firing continues, and adds 4 rounds to ' +
          'normal, piercing and spread, 2 to slicing and sticky, 1 to cluster. Sliding ' +
          'reload swaps magazine on a dodge in 2.52s; guard reload swaps in 2.05s but ' +
          'loads only half the rounds.');
        out.push('On this weapon, against no style at all: ' + styled.map(function (v) {
          return v.label.split(',')[0] + ' x' + E.styleRate(v.weapon).toFixed(2);
        }).join(', ') + '. Each style is searched as its own build, because it wants a ' +
          'different handling skill and a different ammo boost.');
      }

      out.push('Still soft here: sliding reload was timed one shot at a time, so some of ' +
        'its 2.52s is the player rather than the game; the reload figures carry a ' +
        'per-weapon offset of a few tenths, and only the gaps between tiers are firm; ' +
        'and Evading Reload is still a guess, since no recording has caught an evade ' +
        'refilling a magazine.');
      return out;
    }

    out.results[0].picks.forEach(function (b) {
      Object.keys(b.pieces[0].skills || {}).forEach(function (n) { if (!out.known[n]) ignored[n] = true; });
    });
    var a = E.ASSUME;
    var lines = [];
    if (!opts.damageOnly) {
      lines.push('Ranked on SCORE, which is damage multiplied by the utility weights — ' +
        'Power Prolonger up to x1.15, Quick Work up to x1.08, Lock On x1.05. ' +
        'A score is therefore never comparable with a damage figure, and the top set ' +
        'here will usually carry less damage than the one "damage only" finds. ' +
        'Those weights are assumptions, not data.');
    }
    if (opts.statSlots) {
      lines.push('The three customisation stat slots are being spent, and the split is ' +
        'chosen against each set rather than fixed first — affinity is worth more behind ' +
        'Critical Boost or Critical Element, element behind high affinity, attack is steady. ' +
        'On a status weapon the element slot gives +50 buildup instead of +100 element, and ' +
        'this model prices status by how often it procs rather than by the buildup number, ' +
        'so that option is left out and the choice falls between attack and affinity. ' +
        'The separate flat bonus for maxing customisation differs per weapon and is not ' +
        'included — add it in the attack and element boxes above.');
    }
    lines = lines.concat([
      'Assumptions: average health ' + (a.hpFraction * 100) + '% (the Vital skills), ' +
        'Valor ' + (a.valorUptime * 100) + '% uptime, Elemental Release ' +
        (a.elementalReleaseUptime * 100) + '%, Burst ' + (a.burstUptime * 100) + '%, ' +
        'Weakness Exploit ' + (a.weakPointUptime * 100) + '%, ' +
        'the health-threshold skills at ' + (a.peakPerformanceUptime * 100) + '%.',
      'Over a ' + a.huntSeconds + 's hunt, Latent Power is up for ' +
        Math.round(Math.max(0, (a.huntSeconds - a.latentPowerStart) / a.huntSeconds) * 100) +
        '% and Rising Tide averages ' + (30 * ((a.huntSeconds - 25) / a.huntSeconds +
        Math.max(0, a.huntSeconds - 50) / a.huntSeconds)).toFixed(0) +
        ' attack per level. Latent Power raises affinity, so it helps a crit build and ' +
        'hurts a Critical Ferocity one.',
      isStatus
        ? W.element + ' buildup is not damage itself, but it drives the skills that are: ' +
          'proc chance ' + Math.round(a.statusProcBase * 100) + '% base, rising with Status ' +
          'Sneak Attack from behind (' + Math.round(a.behindRate * 100) + '% of hits). ' +
          (W.element === 'Poison' ? 'Poison is up ' +
            Math.round(a.poisonProcsPer75s * a.poisonTickSeconds / 75 * 100) + '% of the hunt. ' : '') +
          (W.element === 'Paralysis' ? 'Paralysis is up ' +
            Math.round(a.paralysisProcsPer75s * a.paralysisTickSeconds / 75 * 100) +
            '% of the hunt, plus a flat 10% while it lasts. ' : '') +
          (W.element === 'Blast' ? 'Blast Exploit holds about ' +
            (opts.multiplayer ? '9' : '2.5') + ' stacks on average ' +
            (opts.multiplayer ? 'in a group' : 'solo, since each threshold is 30% harder') + '. ' : '') +
          'Critical Element, Elemental Release and the Vital skills are excluded.'
        : 'Only ' + W.element + ' skills are considered; other elements cannot help this weapon.',
    ]);
    if (Object.keys(ignored).length) {
      lines.push('On the winning set, these skills are scored as zero because damage cannot price them: ' +
        Object.keys(ignored).sort().join(', ') + '.');
    }
    if (opts.gems) {
      var no = out.names.filter(function (n) { return !E.UTILITY[n] && !DATA.gemmable[n]; });
      if (no.length) lines.push('No driftgem exists for: ' + no.join(', ') + ' — equipment only.');
    }
    lines = lines.concat(rangedNotes(W, out.results[0] && out.results[0].style));

    // The first line is always on show, because it says what the ranking means
    // and reading the table without it invites comparing a score with a damage.
    // The rest folds away: it has grown past what anyone reads every time.
    elNotes.innerHTML = '';
    var para = function (t) {
      var p = document.createElement('p');
      p.textContent = t;
      return p;
    };
    elNotes.appendChild(para(lines[0]));
    if (lines.length > 1) {
      var det = document.createElement('details');
      var sum = document.createElement('summary');
      sum.textContent = 'Show the details behind these numbers (' + (lines.length - 1) + ' more)';
      det.appendChild(sum);
      lines.slice(1).forEach(function (t) { det.appendChild(para(t)); });
      det.addEventListener('toggle', function () {
        sum.textContent = det.open
          ? 'Hide the details'
          : 'Show the details behind these numbers (' + (lines.length - 1) + ' more)';
      });
      elNotes.appendChild(det);
    }
  }

  function currentWeapon() {
    return DATA.weapons.filter(function (w) { return w.name === elWeapon.value; })[0];
  }
  elGo.addEventListener('click', run);
  elWeapon.addEventListener('change', function () {
    syncSlotBox(currentWeapon());
    if (elWeapon.value) run();
  });
  syncSlotBox(currentWeapon());
}());
