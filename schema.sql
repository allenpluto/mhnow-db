-- ---------------------------------------------------------------------------
-- Monster Hunter Now - equipment & skills database
-- Target: MySQL 5.7 (WAMP), InnoDB, utf8mb4
--
-- Source: the official site's own game data (monsterhunternow.com), so IDs
-- here are the game's real IDs, not invented ones.
--
-- Modelled on how the game actually works: an armour piece is not one row of
-- stats. It exists at several grades, and its skills and defence both change
-- as you upgrade it. So `armor` holds identity, `armor_grade` holds each
-- forgeable grade, and skills/defence hang off the grade.
--
-- Import order:  schema.sql  then  seed.sql
-- ---------------------------------------------------------------------------

SET NAMES utf8mb4;

CREATE DATABASE IF NOT EXISTS `mhnow`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `mhnow`;

SET FOREIGN_KEY_CHECKS = 0;

DROP VIEW  IF EXISTS `v_weapon_10_5`;
DROP VIEW  IF EXISTS `v_weapon_8_2`;
DROP VIEW  IF EXISTS `v_weapon_attributes`;
DROP VIEW  IF EXISTS `v_driftstone_skill`;
DROP VIEW  IF EXISTS `v_skill_source`;
DROP VIEW  IF EXISTS `v_armor_skill_at_grade`;
DROP VIEW  IF EXISTS `v_armor_max`;
DROP VIEW  IF EXISTS `armor_series`;

DROP TABLE IF EXISTS `weapon_horn_melody`;
DROP TABLE IF EXISTS `weapon_bow_arrow`;
DROP TABLE IF EXISTS `weapon_ammo`;
DROP TABLE IF EXISTS `weapon_grade_skill`;
DROP TABLE IF EXISTS `weapon_grade_level`;
DROP TABLE IF EXISTS `weapon_grade`;
DROP TABLE IF EXISTS `weapon`;

-- Superseded by the current schema; dropped so an upgrade from an older
-- install leaves nothing dangling.
DROP VIEW  IF EXISTS `v_skill_max_level_conflict`;
DROP VIEW  IF EXISTS `v_piece_skill_total`;
DROP VIEW  IF EXISTS `v_armor_piece_full`;
DROP TABLE IF EXISTS `armor_piece_skill`;
DROP TABLE IF EXISTS `armor_piece`;
DROP TABLE IF EXISTS `armor_set`;
DROP TABLE IF EXISTS `skill_alias`;

DROP TABLE IF EXISTS `driftstone_skill`;
DROP TABLE IF EXISTS `driftstone`;
DROP TABLE IF EXISTS `armor_grade_skill`;
DROP TABLE IF EXISTS `armor_grade_defense`;
DROP TABLE IF EXISTS `armor_grade`;
DROP TABLE IF EXISTS `armor`;
DROP TABLE IF EXISTS `series`;
-- Was a base table before weapons existed; it is a view now, so an upgrade
-- has to drop the old table. DROP VIEW above is a harmless no-op on a table.
DROP TABLE IF EXISTS `armor_series`;
DROP TABLE IF EXISTS `skill_level`;
DROP TABLE IF EXISTS `skill`;

SET FOREIGN_KEY_CHECKS = 1;


-- ---------------------------------------------------------------------------
-- Skills
-- ---------------------------------------------------------------------------

