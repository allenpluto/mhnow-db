# Monster Hunter Now — equipment & skills database

A MySQL database of MHN **armour**, the **equipment-skill system** and
**driftsmelting**, generated from the game's own data.

## Where the data comes from

`monsterhunternow.com`. The official `/en/armor` and `/en/skills` pages are
server-rendered islands, and each ships the game's actual data table inside a
`props` attribute — armour, series, skills, driftstones, and the string table.
`build.js` parses that.

So the IDs in this database are the game's real IDs (`skill.id` is the game's
`skillId`, `armor_grade.game_armor_id` is its `armorId`), and the data is as
current as the site. Nothing is transcribed by hand or written from memory.

> An earlier version of this database was built from `monsterhunterwiki.org`.
> That source was stale — its armour pages had not been edited since April 2025
> and were missing whole series — so it was dropped entirely. See
> [Correction](#correction-from-the-wiki-based-version) below.

## Contents

| File | What it is |
| --- | --- |
| `schema.sql` | DDL — creates the `mhnow` database, 9 tables, 4 views |
| `seed.sql` | Generated data |
| `build.js` | Fetches the official pages, parses them, writes `seed.sql` + `data.json` |
| `data.json` | The same data as JSON |
| `queries.sql` | Worked examples — browsing, set building, driftsmelting, QA |
| `picker/` | Armour picker / build simulator, and the weapon picker (see below) |
| `export.js` | Bundles both pickers into self-contained HTML files |
| `mhnow-picker.html` | Standalone armour picker — generated, open it anywhere |
| `mhnow-weapon-picker.html` | Standalone weapon picker — generated, open it anywhere |
| `manual-weapons.json` | Event weapons the source never publishes, merged in by `build.js` |
| `diff.js` | Reports what changed between two `data.json` snapshots |
| `checklist.js` | Builds `SKILL-CHECK.md`, a prioritised list of gear to verify in game |
| `SKILL-CHECK.md` | Generated checklist — which pieces might have been buffed |
| `PENDING-SOURCE-UPDATES.md` | Where the database deviates from the source, and why |
| `patch-*.sql` | Verified in-game values applied on top of a stale source |
| `sheet.js` | Builds the Google Sheets / Excel version of the picker |
| `mhnow-armour-picker.xlsx` | The spreadsheet picker — generated, import to Google Sheets |

Row counts:

| | |
| --- | --- |
| skills | 130 (+ 504 level rows) |
| armour series | 69 |
| armour pieces | 345 (69 series × 5 slots) |
| armour grades | 2,410 |
| defence values | 12,050 |
| armour skill entries | 3,828 |
| driftstones | 36 (+ 198 skill entries) |

## Armour picker

A build simulator lives in `picker/`. With WAMP running:

    http://localhost/mhnow-db/picker/

- **Skill selector** — free-text input with partial matching (`crit` finds all
  six Critical\* skills). Arrow keys and Enter work; click a suggestion to add
  it. Selected skills become removable chips; Backspace on an empty input drops
  the last one.
- **Five slot columns** — Head, Chest, Arms, Waist, Legs. Each lists the pieces
  carrying at least one selected skill, name first and then one
  `Skill (level)` line per skill, with the skills you asked for highlighted.
  Ranked by how many of your skills the piece covers, then by levels brought.
- **Click a piece to equip it** into that slot; click it again, or the × in the
  column header, to remove it.
- **Summary panel** — combined skills across the equipped pieces, **summing
  levels of the same skill**, shown as `total / cap` with any excess flagged as
  wasted. Also totals defence and driftsmelt slots, and lists which of your
  wanted skills the current build does not yet cover.

`picker/index.php` reads the database and inlines a compact dataset, so the UI
does no round trips. Armour is shown **at each piece's max grade**, since that
is what you plan an endgame set against — a piece's skills differ at lower
grades, and `armor_grade_skill` has those if you want to extend it.

Matching is *any of* the selected skills, not *all* — with five slots to fill
you want to see every candidate per slot.

### Weapon picker

    http://localhost/mhnow-db/picker/weapons.php

All 696 weapons in a sortable table, **stats at grade 10-5**. Click any column
header to sort; the leader in the sorted column is highlighted.

Filters: weapon type, element, skill, customisation, free text across name /
series / attributes, plus one per-type attribute filter for each type that has
one:

| Filter | Applies to | Options |
| --- | --- | --- |
| Ammo type | bowguns (99) | Normal, Piercing, Spread, Cluster, Sticky, Slicing, Wyvern, **Status** |
| Bow charge / arrows | bows (51) | **charge level pattern** — 1-2-3-4 (32, standard), 1-2-4-4 (7), 2-3-3-4 (6), 1-1-4-4 (4), 2-2-4-3 (2); or arrow family — Spread 33, Rapid 34, Pierce 30 |
| Gunlance shelling | gunlances (48) | Normal 16, Wide 18, Long 14 |
| Kinsect | insect glaives (51) | attack type — Smash 19, Pierce 22, Powder 10; parameter — Quick 19, Power 14, Stamina 18 |

Every bow carries exactly four arrows, and the **charge level sequence matters
more than the families** — a 2-3-3-4 bow reaches a high charge level far sooner
than the standard 1-2-3-4 and plays quite differently. The pattern is therefore
the primary bow filter, with families kept as a second option group. It also
leads the Attributes column (`Charge 2-3-3-4 · Rapid Lv. 2 · …`).

**Status** is not a type the source has. It types Poison / Paralysis / Sleep
ammo as `NORMAL`, but that ammo gains nothing from Normal Ammo Boost, so the
picker reclassifies it — without it the Normal filter returned 68 weapons of
which 22 carried no Normal ammo at all. `weapon_ammo.ammo_type` in the database
still holds exactly what the source says.

The customisation filter maps the game's **style selectable** flag. Three
distinct states, which is why it is a dropdown rather than a checkbox:

| State | Weapons |
| --- | --- |
| Style selectable | 213 |
| Customisable, no style | 16 — every Insect Glaive that is customisable at all |
| Not customisable | 467 |

Insect Glaive is the only type where the two flags disagree: it is customisable
through its kinsect rather than through a style.

Alongside the raw ATK / ELE / AFF it computes:

| Column | What it is |
| --- | --- |
| `Sum` | attack + element |
| `Calib` | Sum × (1 + affinity × 0.25) — the default 125% crit |
| `Crit ATK` | raw build — Critical Boost 5 (150%) at **+30% affinity** (Critical Eye 1, Weakness Exploit 1). Sum × (1 + a × 0.50) |
| `Crit ELE` | elemental build — Critical Boost **1** (130%) with Critical Element 5 on top of it, element only. ATK × (1 + a × 0.30) + ELE × a × 2.34 + ELE × (1 − a) |
| `CF ATK` | Critical Ferocity 5 — final affinity = affinity − 30, no affinity skills alongside |
| `Best` | the highest of those three, skipping any that cannot apply. The table sorts by it |

Where `a` = final affinity = weapon affinity + 30%.

**Each column is a whole-hit damage figure** — alternative builds to compare,
never parts to add together. Affinity and Critical Boost apply to attack *and*
element, so those builds work off Sum; Critical Element applies to element only
and multiplies on top of Critical Boost.

**Final affinity is computed first, because it decides whether a skill applies
at all.** Critical Boost and Critical Element need final affinity > 0; Critical
Ferocity needs < 0. Outside its range the cell shows an em dash rather than a
number that looks comparable but is not — 16 weapons blank on the crit columns
(affinity below −30), 14 on CF (above +30).

Two modelling notes:

- `Crit ELE` deliberately uses **Critical Boost 1, not 5**. Both at rank 5 plus
  the affinity skills is not a build you can actually assemble, so the maxed
  version would flatter elemental weapons.
- Critical Ferocity is modelled from the measured proc rate: a negative crit
  deals 250% on a **30%** proc and 75% otherwise, so the negative share is worth
  `0.30 × 2.5 + 0.70 × 0.75 = 1.275`, giving `Sum × ((1 − n) + n × 1.275)` with
  `n = |affinity − 30%|`. It returns exactly Sum at n = 0 and rises as affinity
  goes more negative.

The last column shows the per-type attributes — bowgun magazines with capacity
and recoil, gunlance shelling, phials, kinsect type, bow arrows, horn melodies.

### Standalone export

```bash
npm install     # once — pulls terser + clean-css
node export.js
```

Writes both pickers as self-contained files:

| File | Size |
| --- | --- |
| `mhnow-picker.html` | ~72 KB, 345 armour pieces |
| `mhnow-weapon-picker.html` | ~199 KB, 696 weapons |

CSS, JS and the whole dataset are inlined. They open straight off the
filesystem — no server, no database, no network. Copy them anywhere, mail them,
put them on a USB stick.

The two files **cross-link by filename**, so keep them in the same folder if you
want the header links to work. That is the only reference either file makes
outside itself.

The exporter renders each real page through the PHP CLI and inlines the result,
rather than rebuilding the markup. So **an export can never drift from the
site**, and no site file had to change to support it. Stylesheets and scripts
are discovered from the rendered HTML, so adding one to a page needs no change
to `export.js` — and if a page ends up with none inlined, it fails loudly
rather than shipping something that references files which will not be next
to it.

Minification: `clean-css` at level 2 for the CSS, `terser` with top-level
mangling for the JS (the app is a single IIFE with nothing exported, so that is
safe), then the markup is collapsed without touching script or style contents.

    css   6.8 KB -> 5.3 KB
    js   12.6 KB -> 6.4 KB
    data          58.8 KB   (130 skills, 345 pieces)

`terser` and `clean-css` are pinned to 4.x because Node 10 is what is installed
here; they land in `node_modules/` beside the scripts.

### Google Sheets version

```bash
node sheet.js
```

Writes **`mhnow-armour-picker.xlsx`** — the same picker as a spreadsheet, for
phones, where a downloaded HTML file often will not open.

**Getting it into Google Sheets:** upload the file to Drive, then open it and
choose **File → Save as Google Sheets**. Opening the `.xlsx` directly puts Drive
in compatibility mode, where some formulas and the dropdowns misbehave; the
converted copy is the one to use and share.

The **Picker** tab is the only one you touch, and it opens first:

1. Choose up to 5 skills in the shaded cells.
2. Section 2 lists matching armour per slot, best matches first, as
   `Name — Skill (level), Skill (level)`.
3. Pick one piece per slot from the shaded dropdowns.
4. Section 4 adds the skills up, with `Total`, `Cap`, `Effective` and `Wasted`.

**Clearing a choice.** A dropdown backed by a range offers no blank entry, so
the skill list starts with a `(none)` sentinel — pick it to clear that one row.
Every formula treats `(none)` as "not chosen", which is why the active-selection
count uses `SUMPRODUCT((range<>"")*(range<>"(none)"))` and not `COUNTA`.

To drop them all at once, set **Ignore all wanted skills** to `Yes`. That leaves
your selection in place but stops it filtering, so the lists show everything
again; set it back to `No` to resume. It is a toggle rather than a button
because a real button needs Apps Script, which does not run in the Google
Sheets mobile app.

`Skills` and `About` are readable reference tabs. `Armour`, `ArmourSkills`,
`Lists` and `Calc` are hidden working data.

**Formula policy — important if you edit `sheet.js`.** No `FILTER`, `UNIQUE`,
`SORT` or `XLOOKUP`. Those spill, and a generated `.xlsx` carries no spill
metadata, so they break on open and behave differently between Excel and
Sheets. Everything uses `COUNTIF(S)` / `SUMIFS` / `INDEX` / `MATCH` / `IFERROR`,
which evaluate identically in Excel 2007+, Google Sheets and LibreOffice. The
dynamic lists use the classic rank-then-lookup idiom: a hidden helper column
assigns each matching row a 1..n rank, and the visible grid pulls rank *k* with
`INDEX`/`MATCH`.

The Picker row map in `sheet.js` is **derived**, not hardcoded — every section
starts below the one above it. Hardcoding it once let the candidate grid
silently overwrite the build section.

#### Differences from the web picker

A spreadsheet cannot do click-to-equip, so:

- Candidates are one row per piece (`Name — skills`) rather than the name with
  its skills on lines beneath it.
- You equip via a dropdown of that slot's pieces, not by tapping a candidate.
  The dropdown lists all 69 pieces for the slot, so it stays valid whatever you
  have selected.
- Section 2 shows up to 20 pieces per slot; the line underneath always reports
  how many actually matched.

## Install

```bash
mysql -u root < schema.sql && mysql -u root < seed.sql
```

Both are idempotent — `schema.sql` drops and recreates, `seed.sql` truncates
before inserting. Tested on MySQL 5.7.21.

## Regenerate

```bash
node build.js
```

Prints a report: row counts, armour per slot, skills per category, grade spans,
and any skill reference it could not resolve.

## Checking for a game update

```bash
npm run check
```

That is `node build.js && node diff.js`. `build.js` snapshots the old
`data.json` to `data.prev.json` before overwriting, and `diff.js` reports what
actually moved.

**Row counts alone prove nothing** — a balance patch can change effect numbers,
level text, or a piece's skills without any count shifting. `diff.js` compares
on stable keys (the game's own ids and enum kinds), never the synthetic
auto-increment ids in the snapshot, which shuffle if ordering changes.

Coverage is skills, armour, driftsmelting **and weapons** — weapon definitions,
per-grade stats at every level, skills on weapons, bowgun ammo, bow arrows and
horn melodies. Weapon rows key off the game's `weaponId`, not the snapshot's
auto-increment `weapon_grade.id`, so a reordered build does not read as a
change.

`diff.js` exits 0 either way, so finding changes does not make npm print a wall
of ELIFECYCLE errors as though the run had crashed. To gate a rebuild on it,
call `node diff.js --exit-code`, which returns 1 when there are changes.

**`build.js` only snapshots `data.prev.json` when the fetched data actually
differs.** Snapshotting unconditionally means a second run destroys the
baseline: run it twice after an update and the "previous" snapshot is
post-update too, so the diff honestly reports no changes for a release that
plainly changed things. That has happened once already.

If it reports changes, re-import and rebuild the outputs:

```bash
mysql -u root < schema.sql && mysql -u root < seed.sql && node export.js && node sheet.js
```

### The site can lag the game

Checked on 2026-08-03, the day the *Balance Adjustments for Select Armor*
update went live in game: the official data payload was **byte-identical** to
the 30 July fetch apart from the date comment. The announced changes — higher
levels on some armour skills, extra driftsmelt slots, and the new *Mysterious
Driftstone S* — had not been published to the site's data tables.

There is a standing tell for this. `build.js` warns that driftstone
`HEAVY_BLOW_FEYSTONE_1` ("Stunning Impact Driftgem") references a skill,
`HEAVY_BLOW`, that is absent from the published skill table. The stone is
listed; the skill it grants is not. Treat a warning like that as the site being
mid-update rather than as a bug here.

When that happens, values confirmed in game are applied to the database by a
dated `patch-*.sql`, and what/why is recorded in
[PENDING-SOURCE-UPDATES.md](PENDING-SOURCE-UPDATES.md). Those patches are
idempotent and re-runnable.

**The database and `seed.sql` then disagree on purpose.** `seed.sql` is
regenerated from the source and knows nothing about a patch, so re-importing it
silently reverts one — which is what you want once the source syncs, and a trap
before then. `npm run check` still works either way: `diff.js` compares source
snapshots, not the database.

## Schema

The important design point: **an armour piece is not one row of stats.** It
exists at several grades, and both its skills and its defence change as you
upgrade it. Rathalos Mail is Weakness Exploit Lv1 at grade 5 and Lv2 from grade
6 up; it gains a driftsmelt slot at grade 8. Flattening that into one row would
throw away most of what you need to plan an upgrade path.

```
skill ──< skill_level                     effect text + raw numbers per level
  │
  ├──< armor_grade_skill >── armor_grade >── armor >── armor_series
  │                            │
  │                            └──< armor_grade_defense    5 steps per grade
  │
  └──< driftstone_skill  >── driftstone
```

- **`skill`** — 130 skills in 5 categories. Shared by armour, weapons and
  driftstones, so adding weapons later means one `weapon` + `weapon_skill` pair
  and no change here.
- **`skill_level`** — `description` has the numbers substituted in;
  `description_template` keeps the raw `{effect_amount_1}` form, and
  `effect_amounts` / `effect_amount_1` hold the numbers separately so you can
  compute with them instead of parsing prose.
- **`armor`** — identity of a piece: series, slot, name, and the grade range it
  can exist at. The game calls the waist slot `TORSO`; `slot` keeps the game's
  wording rather than inventing a translation.
- **`armor_grade`** — one row per forgeable grade, with that grade's
  driftsmelt slot count.
- **`armor_grade_defense`** — the 5 upgrade steps inside a grade
  (grade 10 step 1..5 = "10.1".."10.5").
- **`armor_grade_skill`** — the piece's **complete** skill loadout at that
  grade, not a delta.
- **`driftstone`** / **`driftstone_skill`** — 30 stones grant a fixed skill;
  6 (the coloured ones) roll from a weighted pool, so `weight` is what you need
  for odds. `is_random_pool` distinguishes them.

Views: `v_armor_max` (each piece at top grade), `v_armor_skill_at_grade` (when
a skill unlocks), `v_skill_source` (which armour grants a skill),
`v_driftstone_skill` (stone → skill, with `roll_chance_pct` computed).

There is **no set bonus** in MHN, so `armor_series` is a naming and unlock
grouping, not a mechanic.

## Correction from the wiki-based version

The wiki listed a piece's skills as a flat list with "unlock grade" markers, and
I read two rows of the same skill as two stacking entries — which made Rathalos
Mail look like Weakness Exploit **3**. The official data shows each grade's full
loadout, and Rathalos Mail is Weakness Exploit **2** at max grade. The two wiki
rows were the same skill at successive grades, not two entries. The current
schema has no stacking assumption in it at all.

## Known gaps

- One driftstone (`HEAVY_BLOW_FEYSTONE_1`) references a skill, `HEAVY_BLOW`,
  that is not in the released skill table — presumably unreleased. Its
  `driftstone` row exists with no `driftstone_skill` children rather than being
  silently dropped. The last query in `queries.sql` finds it.
- The `OTHERS` skill category is part of the game's enum and is kept in the
  schema, but no current skill uses it. All 130 fall into Attack (58), Element
  (30), Defense/Resistance (23) or Action (19).
- Skill *level* data exists for every skill, but the site does not publish which
  **weapons** carry which skills on the armour page — that needs `/en/weapons`.

## Not covered yet

Monsters. The armour payload **already contains a `monsters` object** (67
monsters with weaknesses, breakable parts, habitats, and full material/drop
lists) that `build.js` currently ignores — a schema extension plus a few dozen
lines in the generator.

Weapons *are* covered: all 14 types at every grade, with the per-type
attributes (bowgun ammo, bow arrows, gunlance shelling, switch axe and charge
blade phials, hunting horn melodies, insect glaive kinsects) and both the 8-2
and 10-5 stat lines.

## Event content

The source publishes **no event weapons, armour or skills at all**. Everything
from a seasonal or collaboration event lives in `manual-weapons.json` and is
merged in on every build, so it survives a rebuild. Those entries are supplied
by reading the game directly, and each records where its numbers came from.

Two things make that safer than it sounds. Stats are validated against the
tier tables the source does publish — a 10-5 attack figure either is one of the
known tiers or it is flagged — and in-game wording is translated through
measured mappings rather than guessed at, because the enums the source ships
are not the words the game shows. `kinsect-labels.js` holds one such mapping
and re-verifies it on demand.

## The published site

`docs/` is what GitHub Pages serves, and `export.js` regenerates it on every
run so it cannot drift from the site:

| File | What it is |
| --- | --- |
| `docs/index.html` | armour picker, at the bare URL |
| `docs/mhnow-weapon-picker.html` | weapon picker |
| `docs/.nojekyll` | skips Jekyll processing |

Both are self-contained — the dataset is inlined, so there is no server, no
database and no network call once the page loads. They cross-link to each
other, and that is the only reference either file makes outside itself.

`node export.js --docs-only` rebuilds `docs/` from the exports already on disk,
for when the database is not running.
