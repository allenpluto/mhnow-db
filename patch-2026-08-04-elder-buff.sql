-- ###########################################################################
-- SUPERSEDED 2026-08-07 — DO NOT RUN.
--
-- The source republished its data on 2026-08-07 and every value this patch set
-- was confirmed to match it exactly (11 of 11, including both exceptions and
-- the driftsmelt grade progression). The database has been re-imported from
-- `seed.sql`, so this patch is now redundant.
--
-- Kept only as the audit trail of what was applied, and when, while the source
-- was stale. Re-running it today would be a no-op, but there is no reason to.
-- ###########################################################################

-- ---------------------------------------------------------------------------
-- Patch: August 2026 "Balance Adjustments for Select Armor", elder dragon sets
--
-- WHY THIS FILE EXISTS
-- The adjustment is live in game but monsterhunternow.com has not republished
-- its data, so `seed.sql` still carries the pre-patch values. This applies the
-- verified in-game values directly to the `mhnow` database.
--
-- PROVENANCE
-- Confirmed in game by the user on 2026-08-04, checking every elder dragon set
-- piece by piece, including the grade at which each change unlocks.
--
-- WHAT CHANGED
--   * 8 pieces  — the second listed skill goes to Lv2, and it is Lv2 from its
--                 unlock grade (6), not only at max grade.
--   * Kaiser Coil — EXCEPTION: the buff landed on the third skill, Burst,
--                 which unlocks at grade 8 and is Lv2 from there. The second
--                 skill, Power Prolonger, stays Lv1 at every grade.
--   * Kushala Cista — EXCEPTION: no skill change at all. Partbreaker stays
--                 Lv1. It gained a driftsmelt slot instead: slot 1 from
--                 grade 6, slot 2 from grade 8.
--
-- Only Kushala and Kaiser were adjusted. Nergigante, Kirin, Mizuha, Tentacle,
-- Malzeno and Rimeguard were each checked in game and are unchanged, so they
-- are absent here deliberately, not by omission.
--
-- Levels are set at EVERY grade the skill appears at, which is what "Lv2 on
-- unlock" means. This matters: 191 armour-skill pairs in this database do vary
-- their level by grade, so the fix is not simply "write the max grade value".
--
-- IDEMPOTENT — safe to run repeatedly.
--
-- WARNING: re-importing seed.sql reverts everything here. That is correct once
-- the source syncs; until then, re-run this file after any re-import.
-- Check the source with `npm run check`.
--
-- After applying: node export.js && node sheet.js
-- ---------------------------------------------------------------------------

USE `mhnow`;

START TRANSACTION;

-- --- the 8 pieces following the "second skill +1" rule ----------------------
-- No grade filter: the row exists only at grades where the skill is active,
-- so this sets Lv2 from its unlock grade onward, which is what was observed.

UPDATE armor_grade_skill ags
  JOIN armor_grade ag ON ag.id = ags.armor_grade_id
  JOIN armor a        ON a.id = ag.armor_id
  JOIN skill k        ON k.id = ags.skill_id
SET ags.level = 2
WHERE (a.name = 'Kushala Glare'    AND k.name = 'Reload Speed')
   OR (a.name = 'Kushala Grip'     AND k.name = 'Focus')
   OR (a.name = 'Kushala Cocoon'   AND k.name = 'Weakness Exploit')
   OR (a.name = 'Kushala Crus'     AND k.name = 'Skyward Striker')
   OR (a.name = 'Kaiser Crown'     AND k.name = 'Latent Power')
   OR (a.name = 'Kaiser Mail'      AND k.name = 'Critical Eye')
   OR (a.name = 'Kaiser Vambraces' AND k.name = 'Artillery')
   OR (a.name = 'Kaiser Greaves'   AND k.name = 'Critical Boost');

-- --- Kaiser Coil: third skill instead of the second ------------------------
-- Burst only exists from grade 8, so this is Lv2 from its unlock.
UPDATE armor_grade_skill ags
  JOIN armor_grade ag ON ag.id = ags.armor_grade_id
  JOIN armor a        ON a.id = ag.armor_id
  JOIN skill k        ON k.id = ags.skill_id
SET ags.level = 2
WHERE a.name = 'Kaiser Coil' AND k.name = 'Burst';

