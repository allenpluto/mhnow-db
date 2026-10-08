<?php
/**
 * MHN weapon picker — data bootstrap.
 *
 * Stats are taken at GRADE 10, LEVEL 5 (fully maxed) via v_weapon_10_5.
 * The derived damage columns are computed client side; the formulas and the
 * skill values behind them are stated on the page itself, because several of
 * them are interpretations of game mechanics rather than published numbers.
 *
 * PHP 5.6 compatible.
 */

$DB_HOST = '127.0.0.1';
$DB_NAME = 'mhnow';
$DB_USER = 'root';
$DB_PASS = '';

try {
    $pdo = new PDO('mysql:host=' . $DB_HOST . ';dbname=' . $DB_NAME . ';charset=utf8mb4',
        $DB_USER, $DB_PASS, array(PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION));
} catch (PDOException $e) {
    header('Content-Type: text/plain; charset=utf-8');
    echo "Cannot reach the mhnow database.\n\n" . $e->getMessage() . "\n\n";
    echo "Import it first:\n  mysql -u root < schema.sql && mysql -u root < seed.sql\n";
    exit;
}

/**
 * The words the game shows for recoil and reload.
 *
 * The enums are SMALL/MEDIUM/LARGE/LARGE_2/EXTRA_LARGE, which prettify into
 * "Small", "Large 2" and so on — wording that appears nowhere in the game and
 * leaks an internal distinction. The game says Low/Average/High/Very high for
 * recoil and Fast/Normal/Slow/Very slow for reload, and collapses LARGE and
 * LARGE_2 into the same word. That mapping was measured by matching 192 ammo
 * entries in MHN.xlsx against the same entries in the source.
 */
function ammoLabel($field, $value)
{
    static $L = array(
        'recoil' => array(
            'RECOIL_SMALL' => 'Low', 'RECOIL_MEDIUM' => 'Average',
            'RECOIL_LARGE' => 'High', 'RECOIL_LARGE_2' => 'High',
            'RECOIL_EXTRA_LARGE' => 'Very high', 'RECOIL_WYVERN' => 'Wyvern',
        ),
        'reload' => array(
            'RELOAD_SMALL' => 'Fast', 'RELOAD_MEDIUM' => 'Normal',
            'RELOAD_LARGE' => 'Slow', 'RELOAD_LARGE_2' => 'Slow',
            'RELOAD_EXTRA_LARGE' => 'Very slow',
        ),
    );
    if (isset($L[$field][$value])) return $L[$field][$value];
    // An unmapped enum is worth seeing rather than silently prettifying.
    return $value;
}

/**
 * The words the game shows for the kinsect enums. The source publishes only the
 * enums, and its names are not the display names — EXTEND_ENHANCEMENT shows as
 * "Harvest Bonus" while ENHANCEMENT_HARVEST_UP shows as "Charged Harvest Bonus",
 * so prettifying the enum in place gets that pair backwards. Derived from ten
 * glaives read in game; see kinsect-labels.js, which re-checks the mapping.
 */
function kinsectLabel($field, $value)
{
    static $L = array(
        'kinsect_attack_type' => array(
            'PIERCE' => 'Flight', 'SMASH' => 'Assist', 'POWDER' => 'Powder',
        ),
        'kinsect_parameter_type' => array(
            'PARAMETER_TYPE_POWER' => 'Power', 'PARAMETER_TYPE_QUICK' => 'Rapid',
            'PARAMETER_TYPE_STAMINA' => 'Stamina',
        ),
        'kinsect_attack_attribute' => array(
            'ATTACK_ATTRIBUTE_CUT' => 'Severing', 'ATTACK_ATTRIBUTE_BLUNT' => 'Blunt',
        ),
        'kinsect_bonus_kind' => array(
            'PIERCE_TYPE_1' => 'Follow-Up Bonus', 'PIERCE_TYPE_2' => 'Aerial Bonus',
            'POWDER_TYPE_1' => 'Stamina Bonus', 'POWDER_TYPE_2' => 'Mighty Powder Bonus',
            'POWDER_TYPE_3' => 'Cluster Powder Bonus', 'SMASH_TYPE_1' => 'Stun Bonus',
            'SMASH_TYPE_2' => 'Assist Bonus', 'SMASH_TYPE_3' => 'Elemental Bonus',
            'EXTEND_ENHANCEMENT' => 'Harvest Bonus',
            'ENHANCEMENT_HARVEST_UP' => 'Charged Harvest Bonus',
        ),
    );
    return isset($L[$field][$value]) ? $L[$field][$value] : $value;
}

