<?php
/**
 * MHN armour picker — data bootstrap.
 *
 * Reads the `mhnow` database and inlines a compact dataset into the page, so
 * the UI does no round trips. Armour is taken at its MAX GRADE, because that
 * is the loadout you plan an endgame set against; a piece's skills differ at
 * lower grades (see armor_grade_skill).
 *
 * PHP 5.6 compatible (that is what WAMP runs here).
 */

$DB_HOST = '127.0.0.1';
$DB_NAME = 'mhnow';
$DB_USER = 'root';
$DB_PASS = '';

try {
    $pdo = new PDO(
        'mysql:host=' . $DB_HOST . ';dbname=' . $DB_NAME . ';charset=utf8mb4',
        $DB_USER,
        $DB_PASS,
        array(PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION)
    );
} catch (PDOException $e) {
    header('Content-Type: text/plain; charset=utf-8');
    echo "Cannot reach the mhnow database.\n\n";
    echo $e->getMessage() . "\n\n";
    echo "Import it first, from the parent folder:\n";
    echo "  mysql -u root < schema.sql && mysql -u root < seed.sql\n";
    exit;
}

// --- skills ---------------------------------------------------------------

$skills = array();
$stmt = $pdo->query('SELECT id, name, category_label, max_level FROM skill ORDER BY name');
foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
    $skills[] = array(
        'id'   => (int) $r['id'],
        'name' => $r['name'],
        'cat'  => $r['category_label'],
        'max'  => (int) $r['max_level'],
    );
}

// --- armour at max grade --------------------------------------------------

$sql = 'SELECT a.id, a.name, a.slot, s.name AS series, a.min_grade, a.max_grade,
               ag.id AS grade_id, ag.driftsmelt_slots,
               MAX(d.defense) AS max_defense
        FROM armor a
        JOIN armor_series s        ON s.id = a.series_id
        JOIN armor_grade ag        ON ag.armor_id = a.id AND ag.grade = a.max_grade
        JOIN armor_grade_defense d ON d.armor_grade_id = ag.id
        GROUP BY a.id, a.name, a.slot, s.name, a.min_grade, a.max_grade,
                 ag.id, ag.driftsmelt_slots
        ORDER BY s.name, a.name';

$armor    = array();
$byGrade  = array();
foreach ($pdo->query($sql)->fetchAll(PDO::FETCH_ASSOC) as $r) {
    $id = (int) $r['id'];
    $armor[$id] = array(
        'id'      => $id,
        'name'    => $r['name'],
        'slot'    => $r['slot'],
        'series'  => $r['series'],
        'grade'   => (int) $r['max_grade'],
        'minG'    => (int) $r['min_grade'],
        'def'     => (int) $r['max_defense'],
        'slots'   => (int) $r['driftsmelt_slots'],
        'skills'  => array(),
    );
    $byGrade[(int) $r['grade_id']] = $id;
}

$sql = 'SELECT ag.id AS grade_id, ags.skill_id, ags.level
        FROM armor_grade ag
        JOIN armor a               ON a.id = ag.armor_id AND ag.grade = a.max_grade
        JOIN armor_grade_skill ags ON ags.armor_grade_id = ag.id';

foreach ($pdo->query($sql)->fetchAll(PDO::FETCH_ASSOC) as $r) {
    $gid = (int) $r['grade_id'];
    if (!isset($byGrade[$gid])) {
        continue;
    }
    $armor[$byGrade[$gid]]['skills'][] = array(
        's' => (int) $r['skill_id'],
        'l' => (int) $r['level'],
    );
}

$payload = array(
    'skills' => $skills,
    'armor'  => array_values($armor),
    'slots'  => array('HEAD', 'CHEST', 'ARMS', 'TORSO', 'LEGS'),
);

// JSON_HEX_TAG keeps a stray "</script>" in the data from breaking the page.
$json = json_encode($payload, JSON_HEX_TAG | JSON_HEX_AMP | JSON_UNESCAPED_UNICODE);

/**
 * Cache-bust static assets by modification time.
 *
 * The page is regenerated on every request, but app.css / app.js are static
 * files the browser will happily keep. Change the script and you get fresh
 * markup running stale code — which shows up as a control that renders but
 * never populates. Stamping the mtime makes the URL change with the file.
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
<title>MHN Armour Picker</title>
<link rel="stylesheet" href="<?php echo asset('app.css'); ?>">
</head>
<body>

<header class="topbar">
  <h1>Armour Picker</h1>
  <p class="sub">
    <?php echo count($armor); ?> pieces &middot; <?php echo count($skills); ?> skills &middot;
    skills shown at each piece's max grade &middot;
    <a href="weapons.php">weapon picker</a>
  </p>
</header>

<section class="skillbar">
  <label class="skillbar-label" for="skill-input">Skills you want</label>

  <div class="chiprow" id="chips"></div>

  <div class="combo">
    <input id="skill-input" type="text" autocomplete="off" spellcheck="false"
           placeholder="Type to search skills — e.g. crit, atk boost, resist">
    <ul id="suggest" class="suggest" hidden></ul>
  </div>

  <button type="button" id="clear-skills" class="linkbtn" hidden>clear skills</button>
</section>

<main class="layout">
  <div class="columns" id="columns"></div>

  <aside class="summary" id="summary"></aside>
</main>

<script id="data" type="application/json"><?php echo $json; ?></script>
<script src="<?php echo asset('app.js'); ?>"></script>
</body>
</html>
