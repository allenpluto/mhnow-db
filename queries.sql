-- Worked examples against the mhnow database.
-- Run individually; this file is not meant to be executed end to end.

USE `mhnow`;


-- ---------------------------------------------------------------------------
-- Browsing
-- ---------------------------------------------------------------------------

-- A skill and its full level table, with the raw numbers alongside the prose.
SELECT k.name, k.category_label, l.level, l.description, l.effect_amount_1
FROM skill k
JOIN skill_level l ON l.skill_id = k.id
WHERE k.name = 'Critical Boost'
ORDER BY l.level;

-- Everything a series gives you at max grade.
SELECT a.name AS armor_name, a.slot, m.max_defense, m.driftsmelt_slots,
       GROUP_CONCAT(CONCAT(k.name,' Lv',ags.level) ORDER BY k.name SEPARATOR ', ') AS skills
FROM armor a
JOIN armor_series s        ON s.id = a.series_id
JOIN v_armor_max m         ON m.armor_id = a.id
JOIN armor_grade_skill ags ON ags.armor_grade_id = m.armor_grade_id
JOIN skill k               ON k.id = ags.skill_id
WHERE s.name = 'Rathalos Set'
GROUP BY a.id, a.name, a.slot, m.max_defense, m.driftsmelt_slots
ORDER BY FIELD(a.slot,'HEAD','CHEST','ARMS','TORSO','LEGS');

-- How one piece evolves as you upgrade it: when skills unlock, how defence
-- and driftsmelt slots move.
SELECT ag.grade, ag.driftsmelt_slots,
       MIN(d.defense) AS defense_at_step_1,
       MAX(d.defense) AS defense_at_step_5,
       GROUP_CONCAT(DISTINCT CONCAT(k.name,' Lv',ags.level) ORDER BY k.name SEPARATOR ', ') AS skills
FROM armor a
JOIN armor_grade ag             ON ag.armor_id = a.id
LEFT JOIN armor_grade_defense d ON d.armor_grade_id = ag.id
LEFT JOIN armor_grade_skill ags ON ags.armor_grade_id = ag.id
LEFT JOIN skill k               ON k.id = ags.skill_id
WHERE a.name = 'Rathalos Mail'
GROUP BY ag.grade, ag.driftsmelt_slots
ORDER BY ag.grade;

-- Exact defence at a given grade and step, e.g. "grade 8.3".
SELECT a.name, ag.grade, d.step, d.defense
FROM armor a
JOIN armor_grade ag         ON ag.armor_id = a.id
JOIN armor_grade_defense d  ON d.armor_grade_id = ag.id
WHERE a.name = 'Rathalos Mail' AND ag.grade = 8 AND d.step = 3;


-- ---------------------------------------------------------------------------
-- Set building
-- ---------------------------------------------------------------------------

-- Where can I get a skill, and how much per piece at max grade?
SELECT series_name, armor_name, slot, level
FROM v_skill_source
WHERE skill_name = 'Weakness Exploit'
ORDER BY level DESC, FIELD(slot,'HEAD','CHEST','ARMS','TORSO','LEGS');

-- Best piece per slot for one skill.
SELECT slot, series_name, armor_name, level
FROM v_skill_source v
WHERE skill_name = 'Attack Boost'
  AND level = (SELECT MAX(level) FROM v_skill_source
               WHERE skill_name = v.skill_name AND slot = v.slot)
ORDER BY FIELD(slot,'HEAD','CHEST','ARMS','TORSO','LEGS');

-- Theoretical maximum of every skill from armour alone: best piece per slot,
-- summed, capped at the skill's own maximum.
SELECT k.name, k.category_label,
       k.max_level AS skill_cap,
       LEAST(SUM(best.level), k.max_level) AS reachable_from_armor,
       SUM(best.level) AS uncapped_sum,
       COUNT(*)        AS slots_contributing
FROM skill k
JOIN (
  SELECT v.skill_name, v.slot, MAX(v.level) AS level
  FROM v_skill_source v
  GROUP BY v.skill_name, v.slot
) best ON best.skill_name = k.name
GROUP BY k.id, k.name, k.category_label, k.max_level
ORDER BY reachable_from_armor DESC, k.name;

-- Defence is not a differentiator at endgame: every piece converges on 197 at
-- grade 10.5, so this returns a large tie. It matters mid-game, where the
-- grade range differs — a piece that starts at grade 1 is far behind a
-- grade-6 piece until both are maxed.
SELECT a.min_grade, s.name AS series_name, a.name AS armor_name, a.slot,
       MAX(d.defense) AS defense_at_min_grade