// --- weapons at 10-5 -------------------------------------------------------

$sql = 'SELECT w.id, w.name, w.low_name, w.category_label AS type, w.element_label AS element,
               s.name AS series, m.attack, m.element_attack, m.affinity, m.special_skill,
               w.shelling_type, w.phial_type, w.sword_mode_element_attack,
               w.kinsect_attack_type, w.kinsect_parameter_type, w.kinsect_attack_attribute,
               w.kinsect_bonus_kind, w.kinsect_attack_level,
               w.kinsect_stamina_level, w.horn_pattern,
               w.customizable, w.style_selectable
        FROM weapon w
        JOIN series s          ON s.id = w.series_id
        JOIN v_weapon_10_5 m   ON m.id = w.id
        ORDER BY w.category_label, w.name';

$weapons = array();
foreach ($pdo->query($sql)->fetchAll(PDO::FETCH_ASSOC) as $r) {
    $id = (int) $r['id'];
    $weapons[$id] = array(
        'id'   => $id,
        'n'    => $r['name'],
        'low'  => $r['low_name'],
        't'    => $r['type'],
        'e'    => $r['element'],
        'ser'  => $r['series'],
        'atk'  => (int) $r['attack'],
        'ele'  => (int) $r['element_attack'],
        'aff'  => (int) $r['affinity'],
        'sp'   => $r['special_skill'],
        'sk'   => array(),
        'attr' => array(),      // human-readable per-type attributes
        'ammo' => array(),      // ammo TYPE codes, for filtering
        // NULL means the weapon has no customisation entry at all, which is a
        // different thing from being customisable but not style-selectable.
        'cz'   => $r['customizable'] === null ? null : (int) $r['customizable'],
        'ss'   => $r['style_selectable'] === null ? null : (int) $r['style_selectable'],
        // per-type filter keys, the same idea as the bowgun ammo list
        'arw'  => array(),                                   // bow arrow families
        'ml'   => array(),                                   // hunting horn melodies
        'sh'   => $r['shelling_type'],                       // gunlance shelling
        'kt'   => $r['kinsect_attack_type'],                 // insect glaive kinsect
        'kp'   => $r['kinsect_parameter_type'],
        'ka'   => $r['kinsect_attack_attribute'],
        'kb'   => $r['kinsect_bonus_kind'],
    );

    if ($r['style_selectable'] !== null) {
        $weapons[$id]['attr'][] = $r['style_selectable'] ? 'Style selectable' : 'Customisable, no style';
    }

    // per-type attributes, flattened for display
    if ($r['shelling_type'])  $weapons[$id]['attr'][] = 'Shelling: ' . ucwords(strtolower(str_replace('SHELLING_', '', $r['shelling_type'])));
    if ($r['phial_type'])     $weapons[$id]['attr'][] = 'Phial: ' . ucwords(strtolower(str_replace(array('PHIAL_', '_'), array('', ' '), $r['phial_type'])));
    if ($r['sword_mode_element_attack']) $weapons[$id]['attr'][] = 'Sword-mode element ' . (int) $r['sword_mode_element_attack'];
    if ($r['kinsect_attack_type']) {
        // The game shows four kinsect attributes: kinsect type, performance type,
        // attack type and bonus. Their enum names are NOT the displayed words, so
        // they go through $kinsectLabel rather than being prettified in place.
        $bits = array();
        foreach (array('kinsect_attack_type', 'kinsect_parameter_type',
                       'kinsect_attack_attribute', 'kinsect_bonus_kind') as $f) {
            if ($r[$f]) $bits[] = kinsectLabel($f, $r[$f]);
        }
        $weapons[$id]['attr'][] = 'Kinsect: ' . implode(', ', $bits);
    }
    if ($r['horn_pattern']) $weapons[$id]['attr'][] = 'Pattern ' . $r['horn_pattern'];
}

