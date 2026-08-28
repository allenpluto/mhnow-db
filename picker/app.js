/* MHN armour picker — all interaction is client side; the dataset is inlined
   by index.php, so nothing here talks to the server. */

(function () {
  'use strict';

  var DATA = JSON.parse(document.getElementById('data').textContent);

  var SLOT_LABEL = {
    HEAD: 'Head',
    CHEST: 'Chest',
    ARMS: 'Arms',
    TORSO: 'Waist',   // the game's data calls the waist slot TORSO
    LEGS: 'Legs'
  };

  var skillById = {};
  DATA.skills.forEach(function (s) { skillById[s.id] = s; });

  // Armour grouped by slot, so the columns do not rescan the whole list.
  var bySlot = {};
  DATA.slots.forEach(function (s) { bySlot[s] = []; });
  DATA.armor.forEach(function (a) {
    if (bySlot[a.slot]) bySlot[a.slot].push(a);
  });

  // --- state ---------------------------------------------------------------

  var wanted = [];                       // skill ids, in the order chosen
  var equipped = {};                     // slot -> armour id
  DATA.slots.forEach(function (s) { equipped[s] = null; });

  var armorById = {};
  DATA.armor.forEach(function (a) { armorById[a.id] = a; });

  // --- element helpers -----------------------------------------------------

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }

  // Renders a label with the matched substring wrapped in <mark>.
  function highlight(name, query) {
    var frag = document.createDocumentFragment();
    if (!query) { frag.appendChild(document.createTextNode(name)); return frag; }
    var i = name.toLowerCase().indexOf(query.toLowerCase());
    if (i < 0) { frag.appendChild(document.createTextNode(name)); return frag; }
    frag.appendChild(document.createTextNode(name.slice(0, i)));
    frag.appendChild(el('mark', null, name.slice(i, i + query.length)));
    frag.appendChild(document.createTextNode(name.slice(i + query.length)));
    return frag;
  }

  // --- skill search --------------------------------------------------------

  var input = document.getElementById('skill-input');
  var suggestBox = document.getElementById('suggest');
  var chipRow = document.getElementById('chips');
  var clearBtn = document.getElementById('clear-skills');

  var suggestions = [];
  var activeIndex = -1;

  function search(q) {
    var needle = q.trim().toLowerCase();
    var pool = DATA.skills.filter(function (s) { return wanted.indexOf(s.id) < 0; });
    if (!needle) return pool.slice(0, 40);

    var starts = [], contains = [];
    pool.forEach(function (s) {
      var i = s.name.toLowerCase().indexOf(needle);
      if (i === 0) starts.push(s);
      else if (i > 0) contains.push(s);
    });
    return starts.concat(contains).slice(0, 40);
  }

  function renderSuggestions(q) {
    suggestions = search(q);
    activeIndex = suggestions.length ? 0 : -1;
    suggestBox.innerHTML = '';

    if (!suggestions.length) {
      var none = el('li', 'empty', 'No skill matches "' + q.trim() + '"');
      suggestBox.appendChild(none);
      suggestBox.hidden = false;
      return;
    }

    suggestions.forEach(function (s, i) {
      var li = el('li');
      if (i === activeIndex) li.className = 'active';
      var nameNode = el('span');
      nameNode.appendChild(highlight(s.name, q.trim()));
      li.appendChild(nameNode);
      li.appendChild(el('span', 'meta', s.cat + ' · max ' + s.max));
      li.addEventListener('mousedown', function (ev) {
        ev.preventDefault();          // keep focus in the input
        choose(s.id);
      });
      suggestBox.appendChild(li);
    });
    suggestBox.hidden = false;
  }

  function closeSuggestions() {
    suggestBox.hidden = true;
    activeIndex = -1;
  }

  function setActive(next) {
    if (!suggestions.length) return;
    activeIndex = (next + suggestions.length) % suggestions.length;
    var items = suggestBox.querySelectorAll('li');
    for (var i = 0; i < items.length; i++) {
      items[i].className = (i === activeIndex) ? 'active' : '';
    }
    if (items[activeIndex]) {
      items[activeIndex].scrollIntoView({ block: 'nearest' });
    }
  }

  function choose(id) {
    if (wanted.indexOf(id) < 0) wanted.push(id);
    input.value = '';
    closeSuggestions();
    renderAll();
    input.focus();
  }

  function unchoose(id) {
    var i = wanted.indexOf(id);
    if (i >= 0) wanted.splice(i, 1);
    renderAll();
  }

  input.addEventListener('input', function () { renderSuggestions(input.value); });
  input.addEventListener('focus', function () { renderSuggestions(input.value); });
  input.addEventListener('blur', function () { setTimeout(closeSuggestions, 120); });

  input.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(activeIndex + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(activeIndex - 1); }
    else if (e.key === 'Enter') {
      if (activeIndex >= 0 && suggestions[activeIndex]) {
        e.preventDefault();
        choose(suggestions[activeIndex].id);
      }
    } else if (e.key === 'Escape') {
      closeSuggestions();
    } else if (e.key === 'Backspace' && input.value === '' && wanted.length) {
      unchoose(wanted[wanted.length - 1]);
    }
  });

  clearBtn.addEventListener('click', function () {
    wanted = [];
    renderAll();
  });

  function renderChips() {
    chipRow.innerHTML = '';
    wanted.forEach(function (id) {
      var s = skillById[id];
      var chip = el('span', 'chip', s.name);
      var x = el('button', null, '×');
      x.type = 'button';
      x.title = 'Remove ' + s.name;
      x.addEventListener('click', function () { unchoose(id); });
      chip.appendChild(x);
      chipRow.appendChild(chip);
    });
    clearBtn.hidden = wanted.length === 0;
  }

  // --- candidate ranking ---------------------------------------------------

  // A piece is a candidate if it carries at least one wanted skill. Rank by
  // how many wanted skills it covers, then by the levels it brings.
  function scoreOf(a) {
    var hits = 0, levels = 0;
    a.skills.forEach(function (sk) {
      if (wanted.indexOf(sk.s) >= 0) { hits++; levels += sk.l; }
    });
    return { hits: hits, levels: levels };
  }

  function candidatesFor(slot) {
    var list = bySlot[slot] || [];
    if (!wanted.length) {
      return list.slice().sort(function (x, y) { return x.name.localeCompare(y.name); });
    }
    return list
      .map(function (a) { var s = scoreOf(a); return { a: a, hits: s.hits, levels: s.levels }; })
      .filter(function (r) { return r.hits > 0; })
      .sort(function (x, y) {
        return (y.hits - x.hits) || (y.levels - x.levels) || x.a.name.localeCompare(y.a.name);
      })
      .map(function (r) { return r.a; });
  }

  // --- columns -------------------------------------------------------------

  var columnsBox = document.getElementById('columns');

  function skillLine(sk) {
    var s = skillById[sk.s];
    var name = s ? s.name : ('skill ' + sk.s);
    var line = el('span', 'sk', name + ' (' + sk.l + ')');
    if (wanted.indexOf(sk.s) >= 0) line.className = 'sk hit';
    return line;
  }

  function renderColumns() {
    columnsBox.innerHTML = '';

    DATA.slots.forEach(function (slot) {
      var col = el('div', 'col');

      // header + what is currently equipped here
      var head = el('div', 'col-head');
      var h2 = el('h2', slot === 'TORSO' ? 'waist' : null, SLOT_LABEL[slot]);
      head.appendChild(h2);

      var eq = el('div', 'equipped');
      var current = equipped[slot] ? armorById[equipped[slot]] : null;
      if (current) {
        var row = el('div', 'row');
        var nameWrap = el('div');
        nameWrap.appendChild(el('div', 'nm', current.name));
        current.skills.forEach(function (sk) {
          var s = skillById[sk.s];
          nameWrap.appendChild(el('div', 'sk', (s ? s.name : sk.s) + ' (' + sk.l + ')'));
        });
        row.appendChild(nameWrap);
        var x = el('button', null, '×');
        x.type = 'button';
        x.title = 'Unequip';
        x.addEventListener('click', function () {
          equipped[slot] = null;
          renderAll();
        });
        row.appendChild(x);
        eq.appendChild(row);
      } else {
        eq.appendChild(el('div', 'empty-note', 'nothing equipped'));
      }
      head.appendChild(eq);
      col.appendChild(head);

      // candidates
      var list = candidatesFor(slot);
      col.appendChild(el('div', 'count',
        wanted.length
          ? list.length + ' match' + (list.length === 1 ? '' : 'es')
          : list.length + ' pieces (choose skills to filter)'));

      var cards = el('div', 'cards');
      if (!list.length) {
        cards.appendChild(el('div', 'hint', 'No piece in this slot has any of the chosen skills.'));
      }
      list.forEach(function (a) {
        var card = el('button', 'card');
        card.type = 'button';
        if (equipped[slot] === a.id) card.className = 'card is-equipped';

        card.appendChild(el('span', 'nm', a.name));
        card.appendChild(el('span', 'series', a.series));
        a.skills.forEach(function (sk) { card.appendChild(skillLine(sk)); });
        card.appendChild(el('span', 'stats',
          'DEF ' + a.def + ' · grade ' + a.grade + ' · ' +
          a.slots + ' driftsmelt slot' + (a.slots === 1 ? '' : 's')));

        card.addEventListener('click', function () {
          equipped[slot] = (equipped[slot] === a.id) ? null : a.id;
          renderAll();
        });
        cards.appendChild(card);
      });
      col.appendChild(cards);

      columnsBox.appendChild(col);
    });
  }

  // --- summary -------------------------------------------------------------

  var summaryBox = document.getElementById('summary');

  function renderSummary() {
    summaryBox.innerHTML = '';
    summaryBox.appendChild(el('h2', null, 'Build summary'));

    var totalDef = 0, totalSlots = 0, pieces = 0;
    var totals = {};   // skill id -> summed level

    DATA.slots.forEach(function (slot) {
      var id = equipped[slot];
      if (!id) return;
      var a = armorById[id];
      pieces++;
      totalDef += a.def;
      totalSlots += a.slots;
      a.skills.forEach(function (sk) {
        totals[sk.s] = (totals[sk.s] || 0) + sk.l;
      });
    });

    var t = el('div', 'totals');
    [['Pieces', pieces + '/5'], ['Defence', totalDef], ['Drift slots', totalSlots]]
      .forEach(function (pair) {
        var d = el('div');
        d.appendChild(el('b', null, pair[1]));
        d.appendChild(document.createTextNode(pair[0]));
        t.appendChild(d);
      });
    summaryBox.appendChild(t);

    // equipped pieces
    summaryBox.appendChild(el('h3', null, 'Equipped'));
    var eqList = el('ul', 'equiplist');
    DATA.slots.forEach(function (slot) {
      var li = el('li');
      li.appendChild(el('span', 'slot', SLOT_LABEL[slot]));
      var id = equipped[slot];
      li.appendChild(id ? el('span', null, armorById[id].name) : el('span', 'none', '—'));
      eqList.appendChild(li);
    });
    summaryBox.appendChild(eqList);

    // skill totals, summed across the equipped pieces
    summaryBox.appendChild(el('h3', null, 'Skills'));
    var ids = Object.keys(totals);
    if (!ids.length) {
      summaryBox.appendChild(el('p', 'hint', 'Equip pieces to see their combined skills.'));
    } else {
      ids.sort(function (a, b) {
        return (totals[b] - totals[a]) ||
               skillById[a].name.localeCompare(skillById[b].name);
      });
      var ul = el('ul', 'sumlist');
      ids.forEach(function (idStr) {
        var s = skillById[idStr];
        var sum = totals[idStr];
        var capped = sum > s.max;
        var li = el('li');
        if (wanted.indexOf(s.id) >= 0) li.className = 'wanted';
        if (capped) li.className += ' capped';

        li.appendChild(el('span', 'nm', s.name));

        var lv = el('span', 'lv');
        lv.appendChild(document.createTextNode(
          (capped ? s.max : sum) + ' / ' + s.max));
        if (capped) lv.appendChild(el('span', 'over', ' (+' + (sum - s.max) + ' wasted)'));
        li.appendChild(lv);

        ul.appendChild(li);
      });
      summaryBox.appendChild(ul);
    }

    // wanted skills the current build does not deliver
    var missing = wanted.filter(function (id) { return !totals[id]; });
    if (missing.length) {
      var p = el('p', 'missing');
      p.appendChild(document.createTextNode('Not yet covered: '));
      p.appendChild(el('b', null, missing.map(function (id) {
        return skillById[id].name;
      }).join(', ')));
      summaryBox.appendChild(p);
    }
  }

  // --- go ------------------------------------------------------------------

  function renderAll() {
    renderChips();
    renderColumns();
    renderSummary();
  }

  renderAll();
})();
