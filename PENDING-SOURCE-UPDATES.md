# Where the database deviates from the source

Nothing currently. The database is a straight import of `seed.sql`.

This file exists for the periods when it is not — when the game is patched but
`monsterhunternow.com` has not republished its data, and verified in-game values
are applied on top by a dated `patch-*.sql`.

---

## 2026-08-14 — a driftstone was withdrawn from the source

The 7 August update added driftstone `BREAK_ATTACK_BOOST_FEYSTONE_1`, named
**Burst Driftgem**, granting Pursuit Lv1. On 14 August the source dropped it
again — 37 driftstones back to 36.

It looks to have been published in error. The source already had a stone called
Burst Driftgem — `BURST_FEYSTONE_1`, which grants **Burst** — so for a week two
different stones shared one display name while granting different skills. The
one withdrawn is the newer, mis-named one; the original is untouched.

Nothing else moved: skills, armour and all 696 weapons are byte-identical. The
database has been re-imported and no longer carries the withdrawn stone. No
patch is needed — this is the source correcting itself, not lagging the game.

## RESOLVED 2026-08-07 — Balance Adjustments for Select Armor

The source republished on 2026-08-07, four days after the change went live in
game. The database has been re-imported from `seed.sql` and
`patch-2026-08-04-elder-buff.sql` is superseded (kept, headed DO NOT RUN, as the
audit trail).

**The patch was correct.** All 11 hand-verified values matched the source
exactly — the 8 rule-following pieces, both exceptions, and the driftsmelt
progression on Kushala Cista (`g6:1 g7:1 g8:2 g9:2 g10:2`).

### One thing to re-check in game

The source says **three Nergigante pieces did change**, contradicting the
in-game check that reported the set untouched:

| Piece | Skill | Source now says |
| --- | --- | --- |
| Nergigante Helm | Critical Eye | 1 → **2** |
| Nergigante Mail | Sneak Attack | 1 → **2** |
| Nergigante Coil | Attack Boost | 1 → **2** |

Vambraces (Offensive Guard) and Greaves (Reload Speed) are unchanged, so it is
3 of 5, not the whole set. The database currently follows the source.

### What the update actually contained

- **New skill:** Stunning Impact (`HEAVY_BLOW`, Attack, max Lv5) — the skill the
  Stunning Impact Driftgem had been referencing for weeks. That resolves the
  standing `build.js` warning, which is now gone.
- **New driftstone:** Burst Driftgem, granting Pursuit Lv1. Stunning Impact
  Driftgem finally has its skill attached.
- **Armour changes across 13 series**, not just the elders: Nergigante, plus
  Anjanath, Barroth, Diablos, Girros, Jagras, Jyuratodus, Kadachi, Legiana,
  Paolumu, Pukei, Rathalos, Rathian — the "early stage released monster
  material equipment" from the notice.
- **The buff is grade-tiered, not a flat +1.** On the older monster gear the
  skill now steps up at grade thresholds. Kadachi Greaves Thunder Resistance is
  `g4-5:1, g6-7:2, g8-10:3`; Anja Coil Fire Resistance is `g4-7:2, g8-10:3`;
  Diablos Mail Slugger is `g5-7:2, g8-10:3`. The elder sets got the simpler
  flat +1 from unlock. Anything reasoning about these values has to read the
  per-grade rows — the max-grade number alone hides the shape.
- **Lumu Mail gained a skill outright:** Windproof Lv1, which it did not have.
- **Anja Greaves gained a driftsmelt slot** at grades 8–10.

No **Mysterious Driftstone S** yet, despite the announcement.

### Two tooling faults this exposed, both fixed

1. **`build.js` snapshotted `data.prev.json` on every run**, so running it twice
   after an update destroyed the pre-update baseline and `diff.js` honestly
   reported "no changes" for a release that plainly changed things. That is
   exactly what happened here — the user's own `npm run check` produced the real
   178-change diff, and a second run minutes later compared two identical
   post-update files. It now snapshots only when the fetched data differs.
2. **`diff.js` exited 1 when it found changes**, which made npm print a wall of
   ELIFECYCLE errors that reads as a crash. It now exits 0 either way; pass
   `--exit-code` to gate on it.