// skills at max grade
$sql = 'SELECT wg.weapon_id, k.name, wgs.level
        FROM weapon_grade wg
        JOIN weapon w              ON w.id = wg.weapon_id AND wg.grade = w.max_grade
        JOIN weapon_grade_skill wgs ON wgs.weapon_grade_id = wg.id
        JOIN skill k               ON k.id = wgs.skill_id';
foreach ($pdo->query($sql)->fetchAll(PDO::FETCH_ASSOC) as $r) {
    $id = (int) $r['weapon_id'];
    if (isset($weapons[$id])) $weapons[$id]['sk'][] = array('n' => $r['name'], 'l' => (int) $r['level']);
}

// bowgun ammo
//
// The source types Poison / Paralysis / Sleep ammo as NORMAL with a status
// element. They are not Normal ammo in any useful sense — they gain nothing
// from Normal/Element Ammo Boost — so for filtering they are reclassified as
// STATUS. `ammo_type` in the database stays exactly as the source has it.
$STATUS_AMMO = array('POISON', 'SLEEP', 'PARALYSIS');
$ammoCodes = array();

$sql = 'SELECT weapon_id, ammo_type, element, name, capacity, recoil, reload FROM weapon_ammo ORDER BY weapon_id, position';
foreach ($pdo->query($sql)->fetchAll(PDO::FETCH_ASSOC) as $r) {
    $id = (int) $r['weapon_id'];
    if (!isset($weapons[$id])) continue;
    $code = in_array($r['element'], $STATUS_AMMO, true) ? 'STATUS' : $r['ammo_type'];
    $ammoCodes[$code] = true;
    $weapons[$id]['ammo'][] = $code;
    $recoil = ammoLabel('recoil', $r['recoil']);
    $reload = ammoLabel('reload', $r['reload']);
    $weapons[$id]['attr'][] = $r['name'] . ' x' . $r['capacity']
        . ' (' . $recoil . ' recoil, ' . $reload . ' reload)';
}
// bow arrows
//
// A bow's four arrows each have a charge level, and the LEVEL SEQUENCE matters
// more than which families it draws from: the standard bow is 1-2-3-4, while
// something like 2-3-3-4 reaches a high level far sooner and plays completely
// differently. So the pattern is captured as a first-class filter key.
$arrowLevels = array();     // weapon id -> levels in position order
foreach ($pdo->query('SELECT weapon_id, kind, family, name FROM weapon_bow_arrow ORDER BY weapon_id, position')->fetchAll(PDO::FETCH_ASSOC) as $r) {
    $id = (int) $r['weapon_id'];
    if (!isset($weapons[$id])) continue;
    $weapons[$id]['attr'][] = $r['name'];
    if (!in_array($r['family'], $weapons[$id]['arw'], true)) $weapons[$id]['arw'][] = $r['family'];
    $arrowLevels[$id][] = (int) substr(strrchr($r['kind'], '_'), 1);
}

$arrowPatternCount = array();
foreach ($arrowLevels as $id => $lv) {
    $pattern = implode('-', $lv);
    $weapons[$id]['alv'] = $pattern;
    // Put the pattern in front of the arrow list so it reads at a glance.
    array_unshift($weapons[$id]['attr'], 'Charge ' . $pattern);
    $arrowPatternCount[$pattern] = isset($arrowPatternCount[$pattern]) ? $arrowPatternCount[$pattern] + 1 : 1;
}
// horn melodies
//
// A horn plays several, so this filters the same way arrow families do: does the
// weapon have this melody at all. Keyed on `kind` rather than the display name,
// because the manual entries used to carry a placeholder kind and keying on the
// name would have quietly merged them.
$melodyRows = $pdo->query('SELECT weapon_id, kind, name FROM weapon_horn_melody ORDER BY weapon_id, position')->fetchAll(PDO::FETCH_ASSOC);

$rawNames = array();
foreach ($melodyRows as $r) $rawNames[$r['kind']] = $r['name'];

