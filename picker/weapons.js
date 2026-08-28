/* MHN weapon picker. All stats are grade 10-5; the dataset is inlined by
   weapons.php so nothing here talks to the server. */

(function () {
  'use strict';

  var DATA = JSON.parse(document.getElementById('data').textContent);

  // --- damage model --------------------------------------------------------
  //
  // Every constant here is the in-game value for the assumed skill, taken from
  // the skill table rather than guessed:
  //   Critical Eye 1        +10% affinity
  //   Weakness Exploit 1    +20% affinity   -> +30% assumed crit chance
  //   Critical Boost 5      crit damage 150%      -> +50% on a crit
  //   Critical Element 5    element +80% on a crit
  //   Critical Ferocity 5   affinity -30%, negative-affinity hits deal 250%
  //
  // Affinity is treated as the proportion of hits that crit. Negative affinity
  // means that proportion crits *badly*, at 75% damage, unless Critical
  // Ferocity turns those into 250%.

  var CRIT_AFFINITY = 30;   // Critical Eye 1 (+10) + Weakness Exploit 1 (+20)
  var CRIT_BOOST = 0.50;    // Critical Boost 5 -> crit damage 150%

  // The Crit ELE column models a build you can actually assemble. Critical
  // Boost 5 AND Critical Element 5 AND the affinity skills do not fit
  // together, so that column carries Critical Boost 1 (130%) instead of 5.
  var CRIT_BOOST_LOW = 0.30;  // Critical Boost 1 -> crit damage 130%
  var CRIT_ELEMENT = 1.80;    // Critical Element 5 -> element x1.8, on top of Critical Boost
  var BASE_CRIT = 1.25;     // an ordinary crit is 125%
  var NEG_CRIT = 0.25;      // an ordinary negative crit is 75%, i.e. -25%
  var CF_AFFINITY = 30;     // Critical Ferocity 5 subtracts 30 affinity
  var CF_CHANCE = 0.30;     // measured: 30% of negative crits proc Critical Ferocity
  var CF_MULT = 2.5;        // ... and those deal 250%
  var NEG_DMG = 0.75;       // a negative crit deals 75%

  function clamp(v) { return Math.max(-100, Math.min(100, v)); }

  // Blast / Poison / Paralysis / Sleep weapons carry an "element" value that is
  // a status BUILDUP rate, not damage — a higher number triggers the ailment
  // sooner. It must not be added to any damage figure, so these weapons are
  // treated as no-element throughout. The raw value is still shown, marked.
  var STATUS_ELEMENTS = ['Blast', 'Poison', 'Paralysis', 'Sleep'];
  function isStatus(w) { return STATUS_ELEMENTS.indexOf(w.e) >= 0; }

  // Work out the FINAL affinity for each build first, then apply the skill —
  // that is what decides whether the skill applies at all:
  //   Critical Boost / Critical Element  only when final affinity > 0
  //   Critical Ferocity                  only when final affinity < 0
  // Outside its range a skill contributes nothing, so the column would be a
  // meaningless number dressed up as a comparison. Those cells read null and
  // render as an em dash instead.
  //
  // Affinity and Critical Boost apply to attack AND element, so those builds
  // are computed off `sum`. Critical Element applies to element only and
  // multiplies ON TOP of Critical Boost (1.50 x 1.80 = 2.70 on the crit share).
  // Every column is a whole-hit damage figure: alternative builds to compare,
  // never parts to add together.
  function derive(w) {
    // Status buildup contributes no damage, so it is excluded everywhere.
    var ele = isStatus(w) ? 0 : w.ele;
    var sum = w.atk + ele;
    var aff = clamp(w.aff);

    // No crit skills: the default 125% crit, or 75% on a negative crit.
    // aff is already signed, so NEG_CRIT must stay positive here — negating it
    // too makes negative affinity *raise* the number.
    var calib = sum * (1 + (aff / 100) * (aff >= 0 ? BASE_CRIT - 1 : NEG_CRIT));

    // --- builds carrying Critical Eye 1 + Weakness Exploit 1 --------------
    var c = clamp(w.aff + CRIT_AFFINITY) / 100;   // final affinity
    var critAtk = null, critEle = null;
    if (c >= 0) {
      // Critical Boost 5: the critting share of the whole hit deals 150%.
      critAtk = sum * (1 + c * CRIT_BOOST);
      // Realistic elemental build — Critical Boost 1 (130%) with Critical
      // Element 5 on top of it, so element's crit share deals 1.30 x 1.80.
      // With `ele` zero on a status weapon this collapses to the attack term,
      // which is right: Critical Element does nothing for buildup.
      critEle = w.atk * (1 + c * CRIT_BOOST_LOW)
              + ele * c * (1 + CRIT_BOOST_LOW) * CRIT_ELEMENT
              + ele * (1 - c);
    }

    // --- Critical Ferocity build ------------------------------------------
    // Its own final affinity is the weapon's minus 30; you would not pair it
    // with the affinity skills, which is why they are absent here.
    var f = clamp(w.aff - CF_AFFINITY) / 100;
    var cfAtk = null;
    if (f <= 0) {
      var n = Math.abs(f);                         // share of hits that crit badly
      // Of those, CF_CHANCE proc Critical Ferocity for CF_MULT; the rest are
      // ordinary negative crits at NEG_DMG.
      var negValue = CF_CHANCE * CF_MULT + (1 - CF_CHANCE) * NEG_DMG;
      cfAtk = sum * ((1 - n) + n * negValue);
    }

    // Best of the three builds. A build that cannot apply is null and simply
    // does not compete; at least one is always available, since the crit
    // columns only blank below -30 affinity and CF only above +30.
    var best = null;
    [critAtk, critEle, cfAtk].forEach(function (v) {
      if (v !== null && (best === null || v > best)) best = v;
    });

    return { sum: sum, calib: calib, critAtk: critAtk, critEle: critEle, cfAtk: cfAtk, best: best };
  }

  DATA.weapons.forEach(function (w) {
    w.status = isStatus(w);
    var d = derive(w);
    for (var k in d) if (d.hasOwnProperty(k)) w[k] = d[k];
    w.skillText = w.sk.map(function (s) { return s.n + ' ' + s.l; }).join(', ');
    w.attrText = (w.attr || []).join(' · ');
    w.search = (w.n + ' ' + (w.low || '') + ' ' + w.ser + ' ' + w.t + ' ' + w.e + ' ' +
                w.skillText + ' ' + w.attrText).toLowerCase();
  });

  // --- columns -------------------------------------------------------------

  var COLS = [
    { k: 'n', h: 'Weapon', cls: 'name' },
    { k: 'low', h: 'Low-grade name', cls: 'low' },
    { k: 't', h: 'Type' },
    { k: 'e', h: 'Element' },
    { k: 'ser', h: 'Series' },
    { k: 'skillText', h: 'Skill' },
    { k: 'atk', h: 'ATK', num: true },
    { k: 'ele', h: 'ELE', num: true },
    { k: 'aff', h: 'AFF%', num: true, neg: true },
    { k: 'sum', h: 'Sum', num: true, calc: true },
    { k: 'calib', h: 'Calib', num: true, calc: true, dp: 0 },
    { k: 'critAtk', h: 'Crit ATK', num: true, calc: true, dp: 0 },
    { k: 'critEle', h: 'Crit ELE', num: true, calc: true, dp: 0 },
    { k: 'cfAtk', h: 'CF ATK', num: true, calc: true, dp: 0 },
    { k: 'best', h: 'Best', num: true, dp: 0, cls: 'bestcol' },
    { k: 'attrText', h: 'Attributes', cls: 'attr' },
  ];

  var sortKey = 'best', sortDir = -1;

  // Several filters only ever match one weapon type — a kinsect belongs to an
  // insect glaive and nothing else. Tick a different type as well and the result
  // is always empty, which on its own reads as "this filter is broken" rather
  // than "these two filters contradict". Naming the clash costs one line and
  // saves the guessing.
  var TYPE_ONLY = [
    { el: 'f-ammo', types: ['Light Bowgun', 'Heavy Bowgun'], what: 'ammo' },
    { el: 'f-arrow', types: ['Bow'], what: 'arrow' },
    { el: 'f-shell', types: ['Gunlance'], what: 'shelling' },
    { el: 'f-kinsect', types: ['Insect Glaive'], what: 'kinsect' },
  ];

  function emptyReason() {
    var ticked = Object.keys(sel.type).filter(function (t) { return sel.type[t]; });
    if (ticked.length) {
      for (var i = 0; i < TYPE_ONLY.length; i++) {
        var f = TYPE_ONLY[i];
        var e = document.getElementById(f.el);
        if (!e || !e.value) continue;
        var overlap = f.types.filter(function (t) { return ticked.indexOf(t) > -1; });
        if (!overlap.length) {
          return 'No weapon matches these filters. The ' + f.what + ' filter only applies to ' +
            f.types.join(' and ') + ', which ' + (f.types.length > 1 ? 'are' : 'is') +
            ' not among the weapon types you have ticked.';
        }
      }
    }
    return 'No weapon matches these filters.';
  }

  // --- filters -------------------------------------------------------------

  var sel = { type: {}, element: {} };
  var elType = document.getElementById('f-type');
  var elElem = document.getElementById('f-element');
  var elSkill = document.getElementById('f-skill');
  var elAmmo = document.getElementById('f-ammo');
  var elArrow = document.getElementById('f-arrow');
  var elShell = document.getElementById('f-shell');
  var elKinsect = document.getElementById('f-kinsect');
  var elCustom = document.getElementById('f-custom');
  var elText = document.getElementById('f-text');

  function checkboxes(host, values, bucket) {
    values.forEach(function (v) {
      var lab = document.createElement('label');
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = v;
      cb.addEventListener('change', function () {
        if (cb.checked) bucket[v] = true; else delete bucket[v];
        lab.className = cb.checked ? 'on' : '';
        render();
      });
      lab.appendChild(cb);
      lab.appendChild(document.createTextNode(v));
      host.appendChild(lab);
    });
  }
  checkboxes(elType, DATA.types, sel.type);
  checkboxes(elElem, DATA.elements, sel.element);

  function options(host, values) {
    values.forEach(function (v) {
      var o = document.createElement('option');
      o.value = v; o.textContent = v;
      host.appendChild(o);
    });
  }
  options(elSkill, DATA.skills);
  options(elAmmo, DATA.ammo);

  // {v,l} pairs so the option value stays the raw code and the label reads
  // the way the game writes it.
  function pairs(host, list) {
    (list || []).forEach(function (x) {
      var o = document.createElement('option');
      o.value = x.v; o.textContent = x.l;
      host.appendChild(o);
    });
  }
  function group(host, label, list) {
    if (!list || !list.length) return;
    var g = document.createElement('optgroup');
    g.label = label;
    pairs(g, list);
    host.appendChild(g);
  }
  group(elArrow, 'Charge level pattern', DATA.arrows && DATA.arrows.pattern);
  group(elArrow, 'Arrow family', DATA.arrows && DATA.arrows.family);
  pairs(elShell, DATA.shelling);
  // Named and ordered as the game shows them on a glaive.
  group(elKinsect, 'Kinsect type', DATA.kinsect && DATA.kinsect.type);
  group(elKinsect, 'Performance type', DATA.kinsect && DATA.kinsect.param);
  group(elKinsect, 'Attack type', DATA.kinsect && DATA.kinsect.attr);
  group(elKinsect, 'Kinsect bonus', DATA.kinsect && DATA.kinsect.bonus);

  [elSkill, elAmmo, elArrow, elShell, elKinsect, elCustom].forEach(function (e) {
    e.addEventListener('change', render);
  });
  elText.addEventListener('input', render);

  document.getElementById('f-reset').addEventListener('click', function () {
    sel.type = {}; sel.element = {};
    [].forEach.call(document.querySelectorAll('.checkrow input'), function (cb) {
      cb.checked = false; cb.parentNode.className = '';
    });
    [elSkill, elAmmo, elArrow, elShell, elKinsect, elCustom].forEach(function (e) { e.value = ''; });
    elText.value = '';
    render();
  });

  function matches(w) {
    if (Object.keys(sel.type).length && !sel.type[w.t]) return false;
    if (Object.keys(sel.element).length && !sel.element[w.e]) return false;
    if (elSkill.value && !w.sk.some(function (s) { return s.n === elSkill.value; })) return false;
    if (elAmmo.value && (w.ammo || []).indexOf(elAmmo.value) < 0) return false;
    if (elArrow.value) {
      var av = elArrow.value.split(':');
      if (av[0] === 'lv' && w.alv !== av[1]) return false;
      if (av[0] === 'fam' && (w.arw || []).indexOf(av[1]) < 0) return false;
    }
    if (elShell.value && w.sh !== elShell.value) return false;
    if (elKinsect.value) {
      var kv = elKinsect.value.split(':');
      if (kv[0] === 'type' && w.kt !== kv[1]) return false;
      if (kv[0] === 'param' && w.kp !== kv[1]) return false;
      if (kv[0] === 'attr' && w.ka !== kv[1]) return false;
      if (kv[0] === 'bonus' && w.kb !== kv[1]) return false;
    }
    // ss null = no customisation entry at all, distinct from ss 0.
    if (elCustom.value === 'style' && w.ss !== 1) return false;
    if (elCustom.value === 'nostyle' && w.ss !== 0) return false;
    if (elCustom.value === 'none' && w.ss !== null) return false;
    var q = elText.value.trim().toLowerCase();
    if (q && w.search.indexOf(q) < 0) return false;
    return true;
  }

  // --- render --------------------------------------------------------------

  var head = document.getElementById('head');
  var body = document.getElementById('body');
  var count = document.getElementById('count');

  function renderHead() {
    head.innerHTML = '';
    COLS.forEach(function (c) {
      var th = document.createElement('th');
      th.textContent = c.h;
      if (c.num) th.className = 'num';
      if (sortKey === c.k) {
        th.className = (th.className + ' sorted').trim();
        var s = document.createElement('span');
        s.className = 'dir';
        s.textContent = sortDir < 0 ? '▼' : '▲';
        th.appendChild(s);
      }
      th.addEventListener('click', function () {
        if (sortKey === c.k) sortDir = -sortDir;
        else { sortKey = c.k; sortDir = c.num ? -1 : 1; }
        render();
      });
      head.appendChild(th);
    });
  }

  function fmt(v, c) {
    if (v === null || v === undefined || v === '') return '—';
    if (typeof v !== 'number') return v;
    return c.dp === 0 ? Math.round(v).toLocaleString() : v.toLocaleString();
  }

  function render() {
    renderHead();
    var rows = DATA.weapons.filter(matches);
    rows.sort(function (a, b) {
      var x = a[sortKey], y = b[sortKey];
      // Blank cells (skill does not apply) sort last whichever way you sort.
      var xn = x === null || x === undefined || x === '';
      var yn = y === null || y === undefined || y === '';
      if (xn && yn) return 0;
      if (xn) return 1;
      if (yn) return -1;
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * sortDir;
      return String(x).localeCompare(String(y)) * sortDir;
    });

    // highlight the leader on the sorted numeric column
    var top = null;
    var sortedCol = COLS.filter(function (c) { return c.k === sortKey; })[0];
    if (rows.length && sortedCol && sortedCol.num && rows[0][sortKey] !== null) top = rows[0][sortKey];

    body.innerHTML = '';
    if (!rows.length) {
      var tr = document.createElement('tr');
      var td = document.createElement('td');
      td.className = 'empty';
      td.colSpan = COLS.length;
      td.textContent = emptyReason();
      tr.appendChild(td);
      body.appendChild(tr);
    }
    rows.forEach(function (w) {
      var tr = document.createElement('tr');
      COLS.forEach(function (c) {
        var td = document.createElement('td');
        var cls = [];
        if (c.num) cls.push('num');
        if (c.cls) cls.push(c.cls);
        if (c.calc) cls.push('calc');
        if (c.neg && w[c.k] < 0) cls.push('neg');
        if (c.k === 'ele' && w.status) cls.push('buildup');
        if (c.k === sortKey && c.num && top !== null && w[c.k] === top) cls.push('best');
        td.className = cls.join(' ');
        td.textContent = fmt(w[c.k], c);
        if (c.k === 'ele' && w.status) {
          td.title = w.e + ' buildup rate, not damage — excluded from every damage column';
        }
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });

    count.textContent = rows.length + ' of ' + DATA.weapons.length + ' weapons' +
      (rows.length ? '  ·  sorted by ' + sortedCol.h + (sortDir < 0 ? ' descending' : ' ascending') : '');
  }

  render();
})();
