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

  // The per-type attribute filter can still be asked for something the ticked
  // types cannot supply — pick a melody, then tick Great Sword. The control
  // rebuilds itself in that case, but a stale selection can survive one render,
  // so the empty state still names the clash rather than leaving it to guesswork.
  function emptyReason() {
    var g = groupOf(elAttr.value);
    var ticked = tickedTypes();
    if (g && ticked.length && !g.types.some(function (t) { return ticked.indexOf(t) > -1; })) {
      return 'No weapon matches these filters. "' + g.label + '" only applies to ' +
        g.types.join(' and ') + ', which ' + (g.types.length > 1 ? 'are' : 'is') +
        ' not among the weapon types you have ticked.';
    }
    return 'No weapon matches these filters.';
  }

  function tickedTypes() {
    return Object.keys(sel.type).filter(function (t) { return sel.type[t]; });
  }

  function groupOf(value) {
    if (!value) return null;
    return (DATA.attrGroups || []).filter(function (g) {
      return g.opts.some(function (o) { return o.v === value; });
    })[0] || null;
  }

  // --- filters -------------------------------------------------------------

  var sel = { type: {}, element: {}, custom: {} };
  var elType = document.getElementById('f-type');
  var elElem = document.getElementById('f-element');
  var elSkill = document.getElementById('f-skill');
  var elAttr = document.getElementById('f-attr');
  var elCustom = document.getElementById('f-custom');
  var elText = document.getElementById('f-text');

  // Customisable and style selectable now agree on every weapon in the data, and
  // nothing is customisable-but-not-style-selectable any more, so the old three
  // way dropdown had a dead option and a redundant one. What is left is a single
  // yes/no, which is a checkbox.
  var CUSTOM_LABEL = 'Style selectable';

  function checkboxes(host, values, bucket, after) {
    values.forEach(function (v) {
      var lab = document.createElement('label');
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = v;
      cb.addEventListener('change', function () {
        if (cb.checked) bucket[v] = true; else delete bucket[v];
        lab.className = cb.checked ? 'on' : '';
        if (after) after();
        render();
      });
      lab.appendChild(cb);
      lab.appendChild(document.createTextNode(v));
      host.appendChild(lab);
    });
  }
  // Changing the weapon types changes which attribute groups can apply, so the
  // attribute dropdown is rebuilt before the table re-renders.
  checkboxes(elType, DATA.types, sel.type, function () { buildAttrFilter(); });
  checkboxes(elElem, DATA.elements, sel.element);
  checkboxes(elCustom, [CUSTOM_LABEL], sel.custom);

  function options(host, values) {
    values.forEach(function (v) {
      var o = document.createElement('option');
      o.value = v; o.textContent = v;
      host.appendChild(o);
    });
  }
  options(elSkill, DATA.skills);

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
  /**
   * Rebuild the attribute dropdown for whatever weapon types are ticked.
   *
   * With nothing ticked every group is offered, which is the honest default —
   * you may not have decided on a type yet. Tick some, and only the groups those
   * types can answer remain, so picking a melody while looking at gunlances is
   * not something the control lets you express.
   *
   * A selection that survives into a rebuild where its group is gone would
   * silently filter everything away, so it is cleared.
   */
  function buildAttrFilter() {
    var ticked = tickedTypes();
    var keep = (DATA.attrGroups || []).filter(function (g) {
      return !ticked.length || g.types.some(function (t) { return ticked.indexOf(t) > -1; });
    });
    var was = elAttr.value;
    elAttr.innerHTML = '';
    var any = document.createElement('option');
    any.value = ''; any.textContent = 'any';
    elAttr.appendChild(any);
    keep.forEach(function (g) { group(elAttr, g.label, g.opts); });

    var stillThere = keep.some(function (g) {
      return g.opts.some(function (o) { return o.v === was; });
    });
    elAttr.value = stillThere ? was : '';
    return was && !stillThere;          // caller may want to know it was dropped
  }
  buildAttrFilter();

  // elCustom is a checkrow now, so its own checkbox already triggers render.
  [elSkill, elAttr].forEach(function (e) {
    e.addEventListener('change', render);
  });
  elText.addEventListener('input', render);

  document.getElementById('f-reset').addEventListener('click', function () {
    // Clear these in place. Each checkbox closes over the bucket it was built
    // with, so assigning a fresh {} here leaves every checkbox writing into an
    // object nothing reads any more — reset would silently stop the type and
    // element filters from working at all.
    [sel.type, sel.element, sel.custom].forEach(function (bucket) {
      Object.keys(bucket).forEach(function (k) { delete bucket[k]; });
    });
    [].forEach.call(document.querySelectorAll('.checkrow input'), function (cb) {
      cb.checked = false; cb.parentNode.className = '';
    });
    [elSkill, elAttr].forEach(function (e) { e.value = ''; });
    elText.value = '';
    buildAttrFilter();          // every group is on offer again
    render();
  });

  /**
   * Parse the search box into terms that must match and terms that must not.
   *
   *   blast -bowgun            has "blast", does not have "bowgun"
   *   "cluster ammo" -brachy   phrase with a space, minus one
   *
   * Several terms are AND, because narrowing is what you reach for after a
   * single word returns too much. OR is already covered by the type and element
   * checkboxes, which union within themselves.
   *
   * Parsed once per render rather than once per weapon, and held in Q.
   */
  var Q = { inc: [], exc: [], note: '' };

  function parseQuery(q) {
    var inc = [], exc = [], note = '';
    var negateNext = false;
    var re = /(-?)(?:"([^"]*)"?|(\S+))/g, m;
    while ((m = re.exec(q)) !== null) {
      var quoted = m[2] !== undefined;
      var term = (quoted ? m[2] : (m[3] || '')).trim().toLowerCase();
      // A bare "-" is someone mid-typing, and matching it literally would hide
      // every weapon whose name has a hyphen.
      if (!term || term === '-') continue;

      // Writing "AND" between terms is the obvious guess, and taken literally it
      // is a disaster: "and" is a substring of Grande, Bandit, Standard, so the
      // query quietly narrows to whatever happens to contain those letters.
      // Terms are already AND, so the word is a no-op. NOT is honoured because
      // it reads as the long form of the minus. OR cannot be honoured without a
      // parse tree, and silently treating it as AND would mislead, so it is
      // called out instead. Quote a word to search for it literally.
      if (!quoted && !m[1]) {
        if (term === 'and') continue;
        if (term === 'not') { negateNext = true; continue; }
        if (term === 'or') {
          note = 'OR is not supported — terms are combined with AND. Quote "or" to match it literally.';
          continue;
        }
      }

      var negate = !!m[1] || negateNext;
      negateNext = false;
      if (negate) exc.push(term); else inc.push(term);
    }
    return { inc: inc, exc: exc, note: note };
  }

  function matches(w) {
    if (Object.keys(sel.type).length && !sel.type[w.t]) return false;
    if (Object.keys(sel.element).length && !sel.element[w.e]) return false;
    if (elSkill.value && !w.sk.some(function (s) { return s.n === elSkill.value; })) return false;
    // One control now carries every per-type attribute. The prefix says which
    // one; an unknown prefix matches nothing rather than everything, so a stale
    // saved value cannot quietly disable the filter.
    if (elAttr.value) {
      var i = elAttr.value.indexOf(':');
      var kind = elAttr.value.slice(0, i), v = elAttr.value.slice(i + 1);
      if (kind === 'ammo') { if ((w.ammo || []).indexOf(v) < 0) return false; }
      else if (kind === 'lv') { if (w.alv !== v) return false; }
      else if (kind === 'fam') { if ((w.arw || []).indexOf(v) < 0) return false; }
      else if (kind === 'shell') { if (w.sh !== v) return false; }
      else if (kind === 'mel') { if ((w.ml || []).indexOf(v) < 0) return false; }
      else if (kind === 'type') { if (w.kt !== v) return false; }
      else if (kind === 'param') { if (w.kp !== v) return false; }
      else if (kind === 'attr') { if (w.ka !== v) return false; }
      else if (kind === 'bonus') { if (w.kb !== v) return false; }
      else return false;
    }
    if (sel.custom[CUSTOM_LABEL] && w.ss !== 1) return false;

    for (var a = 0; a < Q.inc.length; a++) if (w.search.indexOf(Q.inc[a]) < 0) return false;
    for (var b = 0; b < Q.exc.length; b++) if (w.search.indexOf(Q.exc[b]) > -1) return false;
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
    Q = parseQuery(elText.value);
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
      (rows.length ? '  ·  sorted by ' + sortedCol.h + (sortDir < 0 ? ' descending' : ' ascending') : '') +
      (Q.note ? '  ·  ' + Q.note : '');
  }

  render();
})();