-- Shared by armour, weapons and driftstones. `id` is the game's skillId.
CREATE TABLE `skill` (
  `id`             SMALLINT UNSIGNED NOT NULL,
  `kind`           VARCHAR(64) NOT NULL COMMENT 'game enum, e.g. ATTACK_BOOST',
  `name`           VARCHAR(64) NOT NULL COMMENT 'display name, e.g. Attack Boost',
  `category`       ENUM('ATTACK_BOOST','ELEMENT_BOOST','BATTLE_ACTION','DEFENCE_BOOST','OTHERS') NOT NULL,
  `category_label` VARCHAR(32) NOT NULL COMMENT 'as shown in game: Attack, Element, Action, ...',
  `max_level`      TINYINT UNSIGNED NOT NULL,
  `sort_order`     INT UNSIGNED NOT NULL COMMENT 'in-game display order',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_skill_kind` (`kind`),
  KEY `ix_skill_name` (`name`),
  KEY `ix_skill_category` (`category`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The effect at each level. `description` has the numbers substituted in;
-- `description_template` keeps the raw string with {effect_amount_N}
-- placeholders, and the amounts are kept separately so you can compute with
-- them instead of parsing prose.
CREATE TABLE `skill_level` (
  `skill_id`             SMALLINT UNSIGNED NOT NULL,
  `level`                TINYINT UNSIGNED  NOT NULL,
  `description`          VARCHAR(600) NOT NULL,
  `description_template` VARCHAR(600) NOT NULL,
  `effect_amounts`       JSON NULL,
  `condition_amounts`    JSON NULL,
  `effect_amount_1`      INT NULL COMMENT 'first effect amount, lifted out for easy sorting/filtering',
  PRIMARY KEY (`skill_id`,`level`),
  CONSTRAINT `fk_skill_level_skill` FOREIGN KEY (`skill_id`)
    REFERENCES `skill` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ---------------------------------------------------------------------------
-- Armour
-- ---------------------------------------------------------------------------

-- There is no set bonus in MHN; a series is a naming/unlock grouping only.
--
-- This holds series for BOTH armour and weapons. Weapons introduce series that
-- no armour uses (104 vs 69), so the table is general and `armor_series`
-- remains available as a view over the armour-bearing subset — every query and
-- the picker that predate weapons keep working unchanged.
CREATE TABLE `series` (
  `id`         SMALLINT UNSIGNED NOT NULL COMMENT 'game seriesId',
  `kind`       VARCHAR(80) NOT NULL COMMENT 'game enum, e.g. SERIES_AKNOSOM',
  `name`       VARCHAR(80) NOT NULL COMMENT 'e.g. Aknosom Set',
  `sort_order` BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_series_kind` (`kind`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Identity of a piece, independent of grade.
-- Note the game calls the waist slot TORSO; `slot` keeps the game's wording.
CREATE TABLE `armor` (
  `id`        SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `kind`      VARCHAR(64) NOT NULL COMMENT 'game enum, e.g. AKNOSOM_ARMS',
  `series_id` SMALLINT UNSIGNED NOT NULL,
  `slot`      ENUM('HEAD','CHEST','ARMS','TORSO','LEGS') NOT NULL,
  `name`      VARCHAR(80) NOT NULL,
  `asset_key` VARCHAR(32) NULL,
  `min_grade` TINYINT UNSIGNED NOT NULL COMMENT 'lowest grade it can be forged at',
  `max_grade` TINYINT UNSIGNED NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_armor_kind` (`kind`),
  KEY `ix_armor_series` (`series_id`),
  KEY `ix_armor_slot` (`slot`),
  KEY `ix_armor_name` (`name`),
  CONSTRAINT `fk_armor_series` FOREIGN KEY (`series_id`)
    REFERENCES `series` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One row per grade the piece exists at. Driftsmelt slot count and the whole
-- skill loadout can differ between grades.
CREATE TABLE `armor_grade` (
  `id`               MEDIUMINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `armor_id`         SMALLINT UNSIGNED  NOT NULL,
  `grade`            TINYINT UNSIGNED   NOT NULL,
  `game_armor_id`    MEDIUMINT UNSIGNED NOT NULL COMMENT 'the game''s own armorId for this grade',
  `driftsmelt_slots` TINYINT UNSIGNED   NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_armor_grade` (`armor_id`,`grade`),
  UNIQUE KEY `uq_game_armor_id` (`game_armor_id`),
  CONSTRAINT `fk_armor_grade_armor` FOREIGN KEY (`armor_id`)
    REFERENCES `armor` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Within a grade there are 5 upgrade steps (grade 10 step 1..5 = "10.1".."10.5").
CREATE TABLE `armor_grade_defense` (
  `armor_grade_id` MEDIUMINT UNSIGNED NOT NULL,
  `step`           TINYINT UNSIGNED   NOT NULL COMMENT '1-5',
  `defense`        SMALLINT UNSIGNED  NOT NULL,
  PRIMARY KEY (`armor_grade_id`,`step`),
  CONSTRAINT `fk_agd_grade` FOREIGN KEY (`armor_grade_id`)
    REFERENCES `armor_grade` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The skills active on the piece once it reaches this grade. A piece gains
-- skills as it is upgraded, so compare across grades to see what unlocks when.
CREATE TABLE `armor_grade_skill` (
  `armor_grade_id` MEDIUMINT UNSIGNED NOT NULL,
  `skill_id`       SMALLINT UNSIGNED  NOT NULL,
  `level`          TINYINT UNSIGNED   NOT NULL,
  PRIMARY KEY (`armor_grade_id`,`skill_id`),
  KEY `ix_ags_skill` (`skill_id`),
  CONSTRAINT `fk_ags_grade` FOREIGN KEY (`armor_grade_id`)
    REFERENCES `armor_grade` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_ags_skill` FOREIGN KEY (`skill_id`)
    REFERENCES `skill` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ---------------------------------------------------------------------------
-- Driftsmelting
-- ---------------------------------------------------------------------------

-- Stones you slot into an armour piece's driftsmelt slots.
CREATE TABLE `driftstone` (
  `id`                 SMALLINT UNSIGNED NOT NULL COMMENT 'game id',
  `kind`               VARCHAR(80) NOT NULL COMMENT 'e.g. CRITICAL_EYE_FEYSTONE_1',
  `name`               VARCHAR(80) NOT NULL,
  `points`             TINYINT UNSIGNED NOT NULL,
  `walking_distance_m` MEDIUMINT UNSIGNED NULL COMMENT 'distance to walk to earn it',
  `is_random_pool`     TINYINT(1) NOT NULL DEFAULT 0
      COMMENT '1 = rolls one skill from a weighted pool; 0 = always the same skill',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_driftstone_kind` (`kind`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `driftstone_skill` (
  `driftstone_id` SMALLINT UNSIGNED NOT NULL,
  `skill_id`      SMALLINT UNSIGNED NOT NULL,
  `level`         TINYINT UNSIGNED  NOT NULL,
  `weight`        MEDIUMINT UNSIGNED NOT NULL COMMENT 'relative roll weight within the stone',
  `sort_id`       SMALLINT UNSIGNED NOT NULL,
  PRIMARY KEY (`driftstone_id`,`skill_id`,`level`),
  KEY `ix_ds_skill` (`skill_id`),
  CONSTRAINT `fk_ds_stone` FOREIGN KEY (`driftstone_id`)
    REFERENCES `driftstone` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_ds_skill` FOREIGN KEY (`skill_id`)
    REFERENCES `skill` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ---------------------------------------------------------------------------
-- Weapons
-- ---------------------------------------------------------------------------

-- Identity of a weapon, plus the per-type attributes, which are what you
-- actually filter on. Each attribute column is NULL for weapon types that do
-- not have it; the list attributes (ammo, arrows, melodies) are child tables
-- because a weapon has several.
--
-- A weapon is renamed as it is upgraded: it has a low-grade name and a
-- high-grade one. Both are kept — `name` is the grade-10 name, `low_name` the
-- earlier one, and `low_name_grade` says from which grade `name` takes over.
CREATE TABLE `weapon` (
  `id`             SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `kind`           VARCHAR(80) NOT NULL COMMENT 'game enum, e.g. AKNOSOM_DUALBLADES',
  `series_id`      SMALLINT UNSIGNED NOT NULL,
  `category`       ENUM('SWORD_SHIELD','DUAL_BLADES','GREAT_SWORD','LONG_SWORD','HAMMER',
                        'HUNTING_HORN','LANCE','GUNLANCE','SWITCH_AXE','CHARGE_BLADE',
                        'INSECT_GLAIVE','LIGHT_BOWGUN','HEAVY_BOWGUN','BOW') NOT NULL,
  `category_label` VARCHAR(32) NOT NULL,
  `element`        VARCHAR(16) NOT NULL COMMENT 'FIRE/WATER/.../NO_ELEMENT',
  `element_label`  VARCHAR(24) NOT NULL,
  `name`           VARCHAR(80) NOT NULL COMMENT 'name at max grade',
  `low_name`       VARCHAR(80) NULL COMMENT 'name before it is renamed',
  `low_name_grade` TINYINT UNSIGNED NULL COMMENT 'grade at which `name` takes over',
  `min_grade`      TINYINT UNSIGNED NOT NULL,
  `max_grade`      TINYINT UNSIGNED NOT NULL,
  `sort_order`     BIGINT UNSIGNED NOT NULL,

  -- gunlance
  `shelling_type`  VARCHAR(24) NULL,
  -- switch axe + charge blade (both call it a phial)
  `phial_type`     VARCHAR(32) NULL,
  `sword_mode_element_attack` SMALLINT UNSIGNED NULL COMMENT 'switch axe only',
  -- insect glaive kinsect
  `kinsect_type`            VARCHAR(24) NULL,
  `kinsect_attack_type`     VARCHAR(16) NULL COMMENT 'SMASH/PIERCE/POWDER',
  `kinsect_attack_attribute` VARCHAR(32) NULL COMMENT 'BLUNT/CUT',
  `kinsect_parameter_type`  VARCHAR(32) NULL COMMENT 'QUICK/POWER/STAMINA',
  `kinsect_attack_level`    VARCHAR(32) NULL,
  `kinsect_stamina_level`   VARCHAR(32) NULL,
  `kinsect_bonus_kind`      VARCHAR(32) NULL,
  -- hunting horn
  `horn_pattern`   VARCHAR(8) NULL COMMENT 'the unique melody pattern string',
  -- any type
  `customizable`     TINYINT(1) NULL,
  `style_selectable` TINYINT(1) NULL,

  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_weapon_kind` (`kind`),
  KEY `ix_weapon_series` (`series_id`),
  KEY `ix_weapon_category` (`category`),
  KEY `ix_weapon_element` (`element`),
  KEY `ix_weapon_name` (`name`),
  KEY `ix_weapon_shelling` (`shelling_type`),
  KEY `ix_weapon_phial` (`phial_type`),
  CONSTRAINT `fk_weapon_series` FOREIGN KEY (`series_id`)
    REFERENCES `series` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `weapon_grade` (
  `id`                  MEDIUMINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `weapon_id`           SMALLINT UNSIGNED  NOT NULL,
  `grade`               TINYINT UNSIGNED   NOT NULL,
  `game_weapon_id`      MEDIUMINT UNSIGNED NOT NULL,
  `special_skill`       VARCHAR(80) NULL COMMENT 'the weapon special attack, not an armour skill',
  `special_skill_level` TINYINT UNSIGNED NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_weapon_grade` (`weapon_id`,`grade`),
  UNIQUE KEY `uq_game_weapon_id` (`game_weapon_id`),
  CONSTRAINT `fk_wg_weapon` FOREIGN KEY (`weapon_id`)
    REFERENCES `weapon` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The 5 upgrade steps inside a grade. "8-2" is grade 8, level 2.
CREATE TABLE `weapon_grade_level` (
  `weapon_grade_id` MEDIUMINT UNSIGNED NOT NULL,
  `level`           TINYINT UNSIGNED   NOT NULL,
  `attack`          SMALLINT UNSIGNED  NOT NULL,
  `element_attack`  SMALLINT UNSIGNED  NOT NULL,
  `affinity`        SMALLINT           NOT NULL COMMENT 'percent, can be negative',
  PRIMARY KEY (`weapon_grade_id`,`level`),
  CONSTRAINT `fk_wgl_grade` FOREIGN KEY (`weapon_grade_id`)
    REFERENCES `weapon_grade` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Ordinary armour-type skills carried by a weapon at that grade.
CREATE TABLE `weapon_grade_skill` (
  `weapon_grade_id` MEDIUMINT UNSIGNED NOT NULL,
  `skill_id`        SMALLINT UNSIGNED  NOT NULL,
  `level`           TINYINT UNSIGNED   NOT NULL,
  PRIMARY KEY (`weapon_grade_id`,`skill_id`),
  KEY `ix_wgs_skill` (`skill_id`),
  CONSTRAINT `fk_wgs_grade` FOREIGN KEY (`weapon_grade_id`)
    REFERENCES `weapon_grade` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_wgs_skill` FOREIGN KEY (`skill_id`)
    REFERENCES `skill` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Bowgun magazines. This is the table that answers "which bowguns load
-- cluster ammo" — filter on ammo_type = 'CLUSTER'.
CREATE TABLE `weapon_ammo` (
  `weapon_id`  SMALLINT UNSIGNED NOT NULL,
  `position`   TINYINT UNSIGNED  NOT NULL COMMENT 'order shown in game',
  `ammo_id`    SMALLINT UNSIGNED NOT NULL COMMENT 'game ammo id',
  `ammo_type`  VARCHAR(16) NOT NULL COMMENT 'NORMAL/PIERCING/SPREAD/CLUSTER/STICKY/SLICING/WYVERN',
  `element`    VARCHAR(16) NOT NULL,
  `name`       VARCHAR(48) NOT NULL COMMENT 'e.g. Cluster Fire Ammo',
  `capacity`   TINYINT UNSIGNED NOT NULL,
  `recoil`     VARCHAR(24) NOT NULL,
  `reload`     VARCHAR(24) NOT NULL,
  PRIMARY KEY (`weapon_id`,`position`),
  KEY `ix_ammo_type` (`ammo_type`),
  KEY `ix_ammo_name` (`name`),
  CONSTRAINT `fk_ammo_weapon` FOREIGN KEY (`weapon_id`)
    REFERENCES `weapon` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `weapon_bow_arrow` (
  `weapon_id` SMALLINT UNSIGNED NOT NULL,
  `position`  TINYINT UNSIGNED  NOT NULL,
  `kind`      VARCHAR(32) NOT NULL COMMENT 'e.g. ARROW_SPREAD_01',
  `family`    VARCHAR(16) NOT NULL COMMENT 'SPREAD/RAPID/PIERCE',
  `name`      VARCHAR(48) NOT NULL COMMENT 'e.g. Spread Lv. 1',
  PRIMARY KEY (`weapon_id`,`position`),
  KEY `ix_arrow_family` (`family`),
  CONSTRAINT `fk_arrow_weapon` FOREIGN KEY (`weapon_id`)
    REFERENCES `weapon` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `weapon_horn_melody` (
  `weapon_id` SMALLINT UNSIGNED NOT NULL,
  `position`  TINYINT UNSIGNED  NOT NULL,
  `kind`      VARCHAR(48) NOT NULL COMMENT 'e.g. MELODY_ATTACK_BOOST',
  `name`      VARCHAR(48) NOT NULL COMMENT 'e.g. Attack Up (L)',
  PRIMARY KEY (`weapon_id`,`position`),
  KEY `ix_melody_name` (`name`),
  CONSTRAINT `fk_melody_weapon` FOREIGN KEY (`weapon_id`)
    REFERENCES `weapon` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ---------------------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------------------

-- Back-compatibility: everything written before weapons existed joins
-- `armor_series`. It is now the armour-bearing subset of `series`.
CREATE VIEW `armor_series` AS
SELECT s.`id`, s.`kind`, s.`name`, s.`sort_order`
FROM `series` s
WHERE EXISTS (SELECT 1 FROM `armor` a WHERE a.`series_id` = s.`id`);

-- Each piece at its highest grade, fully upgraded. This is what you compare
-- when building an endgame set.
CREATE VIEW `v_armor_max` AS
SELECT
  a.id            AS armor_id,
  ag.id           AS armor_grade_id,
  s.name          AS series_name,
  a.name          AS armor_name,
  a.slot,
  a.min_grade,
  ag.grade        AS max_grade,
  ag.driftsmelt_slots,
  MAX(d.defense)  AS max_defense
FROM armor a
JOIN armor_series s ON s.id = a.series_id
JOIN armor_grade ag ON ag.armor_id = a.id AND ag.grade = a.max_grade
LEFT JOIN armor_grade_defense d ON d.armor_grade_id = ag.id
GROUP BY a.id, ag.id, s.name, a.name, a.slot, a.min_grade, ag.grade, ag.driftsmelt_slots;

-- Every (piece, grade, skill) triple — use it to see when a skill unlocks.
CREATE VIEW `v_armor_skill_at_grade` AS
SELECT
  s.name  AS series_name,
  a.name  AS armor_name,
  a.slot,
  ag.grade,
  k.name  AS skill_name,
  k.category_label,
  ags.level
FROM armor_grade_skill ags
JOIN armor_grade ag ON ag.id = ags.armor_grade_id
JOIN armor a        ON a.id = ag.armor_id
JOIN armor_series s ON s.id = a.series_id
JOIN skill k        ON k.id = ags.skill_id;

-- "Which armour gives me this skill, and how much of it at max grade?"
CREATE VIEW `v_skill_source` AS
SELECT
  k.name   AS skill_name,
  k.category_label,
  k.max_level,
  s.name   AS series_name,
  a.name   AS armor_name,
  a.slot,
  ags.level,
  ag.grade AS at_grade
FROM armor a
JOIN armor_series s      ON s.id = a.series_id
JOIN armor_grade ag      ON ag.armor_id = a.id AND ag.grade = a.max_grade
JOIN armor_grade_skill ags ON ags.armor_grade_id = ag.id
JOIN skill k             ON k.id = ags.skill_id;

-- "Which driftstone can give me this skill, and how likely is it?"
CREATE VIEW `v_driftstone_skill` AS
SELECT
  k.name  AS skill_name,
  ds.name AS driftstone_name,
  d.level,
  d.weight,
  ROUND(100 * d.weight / OVER_TOTAL.total, 2) AS roll_chance_pct,
  ds.is_random_pool,
  ds.points,
  ds.walking_distance_m
FROM driftstone_skill d
JOIN driftstone ds ON ds.id = d.driftstone_id
JOIN skill k       ON k.id = d.skill_id
JOIN (SELECT driftstone_id, SUM(weight) AS total
      FROM driftstone_skill GROUP BY driftstone_id) OVER_TOTAL
  ON OVER_TOTAL.driftstone_id = d.driftstone_id;


-- Every weapon with its per-type attributes flattened into one row, including
-- the list attributes rolled up to a searchable string. This is the view to
-- filter on: `... WHERE ammo_types LIKE '%CLUSTER%'`, or join weapon_ammo for
-- the detail.
CREATE VIEW `v_weapon_attributes` AS
SELECT
  w.id, w.name, w.low_name, w.category_label, w.element_label,
  s.name AS series_name,
  w.shelling_type, w.phial_type, w.sword_mode_element_attack,
  w.kinsect_type, w.kinsect_attack_type, w.kinsect_attack_attribute,
  w.kinsect_parameter_type, w.kinsect_attack_level, w.kinsect_stamina_level,
  w.kinsect_bonus_kind, w.horn_pattern, w.customizable, w.style_selectable,
  (SELECT GROUP_CONCAT(DISTINCT a.ammo_type ORDER BY a.ammo_type SEPARATOR ',')
     FROM weapon_ammo a WHERE a.weapon_id = w.id) AS ammo_types,
  (SELECT GROUP_CONCAT(CONCAT(a.name,' x',a.capacity) ORDER BY a.position SEPARATOR '; ')
     FROM weapon_ammo a WHERE a.weapon_id = w.id) AS ammo,
  (SELECT GROUP_CONCAT(b.name ORDER BY b.position SEPARATOR ', ')
     FROM weapon_bow_arrow b WHERE b.weapon_id = w.id) AS arrows,
  (SELECT GROUP_CONCAT(m.name ORDER BY m.position SEPARATOR ', ')
     FROM weapon_horn_melody m WHERE m.weapon_id = w.id) AS melodies
FROM weapon w
JOIN series s ON s.id = w.series_id;

-- The two upgrade states that matter in practice. 8-2 is the common working
-- state; 10-5 is fully maxed.
CREATE VIEW `v_weapon_8_2` AS
SELECT w.id, w.name, w.category_label, w.element_label, s.name AS series_name,
       l.attack, l.element_attack, l.affinity,
       wg.special_skill
FROM weapon w
JOIN series s        ON s.id = w.series_id
JOIN weapon_grade wg ON wg.weapon_id = w.id AND wg.grade = 8
JOIN weapon_grade_level l ON l.weapon_grade_id = wg.id AND l.level = 2;

CREATE VIEW `v_weapon_10_5` AS
SELECT w.id, w.name, w.category_label, w.element_label, s.name AS series_name,
       l.attack, l.element_attack, l.affinity,
       wg.special_skill
FROM weapon w
JOIN series s        ON s.id = w.series_id
JOIN weapon_grade wg ON wg.weapon_id = w.id AND wg.grade = w.max_grade
JOIN weapon_grade_level l ON l.weapon_grade_id = wg.id AND l.level = 5;