// The (L) and (S) sizes of one effect filter as a single option: asking for
// "Attack Up" almost always means either size, and keeping them apart put five
// near-duplicate pairs in a list that is already the longest here.
//
// Pairing is decided by the DISPLAYED name with the size suffix removed, not by
// the enum's _L/_S ending. Those mostly agree, but MELODY_WINDPROOF_L and _S are
// "Wind Pressure Negated" and "Wind Pressure Resistance" — the game presents them
// as two different effects rather than two sizes of one, so they stay separate.
// Going by the label also means a new pair merges on its own.
$melodyGroups = array();
foreach ($rawNames as $kind => $name) {
    $melodyGroups[preg_replace('/\s*\((?:L|S)\)$/', '', $name)][] = $kind;
}
$melodyCode = array();      // raw kind -> the code the filter matches on
$melodyNames = array();     // that code -> the label without the size suffix
foreach ($melodyGroups as $label => $kinds) {
    usort($kinds, function ($a, $b) {
        if (strlen($a) !== strlen($b)) return strlen($a) - strlen($b);
        return strcmp($a, $b);
    });
    $code = $kinds[0];      // shortest kind, which is the unsuffixed one when there is one
    foreach ($kinds as $k) $melodyCode[$k] = $code;
    $melodyNames[$code] = $label;
}
asort($melodyNames);

foreach ($melodyRows as $r) {
    $id = (int) $r['weapon_id'];
    if (!isset($weapons[$id])) continue;
    // The table still shows the exact melody, sizes and all — only the filter merges.
    $weapons[$id]['attr'][] = $r['name'];
    $code = $melodyCode[$r['kind']];
    if (!in_array($code, $weapons[$id]['ml'], true)) $weapons[$id]['ml'][] = $code;
}

$types    = $pdo->query('SELECT DISTINCT category_label FROM weapon ORDER BY category_label')->fetchAll(PDO::FETCH_COLUMN);
$elements = $pdo->query('SELECT DISTINCT element_label FROM weapon ORDER BY element_label')->fetchAll(PDO::FETCH_COLUMN);
$ammoTypes = array_keys($ammoCodes);
sort($ammoTypes);