FROM armor a
JOIN armor_series s        ON s.id = a.series_id
JOIN armor_grade ag        ON ag.armor_id = a.id AND ag.grade = a.min_grade
JOIN armor_grade_defense d ON d.armor_grade_id = ag.id
GROUP BY a.id, a.min_grade, s.name, a.name, a.slot
ORDER BY defense_at_min_grade DESC, s.name
LIMIT 20;

-- Defence spread across all pieces at max grade (expect a single value).
SELECT max_defense, COUNT(*) AS pieces FROM v_armor_max GROUP BY max_defense;

-- Pieces carrying two or more offensive skills at max grade — build anchors.
SELECT s.name AS series_name, a.name AS armor_name, a.slot,
       COUNT(*) AS attack_skills,
       GROUP_CONCAT(CONCAT(k.name,' Lv',ags.level) ORDER BY k.name SEPARATOR ', ') AS skills
FROM armor a
JOIN armor_series s        ON s.id = a.series_id
JOIN v_armor_max m         ON m.armor_id = a.id
JOIN armor_grade_skill ags ON ags.armor_grade_id = m.armor_grade_id
JOIN skill k               ON k.id = ags.skill_id
WHERE k.category = 'ATTACK_BOOST'
GROUP BY a.id, s.name, a.name, a.slot
HAVING attack_skills >= 2
ORDER BY attack_skills DESC, s.name;

-- Pieces you can forge early: available at grade 4 or below.
SELECT s.name AS series_name, a.name AS armor_name, a.slot, a.min_grade, a.max_grade
FROM armor a
JOIN armor_series s ON s.id = a.series_id
WHERE a.min_grade <= 4
ORDER BY a.min_grade, s.name, FIELD(a.slot,'HEAD','CHEST','ARMS','TORSO','LEGS');


-- ---------------------------------------------------------------------------
-- Driftsmelting
-- ---------------------------------------------------------------------------

-- Which driftstone can give me this skill, and at what chance?
SELECT driftstone_name, level, weight, roll_chance_pct, is_random_pool,
       points, walking_distance_m
FROM v_driftstone_skill
WHERE skill_name = 'Critical Eye'
ORDER BY roll_chance_pct DESC;

-- Guaranteed (single-skill) driftstones only.
SELECT ds.name AS driftstone_name, k.name AS skill_name, d.level, ds.points
FROM driftstone ds
JOIN driftstone_skill d ON d.driftstone_id = ds.id
JOIN skill k            ON k.id = d.skill_id
WHERE ds.is_random_pool = 0
ORDER BY k.name;

-- Total driftsmelt slots a full max-grade set gives you.
SELECT s.name AS series_name, SUM(m.driftsmelt_slots) AS total_slots
FROM v_armor_max m
JOIN armor a        ON a.id = m.armor_id
JOIN armor_series s ON s.id = a.series_id
GROUP BY s.id, s.name
ORDER BY total_slots DESC, s.name;


-- ---------------------------------------------------------------------------
-- Coverage and QA
-- ---------------------------------------------------------------------------

-- Skills no armour grants — weapon-only, driftstone-only, or unreleased.
SELECT k.name, k.category_label,
       EXISTS(SELECT 1 FROM driftstone_skill d WHERE d.skill_id = k.id) AS on_driftstone
FROM skill k
LEFT JOIN armor_grade_skill ags ON ags.skill_id = k.id
WHERE ags.skill_id IS NULL
GROUP BY k.id, k.name, k.category_label
ORDER BY k.category_label, k.name;

-- Most widely available skills.
SELECT k.name, k.category_label, COUNT(DISTINCT a.id) AS pieces
FROM skill k
JOIN armor_grade_skill ags ON ags.skill_id = k.id
JOIN v_armor_max m         ON m.armor_grade_id = ags.armor_grade_id
JOIN armor a               ON a.id = m.armor_id
GROUP BY k.id, k.name, k.category_label
ORDER BY pieces DESC, k.name
LIMIT 20;

-- Sanity: every piece should have 5 defence steps per grade.
SELECT ag.id, a.name, ag.grade, COUNT(d.step) AS steps
FROM armor_grade ag
JOIN armor a                ON a.id = ag.armor_id
LEFT JOIN armor_grade_defense d ON d.armor_grade_id = ag.id
GROUP BY ag.id, a.name, ag.grade
HAVING steps <> 5;

-- Driftstones that ended up with no skills (their skill is not in the
-- released skill table yet).
SELECT ds.id, ds.kind, ds.name
FROM driftstone ds
LEFT JOIN driftstone_skill d ON d.driftstone_id = ds.id
WHERE d.driftstone_id IS NULL;
