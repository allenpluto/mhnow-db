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

  var opts = { gems: false, damageOnly: true };
  [['damageOnly', 'Damage only (ignore utility weights)'],
   ['gems', 'Assume ideal driftgems']].forEach(function (pair) {
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
  });

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
    };
    var isStatus = E.STATUS.indexOf(W.element) >= 0;

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

      var h = document.createElement('h2');
      h.textContent = '#' + (i + 1) + '  ' +
        (opts.damageOnly ? 'damage ' + Math.round(r.detail.dmg).toLocaleString()
                         : 'score ' + Math.round(r.detail.total).toLocaleString());
      if (!opts.damageOnly && r.detail.util) {
        var sm = document.createElement('span');
        sm.className = 'muted';
        sm.textContent = '  (damage ' + Math.round(r.detail.dmg).toLocaleString() +
          ' x ' + (1 + r.detail.util).toFixed(2) + ' utility)';
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

      if (r.gemText) {
        var g = document.createElement('p');
        g.className = 'gems';
        g.textContent = 'Driftgems: ' + r.gemText + '  (' + r.slots + ' slot' + (r.slots === 1 ? '' : 's') + ')';
        box.appendChild(g);
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
    out.results[0].picks.forEach(function (b) {
      Object.keys(b.pieces[0].skills || {}).forEach(function (n) { if (!out.known[n]) ignored[n] = true; });
    });
    var a = E.ASSUME;
    var lines = [
      'Assumptions: average health ' + (a.hpFraction * 100) + '% (the Vital skills), ' +
        'Valor ' + (a.valorUptime * 100) + '% uptime, Elemental Release ' +
        (a.elementalReleaseUptime * 100) + '%, Burst ' + (a.burstUptime * 100) + '%, ' +
        'Weakness Exploit ' + (a.weakPointUptime * 100) + '%, ' +
        'the health-threshold skills at ' + (a.peakPerformanceUptime * 100) + '%.',
      isStatus
        ? W.element + ' is a status, so its value is buildup and contributes no damage — ' +
          'Critical Element, Elemental Release and the Vital skills are excluded with it.'
        : 'Only ' + W.element + ' skills are considered; other elements cannot help this weapon.',
    ];
    if (Object.keys(ignored).length) {
      lines.push('On the winning set, these skills are scored as zero because damage cannot price them: ' +
        Object.keys(ignored).sort().join(', ') + '.');
    }
    if (opts.gems) {
      var no = out.names.filter(function (n) { return !E.UTILITY[n] && !DATA.gemmable[n]; });
      if (no.length) lines.push('No driftgem exists for: ' + no.join(', ') + ' — equipment only.');
    }
    elNotes.innerHTML = '';
    lines.forEach(function (t) {
      var p = document.createElement('p');
      p.textContent = t;
      elNotes.appendChild(p);
    });
  }

  elGo.addEventListener('click', run);
  elWeapon.addEventListener('change', function () { if (elWeapon.value) run(); });
}());