// The other per-type attributes, each offered the same way the ammo list is.
// Values keep the raw code; the label is what the game shows.
$pretty = function ($v, $prefix) {
    return ucwords(strtolower(str_replace(array($prefix, '_'), array('', ' '), $v)));
};
// Charge-level patterns first, commonest last-but-labelled, then the families.
arsort($arrowPatternCount);
$mostCommon = key($arrowPatternCount);
$arrowPatterns = array();
foreach ($arrowPatternCount as $p => $n) {
    $arrowPatterns[] = array(
        'v' => 'lv:' . $p,
        'l' => $p . ' (' . $n . ($p === $mostCommon ? ', standard' : '') . ')',
    );
}
$arrowTypes = array();
foreach ($pdo->query('SELECT DISTINCT family FROM weapon_bow_arrow ORDER BY family')->fetchAll(PDO::FETCH_COLUMN) as $v) {
    $arrowTypes[] = array('v' => 'fam:' . $v, 'l' => $pretty($v, ''));
}
$shellingTypes = array();
foreach ($pdo->query('SELECT DISTINCT shelling_type FROM weapon WHERE shelling_type IS NOT NULL ORDER BY shelling_type')->fetchAll(PDO::FETCH_COLUMN) as $v) {
    $shellingTypes[] = array('v' => $v, 'l' => $pretty($v, 'SHELLING_'));
}
// The four kinsect attributes the game shows, each its own filter group. Options
// are sorted by their displayed word rather than by the enum, since the two do
// not share an order.
$kinsectGroups = array();
foreach (array('kinsect_attack_type' => 'type', 'kinsect_parameter_type' => 'param',
               'kinsect_attack_attribute' => 'attr', 'kinsect_bonus_kind' => 'bonus') as $col => $key) {
    $opts = array();
    foreach ($pdo->query('SELECT DISTINCT ' . $col . ' FROM weapon WHERE ' . $col . ' IS NOT NULL')->fetchAll(PDO::FETCH_COLUMN) as $v) {
        $opts[] = array('v' => $key . ':' . $v, 'l' => kinsectLabel($col, $v));
    }
    usort($opts, function ($a, $b) { return strcmp($a['l'], $b['l']); });
    $kinsectGroups[$key] = $opts;
}
$skillNames = $pdo->query(
    'SELECT DISTINCT k.name FROM weapon_grade wg
     JOIN weapon w ON w.id = wg.weapon_id AND wg.grade = w.max_grade
     JOIN weapon_grade_skill wgs ON wgs.weapon_grade_id = wg.id
     JOIN skill k ON k.id = wgs.skill_id ORDER BY k.name')->fetchAll(PDO::FETCH_COLUMN);

$melodyOpts = array();
foreach ($melodyNames as $kind => $name) {
    $melodyOpts[] = array('v' => 'mel:' . $kind, 'l' => $name);
}
$ammoOpts = array();
foreach ($ammoTypes as $v) {
    $ammoOpts[] = array('v' => 'ammo:' . $v, 'l' => $pretty($v, ''));
}
foreach ($shellingTypes as $i => $o) {
    $shellingTypes[$i]['v'] = 'shell:' . $o['v'];
}

/**
 * Every per-type attribute filter, as one ordered list of groups.
 *
 * These were four separate dropdowns, which let you ask for a cluster-magazine
 * gunlance — a combination no weapon can satisfy, since ammo belongs to bowguns
 * and shelling to gunlances. Four controls advertised sixteen pairings of which
 * only four were ever answerable. One control cannot express the contradiction.
 *
 * `types` says which weapon types a group applies to. The page uses it to show
 * only the groups relevant to whatever types are ticked, which matters because
 * the melody group alone is 36 options — the full flat list would bury shelling's
 * three under it.
 */
$attrGroups = array(
    array('label' => 'Bowgun ammo',        'types' => array('Light Bowgun', 'Heavy Bowgun'), 'opts' => $ammoOpts),
    array('label' => 'Bow charge pattern', 'types' => array('Bow'),                          'opts' => $arrowPatterns),
    array('label' => 'Bow arrow family',   'types' => array('Bow'),                          'opts' => $arrowTypes),
    array('label' => 'Gunlance shelling',  'types' => array('Gunlance'),                     'opts' => $shellingTypes),
    array('label' => 'Hunting horn melody','types' => array('Hunting Horn'),                 'opts' => $melodyOpts),
    array('label' => 'Kinsect type',       'types' => array('Insect Glaive'),                'opts' => $kinsectGroups['type']),
    array('label' => 'Kinsect performance','types' => array('Insect Glaive'),                'opts' => $kinsectGroups['param']),
    array('label' => 'Kinsect attack type','types' => array('Insect Glaive'),                'opts' => $kinsectGroups['attr']),
    array('label' => 'Kinsect bonus',      'types' => array('Insect Glaive'),                'opts' => $kinsectGroups['bonus']),
);

$payload = array(
    'weapons'    => array_values($weapons),
    'types'      => $types,
    'elements'   => $elements,
    'attrGroups' => $attrGroups,
    'skills'     => $skillNames,
);
$json = json_encode($payload, JSON_HEX_TAG | JSON_HEX_AMP | JSON_UNESCAPED_UNICODE);

/**
 * Cache-bust static assets by modification time.
 *
 * The page itself is regenerated on every request, but app.css / weapons.js
 * are static files the browser will happily keep. Add a filter or a column and
 * you get fresh markup running stale script — which shows up as a control that
 * renders but never populates. Stamping the mtime makes the URL change
 * whenever the file does.
 */
function asset($f) {
    $p = __DIR__ . DIRECTORY_SEPARATOR . $f;
    return $f . (is_file($p) ? '?v=' . filemtime($p) : '');
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MHN Weapon Picker</title>
<link rel="stylesheet" href="<?php echo asset('app.css'); ?>">
<link rel="stylesheet" href="<?php echo asset('weapons.css'); ?>">
</head>
<body>

<header class="topbar">
  <h1>Weapon Picker</h1>
  <p class="sub">
    <?php echo count($weapons); ?> weapons &middot; stats at grade 10-5 &middot;
    <a href="./">armour picker</a>
  </p>
</header>

<section class="filters">
  <div class="fgroup">
    <label class="flabel">Weapon type</label>
    <div class="checkrow" id="f-type"></div>
  </div>
  <div class="fgroup">
    <label class="flabel">Element</label>
    <div class="checkrow" id="f-element"></div>
  </div>
  <div class="fgroup narrow">
    <label class="flabel" for="f-skill">Skill</label>
    <select id="f-skill"><option value="">any</option></select>
  </div>
  <div class="fgroup narrow">
    <label class="flabel" for="f-attr">Weapon attribute</label>
    <select id="f-attr"><option value="">any</option></select>
  </div>
  <div class="fgroup">
    <label class="flabel">Customisation</label>
    <div class="checkrow" id="f-custom"></div>
  </div>
  <div class="fgroup narrow">
    <label class="flabel" for="f-text">Search</label>
    <input id="f-text" type="text" autocomplete="off"
           placeholder="blast -bowgun"
           title="Several terms must all match. Put a minus in front of a term to exclude it, and quotes around a phrase that contains a space, e.g. blast -bowgun or &quot;cluster fire ammo&quot;. Searches the name, series, type, element, skills and attributes — not monster names.">
  </div>
  <button type="button" id="f-reset" class="linkbtn">reset filters</button>
</section>

<section class="assumptions">
  <strong>Derived columns</strong> — from the maxed 10-5 stats. Affinity and Critical Boost apply to
  attack <em>and</em> element, so every build below is computed off <b>Sum</b>.
  <b>Each column is a whole-hit damage figure — they are alternative builds to compare, not parts to add up.</b>
  <br>
  Each build's <b>final affinity</b> is worked out first, because that decides whether its skill applies at all:
  Critical Boost and Critical Element only when final affinity &gt; 0, Critical Ferocity only when &lt; 0.
  Outside its range a column shows &mdash; rather than a meaningless number.
  <br>
  <span class="a">Sum</span> = attack + element.
  <span class="a">Calib</span> = Sum &times; (1 + affinity &times; 0.25), or &times; 0.75 on the negative share.
  <span class="a">Crit ATK</span> &mdash; final affinity <b>a = affinity + 30%</b> (Critical Eye 1, Weakness Exploit 1).
  Critical Boost 5 hits attack and element alike: Sum &times; (1 + a &times; 0.50).
  <span class="a">Crit ELE</span> &mdash; the elemental build, same affinity <b>a</b>. Critical Boost 5 and
  Critical Element 5 cannot realistically be worn together with the affinity skills, so this uses
  <b>Critical Boost 1 (130%)</b> with Critical Element 5 multiplying on top of it, on element only:
  the critting element share deals 1.30 &times; 1.80 = <b>2.34</b>.
  ATK &times; (1 + a &times; 0.30) + ELE &times; a &times; 2.34 + ELE &times; (1 &minus; a).
  <span class="a">CF ATK</span> &mdash; final affinity <b>affinity &minus; 30%</b>, no affinity skills alongside it.
  With n = |final affinity|, a negative crit deals 250% on a measured <b>30%</b> proc and 75% otherwise,
  so Sum &times; ((1 &minus; n) + n &times; 1.275).
  <span class="a">Best</span> = the highest of those three builds, ignoring any that cannot apply.
  The table is sorted by it.
  <br>
  <span class="warn">Blast, Poison, Paralysis and Sleep weapons</span> carry an ELE value that is a status
  <b>buildup rate, not damage</b> &mdash; higher triggers the ailment sooner. Those 110 weapons are treated
  as no-element in every damage column, and their ELE is shown greyed with a &dagger;.
  For the same reason the <b>Normal</b> ammo filter excludes Poison / Paralysis / Sleep ammo, which the
  source types as NORMAL but which gains nothing from Normal Ammo Boost &mdash; those sit under <b>Status</b>.
</section>

<main>
  <div class="tablewrap">
    <table id="grid">
      <thead><tr id="head"></tr></thead>
      <tbody id="body"></tbody>
    </table>
  </div>
  <p class="count" id="count"></p>
</main>

<script id="data" type="application/json"><?php echo $json; ?></script>
<script src="<?php echo asset('weapons.js'); ?>"></script>
</body>
</html>