-- Power Prolonger explicitly held at Lv1, in case a previous run moved it.
UPDATE armor_grade_skill ags
  JOIN armor_grade ag ON ag.id = ags.armor_grade_id
  JOIN armor a        ON a.id = ag.armor_id
  JOIN skill k        ON k.id = ags.skill_id
SET ags.level = 1
WHERE a.name = 'Kaiser Coil' AND k.name = 'Power Prolonger';

-- --- Kushala Cista: driftsmelt slots instead of a skill ---------------------
UPDATE armor_grade ag JOIN armor a ON a.id = ag.armor_id
SET ag.driftsmelt_slots = 1
WHERE a.name = 'Kushala Cista' AND ag.grade BETWEEN 6 AND 7;

UPDATE armor_grade ag JOIN armor a ON a.id = ag.armor_id
SET ag.driftsmelt_slots = 2
WHERE a.name = 'Kushala Cista' AND ag.grade >= 8;

-- Partbreaker explicitly held at Lv1, in case a previous run moved it.
UPDATE armor_grade_skill ags
  JOIN armor_grade ag ON ag.id = ags.armor_grade_id
  JOIN armor a        ON a.id = ag.armor_id
  JOIN skill k        ON k.id = ags.skill_id
SET ags.level = 1
WHERE a.name = 'Kushala Cista' AND k.name = 'Partbreaker';

COMMIT;


-- --- verification ----------------------------------------------------------
-- The 8 rule-following pieces: expect Lv2 at every grade from 6.
SELECT a.name AS piece, k.name AS skill,
       GROUP_CONCAT(CONCAT('g', ag.grade, ':', ags.level) ORDER BY ag.grade SEPARATOR ' ') AS level_by_grade
FROM armor a
JOIN armor_grade ag        ON ag.armor_id = a.id
JOIN armor_grade_skill ags ON ags.armor_grade_id = ag.id
JOIN skill k               ON k.id = ags.skill_id
WHERE (a.name = 'Kushala Glare'    AND k.name = 'Reload Speed')
   OR (a.name = 'Kushala Grip'     AND k.name = 'Focus')
   OR (a.name = 'Kushala Cocoon'   AND k.name = 'Weakness Exploit')
   OR (a.name = 'Kushala Crus'     AND k.name = 'Skyward Striker')
   OR (a.name = 'Kaiser Crown'     AND k.name = 'Latent Power')
   OR (a.name = 'Kaiser Mail'      AND k.name = 'Critical Eye')
   OR (a.name = 'Kaiser Vambraces' AND k.name = 'Artillery')
   OR (a.name = 'Kaiser Greaves'   AND k.name = 'Critical Boost')
GROUP BY a.id, a.name, k.id, k.name
ORDER BY a.name;

-- The two exceptions.
SELECT a.name AS piece, k.name AS skill,
       GROUP_CONCAT(CONCAT('g', ag.grade, ':', ags.level) ORDER BY ag.grade SEPARATOR ' ') AS level_by_grade
FROM armor a
JOIN armor_grade ag        ON ag.armor_id = a.id
JOIN armor_grade_skill ags ON ags.armor_grade_id = ag.id
JOIN skill k               ON k.id = ags.skill_id
WHERE (a.name = 'Kaiser Coil'   AND k.name IN ('Burst','Power Prolonger'))
   OR (a.name = 'Kushala Cista' AND k.name = 'Partbreaker')
GROUP BY a.id, a.name, k.id, k.name
ORDER BY a.name, k.name;

SELECT a.name AS piece,
       GROUP_CONCAT(CONCAT('g', ag.grade, ':', ag.driftsmelt_slots) ORDER BY ag.grade SEPARATOR ' ') AS slots_by_grade
FROM armor a JOIN armor_grade ag ON ag.armor_id = a.id
WHERE a.name = 'Kushala Cista' GROUP BY a.id, a.name;

-- Control: the six untouched elder sets must still have no Lv2 second skills
-- introduced by this patch.
SELECT s.name AS untouched_series, SUM(ags.level = 2) AS any_lv2_skills
FROM armor a
JOIN armor_series s        ON s.id = a.series_id
JOIN armor_grade ag        ON ag.armor_id = a.id AND ag.grade = a.max_grade
JOIN armor_grade_skill ags ON ags.armor_grade_id = ag.id
WHERE s.name IN ('Nergigante Set','Kirin Set','Mizuha Set','Tentacle Set','Malzeno Set','Rimeguard Set')
GROUP BY s.name ORDER BY s.name;
