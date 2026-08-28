/**
 * Builds the armour picker as a Google Sheets friendly workbook.
 *
 *   node sheet.js            -> writes mhnow-armour-picker.xlsx
 *
 * Data comes from the same place the site does: it renders picker/index.php
 * through the PHP CLI and reads the payload it inlines, so this cannot drift
 * from the web picker or the database.
 *
 * FORMULA POLICY — read before editing.
 * No FILTER / UNIQUE / SORT / XLOOKUP. Those are spilling array functions:
 * a generated .xlsx carries no spill metadata, so they break on open, and
 * behaviour differs between Excel and Sheets. Everything here is
 * COUNTIF(S) / SUMIFS / INDEX / MATCH / IFERROR, which evaluate identically
 * in Excel 2007+, Google Sheets and LibreOffice.
 *
 * The dynamic lists are built with the classic rank-then-lookup idiom:
 * a helper column assigns each matching row a 1..n rank, and the visible
 * grid pulls rank k with INDEX/MATCH. No sorting at read time.
 *
 * Node 10 compatible; exceljs 4 is pinned to match.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ExcelJS = require('exceljs');

const HERE = __dirname;
const PICKER = path.join(HERE, 'picker');
const OUT = path.join(HERE, 'mhnow-armour-picker.xlsx');

const FONT = 'Arial';
const SLOT_LABEL = { HEAD: 'Head', CHEST: 'Chest', ARMS: 'Arms', TORSO: 'Waist', LEGS: 'Legs' };
const SLOTS = ['HEAD', 'CHEST', 'ARMS', 'TORSO', 'LEGS'];

const CAND_ROWS = 20;   // candidate rows shown per slot
const SUM_ROWS = 24;    // summary rows (5 pieces x 3 skills = 15 max)
const WANT_ROWS = 5;    // how many skills you can ask for

// A range-backed dropdown offers no way to pick "blank", so a chosen skill
// could not be cleared from the list itself. This sentinel sits at the top of
// the choice list and every formula treats it as "not chosen".
// Deliberately plain ASCII — it has to compare equal reliably after the
// Google Sheets conversion.
const NONE = '(none)';

// Picker row map. Every section start is DERIVED from the block above it, so
// growing CAND_ROWS can never make one section overwrite the next. Hardcoding
// these is how the candidate grid silently ate the build section once already.
const R = {};
R.wantTitle  = 3;
R.wantHead   = R.wantTitle + 1;
R.wantTop    = R.wantHead + 1;
R.ignoreRow  = R.wantTop + WANT_ROWS;      // bulk "ignore all" toggle
R.candTitle  = R.ignoreRow + 2;
R.candHead   = R.candTitle + 1;
R.candTop    = R.candHead + 1;
R.candFoot   = R.candTop + CAND_ROWS;
R.buildTitle = R.candFoot + 2;
R.buildHead  = R.buildTitle + 1;
R.buildTop   = R.buildHead + 1;
R.buildTot   = R.buildTop + SLOTS.length;
R.sumTitle   = R.buildTot + 2;
R.sumHead    = R.sumTitle + 1;
R.sumTop     = R.sumHead + 1;

// --- palette --------------------------------------------------------------

const INK = 'FF1F2430';
const MUTED = 'FF6B7280';
const ACCENT = 'FF8A6D1F';
const fill = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: argb } });
const INPUT_FILL = fill('FFFFF2C2');   // cells you edit
const HEAD_FILL = fill('FF2F3542');
const BAND_FILL = fill('FFF3F4F6');

// --- 1. data --------------------------------------------------------------

function payload() {
  const candidates = ['php', 'C:\\wamp64\\bin\\php\\php5.6.35\\php.exe'];
  let lastErr;
  for (const bin of candidates) {
    try {
      const html = execFileSync(bin, [path.join(PICKER, 'index.php')], {
        encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, cwd: PICKER,
      });
      const m = html.match(/<script id="data" type="application\/json">([\s\S]*?)<\/script>/);
      if (!m) throw new Error('no dataset in the rendered page');
      return JSON.parse(m[1]);
    } catch (e) { lastErr = e; }
  }
  throw new Error('could not render picker/index.php via PHP: ' + lastErr.message);
}

// --- 2. shape it ----------------------------------------------------------

function shape(p) {
  const skillById = {};
  p.skills.forEach((s) => { skillById[s.id] = s; });

  const skills = p.skills.slice().sort((a, b) => a.name.localeCompare(b.name));

  // Sorted by slot then name: the rank helper breaks ties in sheet order, so
  // equal-scoring pieces come out alphabetical without any sort formula.
  const armor = p.armor.slice().sort(function (a, b) {
    const sa = SLOTS.indexOf(a.slot), sb = SLOTS.indexOf(b.slot);
    return sa - sb || a.name.localeCompare(b.name);
  });

  const long = [];
  armor.forEach((a) => {
    a.skills.forEach((sk) => {
      const s = skillById[sk.s];
      long.push({ armor: a.name, slot: SLOT_LABEL[a.slot], skill: s ? s.name : String(sk.s), level: sk.l });
    });
  });

  const namesBySlot = {};
  SLOTS.forEach((s) => {
    namesBySlot[s] = armor.filter((a) => a.slot === s).map((a) => a.name).sort((x, y) => x.localeCompare(y));
  });

  return { skills, armor, long, namesBySlot, skillById };
}

// --- 3. build -------------------------------------------------------------

function styleHeader(row) {
  row.eachCell((c) => {
    c.font = { name: FONT, size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = HEAD_FILL;
    c.alignment = { vertical: 'middle' };
  });
}

function build(d) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'mhnow-db';
  wb.created = new Date();

  // Creation order is tab order. Picker first so the file opens on it —
  // it is the only tab most people ever need, and on a phone whatever tab
  // is first is what you land on.
  const shPick = wb.addWorksheet('Picker');
  const shAbout = wb.addWorksheet('About');
  const shSkills = wb.addWorksheet('Skills');
  const shArmour = wb.addWorksheet('Armour');
  const shLong = wb.addWorksheet('ArmourSkills');
  const shLists = wb.addWorksheet('Lists');
  const shCalc = wb.addWorksheet('Calc');
  wb.views = [{ activeTab: 0 }];

  // ---- Skills ------------------------------------------------------------
  shSkills.columns = [
    { header: 'Skill', key: 'name', width: 26 },
    { header: 'Category', key: 'cat', width: 20 },
    { header: 'Max level', key: 'max', width: 11 },
  ];
  d.skills.forEach((s) => shSkills.addRow({ name: s.name, cat: s.cat, max: s.max }));
  const SKILL_LAST = d.skills.length + 1;

  // ---- Armour ------------------------------------------------------------
  shArmour.columns = [
    { header: 'Name', key: 'name', width: 26 },
    { header: 'Slot', key: 'slot', width: 9 },
    { header: 'Series', key: 'series', width: 22 },
    { header: 'Defence', key: 'def', width: 9 },
    { header: 'Drift slots', key: 'slots', width: 10 },
    { header: 'Grade', key: 'grade', width: 7 },
    { header: 'Skills', key: 'skillsText', width: 40 },
    { header: 'Display', key: 'display', width: 60 },
    { header: 'Matches', key: 'match', width: 9 },
    { header: 'Rank', key: 'rank', width: 7 },
    { header: 'Key', key: 'key', width: 14 },
    { header: 'Skill 1', key: 's1', width: 22 },
    { header: 'Lv 1', key: 'l1', width: 6 },
    { header: 'Skill 2', key: 's2', width: 22 },
    { header: 'Lv 2', key: 'l2', width: 6 },
    { header: 'Skill 3', key: 's3', width: 22 },
    { header: 'Lv 3', key: 'l3', width: 6 },
  ];

  d.armor.forEach((a) => {
    const parts = a.skills.map((sk) => {
      const s = d.skillById[sk.s];
      return (s ? s.name : sk.s) + ' (' + sk.l + ')';
    });
    const row = {
      name: a.name,
      slot: SLOT_LABEL[a.slot],
      series: a.series,
      def: a.def,
      slots: a.slots,
      grade: a.grade,
      skillsText: parts.join(', '),
      display: a.name + ' — ' + parts.join(', '),
    };
    a.skills.forEach((sk, i) => {
      const s = d.skillById[sk.s];
      row['s' + (i + 1)] = s ? s.name : String(sk.s);
      row['l' + (i + 1)] = sk.l;
    });
    shArmour.addRow(row);
  });
  const ARM_LAST = d.armor.length + 1;

  // Helper formulas. WANT is the block of skills you asked for on Picker.
  const WANT = 'Picker!$A$' + R.wantTop + ':$A$' + (R.wantTop + WANT_ROWS - 1);
  const IGNORE = 'Picker!$B$' + R.ignoreRow;

  // How many wanted cells hold a real skill. COUNTA would be wrong here: it
  // counts a cell set to the NONE sentinel as a selection.
  const WANT_ACTIVE = 'SUMPRODUCT((' + WANT + '<>"")*(' + WANT + '<>"' + NONE + '"))';

  // Show everything when nothing is really chosen, or when the bulk toggle is on.
  const NO_FILTER = 'OR(' + IGNORE + '="Yes",' + WANT_ACTIVE + '=0)';

  for (let r = 2; r <= ARM_LAST; r++) {
    // How many of the wanted skills this piece carries. Guarded with IF so a
    // blank skill cell cannot match a blank wanted cell. The NONE sentinel
    // never equals a real skill name, so it contributes nothing on its own.
    const hit = (col) => 'IF(' + col + r + '="",0,COUNTIF(' + WANT + ',' + col + r + '))';
    const raw = hit('$L') + '+' + hit('$N') + '+' + hit('$P');
    shArmour.getCell('I' + r).value = { formula: 'IF(' + NO_FILTER + ',1,' + raw + ')' };

    // Dense rank within the slot: pieces scoring higher come first, ties keep
    // sheet order (which is alphabetical).
    shArmour.getCell('J' + r).value = {
      formula:
        'IF($I' + r + '=0,"",' +
        'COUNTIFS($B$2:$B$' + ARM_LAST + ',$B' + r + ',$I$2:$I$' + ARM_LAST + ',">"&$I' + r + ')' +
        '+COUNTIFS($B$2:$B' + r + ',$B' + r + ',$I$2:$I' + r + ',$I' + r + '))',
    };
    shArmour.getCell('K' + r).value = { formula: 'IF($J' + r + '="","",$B' + r + '&"#"&$J' + r + ')' };
  }

  // ---- ArmourSkills (long) ----------------------------------------------
  shLong.columns = [
    { header: 'Armour', key: 'armor', width: 26 },
    { header: 'Slot', key: 'slot', width: 9 },
    { header: 'Skill', key: 'skill', width: 26 },
    { header: 'Level', key: 'level', width: 7 },
  ];
  d.long.forEach((r) => shLong.addRow(r));
  const LONG_LAST = d.long.length + 1;

  // ---- Lists (validation sources) ---------------------------------------
  // Five slot-name columns, plus the skill choice list with NONE on top.
  const skillChoices = [NONE].concat(d.skills.map((s) => s.name));
  shLists.columns = SLOTS.map((s) => ({ header: SLOT_LABEL[s], key: s, width: 26 }))
    .concat([{ header: 'Skill choice', key: 'CHOICE', width: 26 }]);

  const maxNames = Math.max.apply(null, SLOTS.map((s) => d.namesBySlot[s].length));
  const listRows = Math.max(maxNames, skillChoices.length);
  for (let i = 0; i < listRows; i++) {
    const row = {};
    SLOTS.forEach((s) => { row[s] = d.namesBySlot[s][i] || null; });
    row.CHOICE = skillChoices[i] || null;
    shLists.addRow(row);
  }
  const LIST_LAST = maxNames + 1;              // slot name columns A-E
  const CHOICE_LAST = skillChoices.length + 1; // skill choice column F

  // ---- Calc: total of every skill in the current build -------------------
  shCalc.columns = [
    { header: 'Skill', key: 'name', width: 26 },
    { header: 'Total in build', key: 'total', width: 13 },
    { header: 'Rank', key: 'rank', width: 7 },
  ];
  d.skills.forEach((s) => shCalc.addRow({ name: s.name }));
  const CALC_LAST = d.skills.length + 1;

  const PIECE_CELLS = [];
  for (let i = 0; i < SLOTS.length; i++) PIECE_CELLS.push('Picker!$B$' + (R.buildTop + i));

  for (let r = 2; r <= CALC_LAST; r++) {
    const terms = PIECE_CELLS.map((c) =>
      'SUMIFS(ArmourSkills!$D$2:$D$' + LONG_LAST +
      ',ArmourSkills!$A$2:$A$' + LONG_LAST + ',' + c +
      ',ArmourSkills!$C$2:$C$' + LONG_LAST + ',$A' + r + ')'
    );
    shCalc.getCell('B' + r).value = { formula: terms.join('+') };
    shCalc.getCell('C' + r).value = {
      formula:
        'IF($B' + r + '=0,"",COUNTIF($B$2:$B$' + CALC_LAST + ',">"&$B' + r + ')' +
        '+COUNTIF($B$2:$B' + r + ',$B' + r + '))',
    };
  }

  // ---- Picker ------------------------------------------------------------
  shPick.getColumn(1).width = 34;
  [2, 3, 4, 5].forEach((c) => (shPick.getColumn(c).width = 34));
  shPick.getColumn(6).width = 12;

  const title = shPick.getCell('A1');
  title.value = 'Monster Hunter Now — Armour Picker';
  title.font = { name: FONT, size: 15, bold: true, color: { argb: INK } };

  const note = shPick.getCell('A2');
  note.value = 'Only the shaded cells are yours to edit. Everything else is a formula.';
  note.font = { name: FONT, size: 9, italic: true, color: { argb: MUTED } };

  // 1. wanted skills
  shPick.getCell('A' + R.wantTitle).value = '1. Skills you want';
  shPick.getCell('A' + R.wantTitle).font = { name: FONT, size: 11, bold: true, color: { argb: ACCENT } };
  ['Wanted skill', 'In build', 'Cap'].forEach((h, i) => {
    shPick.getCell(R.wantHead, 1 + i).value = h;
  });
  styleHeader(shPick.getRow(R.wantHead));

  for (let i = 0; i < WANT_ROWS; i++) {
    const r = R.wantTop + i;
    const c = shPick.getCell('A' + r);
    c.fill = INPUT_FILL;
    // Source is the choice list, whose first entry is the NONE sentinel, so a
    // row can always be cleared from within the dropdown itself.
    c.dataValidation = {
      type: 'list', allowBlank: true,
      formulae: ['Lists!$F$2:$F$' + CHOICE_LAST],
      showErrorMessage: true, errorTitle: 'Unknown skill',
      error: 'Pick a skill from the list, or ' + NONE + ' to clear this row.',
    };
    const unset = 'OR($A' + r + '="",$A' + r + '="' + NONE + '")';
    shPick.getCell('B' + r).value = {
      formula: 'IF(' + unset + ',"",IFERROR(INDEX(Calc!$B$2:$B$' + CALC_LAST +
        ',MATCH($A' + r + ',Calc!$A$2:$A$' + CALC_LAST + ',0)),0))',
    };
    shPick.getCell('C' + r).value = {
      formula: 'IF(' + unset + ',"",IFERROR(INDEX(Skills!$C$2:$C$' + SKILL_LAST +
        ',MATCH($A' + r + ',Skills!$A$2:$A$' + SKILL_LAST + ',0)),""))',
    };
  }

  // Bulk reset. A real button needs Apps Script, which does not run in the
  // Google Sheets mobile app, so this is a plain toggle instead: set it to Yes
  // and every wanted skill is ignored without clearing what you typed.
  shPick.getCell('A' + R.ignoreRow).value = 'Ignore all wanted skills →';
  shPick.getCell('A' + R.ignoreRow).font =
    { name: FONT, size: 10, italic: true, color: { argb: MUTED } };
  shPick.getCell('A' + R.ignoreRow).alignment = { horizontal: 'right' };

  const ign = shPick.getCell('B' + R.ignoreRow);
  ign.value = 'No';
  ign.fill = INPUT_FILL;
  ign.dataValidation = {
    type: 'list', allowBlank: true,
    formulae: ['"No,Yes"'],
    showErrorMessage: true, errorTitle: 'Yes or No',
    error: 'Choose Yes to ignore every wanted skill, or No to use them.',
  };
  shPick.getCell('C' + R.ignoreRow).value = {
    formula: 'IF($B$' + R.ignoreRow + '="Yes","all skills ignored — showing every piece","")',
  };
  shPick.getCell('C' + R.ignoreRow).font =
    { name: FONT, size: 9, italic: true, color: { argb: MUTED } };

  // 2. candidates
  shPick.getCell('A' + R.candTitle).value = '2. Matching armour (best matches first)';
  shPick.getCell('A' + R.candTitle).font = { name: FONT, size: 11, bold: true, color: { argb: ACCENT } };

  SLOTS.forEach((s, i) => {
    shPick.getCell(R.candHead, 1 + i).value = SLOT_LABEL[s];
  });
  styleHeader(shPick.getRow(R.candHead));

  for (let i = 0; i < SLOTS.length; i++) {
    const colLetter = String.fromCharCode(65 + i);
    const slotRef = colLetter + '$' + R.candHead;
    for (let k = 0; k < CAND_ROWS; k++) {
      const r = R.candTop + k;
      shPick.getCell(colLetter + r).value = {
        formula:
          'IFERROR(INDEX(Armour!$H$2:$H$' + ARM_LAST + ',MATCH(' + slotRef + '&"#"&' +
          (k + 1) + ',Armour!$K$2:$K$' + ARM_LAST + ',0)),"")',
      };
      shPick.getCell(colLetter + r).font = { name: FONT, size: 9 };
      if (k % 2 === 1) shPick.getCell(colLetter + r).fill = BAND_FILL;
    }
    // honest footer: how many actually matched vs how many fit on screen
    shPick.getCell(colLetter + R.candFoot).value = {
      formula:
        '"— "&COUNTIFS(Armour!$B$2:$B$' + ARM_LAST + ',' + slotRef +
        ',Armour!$I$2:$I$' + ARM_LAST + ',">0")&" match; showing up to ' + CAND_ROWS + '"',
    };
    shPick.getCell(colLetter + R.candFoot).font =
      { name: FONT, size: 8, italic: true, color: { argb: MUTED } };
  }

  // 3. your build
  shPick.getCell('A' + R.buildTitle).value = '3. Your build — pick one piece per slot';
  shPick.getCell('A' + R.buildTitle).font = { name: FONT, size: 11, bold: true, color: { argb: ACCENT } };
  ['Slot', 'Piece', 'Defence', 'Drift slots'].forEach((h, i) => {
    shPick.getCell(R.buildHead, 1 + i).value = h;
  });
  styleHeader(shPick.getRow(R.buildHead));

  SLOTS.forEach((s, i) => {
    const r = R.buildTop + i;
    shPick.getCell('A' + r).value = SLOT_LABEL[s];
    const pick = shPick.getCell('B' + r);
    pick.fill = INPUT_FILL;
    const listCol = String.fromCharCode(65 + i);
    pick.dataValidation = {
      type: 'list', allowBlank: true,
      formulae: ['Lists!$' + listCol + '$2:$' + listCol + '$' + LIST_LAST],
      showErrorMessage: true, errorTitle: 'Unknown piece',
      error: 'Pick a piece from the list for this slot.',
    };
    shPick.getCell('C' + r).value = {
      formula: 'IF($B' + r + '="","",IFERROR(INDEX(Armour!$D$2:$D$' + ARM_LAST +
        ',MATCH($B' + r + ',Armour!$A$2:$A$' + ARM_LAST + ',0)),""))',
    };
    shPick.getCell('D' + r).value = {
      formula: 'IF($B' + r + '="","",IFERROR(INDEX(Armour!$E$2:$E$' + ARM_LAST +
        ',MATCH($B' + r + ',Armour!$A$2:$A$' + ARM_LAST + ',0)),""))',
    };
  });

  const TOT = R.buildTot;
  const bTop = R.buildTop, bEnd = R.buildTop + SLOTS.length - 1;
  shPick.getCell('A' + TOT).value = 'Total';
  shPick.getCell('B' + TOT).value = {
    formula: 'COUNTA($B$' + bTop + ':$B$' + bEnd + ')&" / ' + SLOTS.length + ' pieces"',
  };
  shPick.getCell('C' + TOT).value = { formula: 'SUM($C$' + bTop + ':$C$' + bEnd + ')' };
  shPick.getCell('D' + TOT).value = { formula: 'SUM($D$' + bTop + ':$D$' + bEnd + ')' };
  [1, 2, 3, 4].forEach((c) => {
    shPick.getCell(TOT, c).font = { name: FONT, size: 10, bold: true };
  });

  // 4. summary
  shPick.getCell('A' + R.sumTitle).value = '4. Combined skills (levels of the same skill are added up)';
  shPick.getCell('A' + R.sumTitle).font = { name: FONT, size: 11, bold: true, color: { argb: ACCENT } };
  ['Skill', 'Total', 'Cap', 'Effective', 'Wasted'].forEach((h, i) => {
    shPick.getCell(R.sumHead, 1 + i).value = h;
  });
  styleHeader(shPick.getRow(R.sumHead));

  for (let k = 0; k < SUM_ROWS; k++) {
    const r = R.sumTop + k;
    shPick.getCell('A' + r).value = {
      formula: 'IFERROR(INDEX(Calc!$A$2:$A$' + CALC_LAST + ',MATCH(' + (k + 1) +
        ',Calc!$C$2:$C$' + CALC_LAST + ',0)),"")',
    };
    shPick.getCell('B' + r).value = {
      formula: 'IF($A' + r + '="","",INDEX(Calc!$B$2:$B$' + CALC_LAST +
        ',MATCH($A' + r + ',Calc!$A$2:$A$' + CALC_LAST + ',0)))',
    };
    shPick.getCell('C' + r).value = {
      formula: 'IF($A' + r + '="","",IFERROR(INDEX(Skills!$C$2:$C$' + SKILL_LAST +
        ',MATCH($A' + r + ',Skills!$A$2:$A$' + SKILL_LAST + ',0)),""))',
    };
    shPick.getCell('D' + r).value = { formula: 'IF($A' + r + '="","",MIN($B' + r + ',$C' + r + '))' };
    shPick.getCell('E' + r).value = { formula: 'IF($A' + r + '="","",MAX(0,$B' + r + '-$C' + r + '))' };
    if (k % 2 === 1) {
      for (let c = 1; c <= 5; c++) shPick.getCell(r, c).fill = BAND_FILL;
    }
  }

  // ---- About -------------------------------------------------------------
  shAbout.getColumn(1).width = 100;
  const about = [
    ['Monster Hunter Now — Armour Picker', 15, true],
    ['', 10, false],
    ['How to use it', 12, true],
    ['1. On the Picker tab, choose up to ' + WANT_ROWS + ' skills in the shaded cells (section 1).', 10, false],
    ['2. Section 2 lists the armour in each slot carrying at least one of those skills,', 10, false],
    ['   best matches first, shown as "Name — Skill (level), Skill (level)".', 10, false],
    ['3. In section 3, pick one piece per slot from the shaded dropdowns.', 10, false],
    ['4. Section 4 adds up the skills across the five pieces you picked.', 10, false],
    ['', 10, false],
    ['Clearing your choices', 12, true],
    ['To clear ONE skill, pick "' + NONE + '" — it is the first entry in the same dropdown.', 10, false],
    ['A dropdown built from a list offers no blank entry, which is why the sentinel exists.', 10, false],
    ['To drop them ALL at once, set "Ignore all wanted skills" to Yes. That leaves what you', 10, false],
    ['chose in place but stops it filtering, so every piece is listed again. Set it back to No', 10, false],
    ['to get your selection working again.', 10, false],
    ['(A real clear-all button needs Apps Script, which does not run in the Sheets mobile app.)', 10, false],
    ['', 10, false],
    ['Only the shaded cells are inputs. Everything else is a formula — do not overwrite them.', 10, false],
    ['', 10, false],
    ['What the numbers mean', 12, true],
    ['Total     — levels of that skill added across your five pieces.', 10, false],
    ['Cap       — the highest level the skill actually goes to in game.', 10, false],
    ['Effective — Total capped at Cap. This is what you really get.', 10, false],
    ['Wasted    — levels above the cap, which do nothing.', 10, false],
    ['', 10, false],
    ['Notes and limits', 12, true],
    ['Armour is shown at each piece\'s MAX GRADE. A piece\'s skills differ at lower grades.', 10, false],
    ['Matching is ANY of the chosen skills, not all — with five slots to fill you want', 10, false],
    ['every candidate per slot.', 10, false],
    ['Section 2 shows up to ' + CAND_ROWS + ' pieces per slot; the line underneath says how many matched.', 10, false],
    ['With no skills chosen, every piece is listed, so you can browse.', 10, false],
    ['There is no set bonus in Monster Hunter Now — mixing series costs you nothing.', 10, false],
    ['The game calls the waist slot TORSO; this workbook calls it Waist.', 10, false],
    ['', 10, false],
    ['Data', 12, true],
    ['Source: monsterhunternow.com official game data, via the mhnow MySQL database.', 10, false],
    ['Generated: ' + new Date().toISOString().slice(0, 10), 10, false],
    ['Supporting tabs (Skills, Armour, ArmourSkills, Lists, Calc) are reference data', 10, false],
    ['and working columns. You can ignore them.', 10, false],
  ];
  about.forEach((a) => {
    const row = shAbout.addRow([a[0]]);
    row.getCell(1).font = { name: FONT, size: a[1], bold: a[2], color: { argb: a[2] ? INK : MUTED } };
  });

  // ---- global font pass --------------------------------------------------
  [shSkills, shArmour, shLong, shLists, shCalc].forEach((ws) => {
    ws.eachRow((row, n) => {
      row.eachCell((c) => {
        if (!c.font) c.font = { name: FONT, size: 10 };
        else if (!c.font.name) c.font = Object.assign({}, c.font, { name: FONT });
      });
      if (n === 1) styleHeader(row);
    });
    ws.views = [{ state: 'frozen', ySplit: 1 }];
  });
  shPick.eachRow((row) => {
    row.eachCell((c) => {
      if (!c.font) c.font = { name: FONT, size: 10, color: { argb: INK } };
      else if (!c.font.name) c.font = Object.assign({}, c.font, { name: FONT });
    });
  });

  // Reference tabs are noise on a phone; collapse them out of the way.
  [shArmour, shLong, shLists, shCalc].forEach((ws) => { ws.state = 'hidden'; });

  return wb;
}

// --- main -----------------------------------------------------------------

function main() {
  console.log('rendering picker/index.php ...');
  const p = payload();
  const d = shape(p);
  console.log('  ' + d.skills.length + ' skills, ' + d.armor.length + ' pieces, ' +
    d.long.length + ' armour-skill rows');

  console.log('  Picker layout: skills ' + R.wantTop + '-' + (R.wantTop + WANT_ROWS - 1) +
    ', candidates ' + R.candTop + '-' + (R.candTop + CAND_ROWS - 1) +
    ', build ' + R.buildTop + '-' + (R.buildTop + SLOTS.length - 1) +
    ', summary ' + R.sumTop + '-' + (R.sumTop + SUM_ROWS - 1));

  const wb = build(d);
  return wb.xlsx.writeFile(OUT).then(function () {
    const kb = (fs.statSync(OUT).size / 1024).toFixed(1);
    console.log('wrote ' + path.basename(OUT) + ' (' + kb + ' KB)');
  });
}

main().catch(function (e) {
  console.error(e.message || e);
  process.exit(1);
});
