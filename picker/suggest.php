<?php
/**
 * MHN armour set suggester — data bootstrap.
 *
 * Pick a weapon, and the page searches every armour combination for the set
 * that maximises damage. The scoring and the search are suggest-engine.js and
 * suggest-search.js from the parent folder, loaded unchanged — the website runs
 * the same code as the CLI rather than a second copy of the arithmetic.
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
    echo "Cannot reach the mhnow database.\n\n" . $e->getMessage() . "\n\n";
    echo "Import it first, from the parent folder:\n";
    echo "  mysql -u root < schema.sql && mysql -u root < seed.sql\n";
    exit;
}

// --- armour at max grade ---------------------------------------------------
$armour = array();
$sql = 'SELECT a.id, a.name, a.slot, s.name AS series, ag.driftsmelt_slots
        FROM armor a
        JOIN series s      ON s.id = a.series_id
        JOIN armor_grade ag ON ag.armor_id = a.id AND ag.grade = a.max_grade';
foreach ($pdo->query($sql)->fetchAll(PDO::FETCH_ASSOC) as $r) {
    $armour[(int) $r['id']] = array(
        'name'   => $r['name'],
        'slot'   => $r['slot'],
        'series' => $r['series'],
        'slots'  => (int) $r['driftsmelt_slots'],
        'skills' => new stdClass(),
    );
}
$sql = 'SELECT ag.armor_id, k.name, ags.level
        FROM armor_grade ag
        JOIN armor a               ON a.id = ag.armor_id AND ag.grade = a.max_grade
        JOIN armor_grade_skill ags ON ags.armor_grade_id = ag.id
        JOIN skill k               ON k.id = ags.skill_id';
foreach ($pdo->query($sql)->fetchAll(PDO::FETCH_ASSOC) as $r) {
    $id = (int) $r['armor_id'];
    if (isset($armour[$id])) $armour[$id]['skills']->{$r['name']} = (int) $r['level'];
}

// --- weapons at 10-5 -------------------------------------------------------
$weapons = array();
$sql = 'SELECT name, category_label, element_label, attack, element_attack, affinity, series_name
        FROM v_weapon_10_5 ORDER BY category_label, name';
foreach ($pdo->query($sql)->fetchAll(PDO::FETCH_ASSOC) as $r) {
    $weapons[] = array(
        'name'     => $r['name'],
        'category' => $r['category_label'],
        'element'  => $r['element_label'],
        'atk'      => (int) $r['attack'],
        'ele'      => (int) $r['element_attack'],
        'aff'      => (int) $r['affinity'],
        'series'   => $r['series_name'],
    );
}

// --- which skills a driftgem can grant -------------------------------------
// Critical Element and the Advanced skills have no driftgem at all, so the
// suggester must not offer them as gems however useful they would be.
$gemmable = array();
$sql = 'SELECT DISTINCT k.name FROM driftstone_skill ds JOIN skill k ON k.id = ds.skill_id';
foreach ($pdo->query($sql)->fetchAll(PDO::FETCH_COLUMN) as $n) $gemmable[$n] = true;

$payload = array(
    'armour'   => array_values($armour),
    'weapons'  => $weapons,
    'gemmable' => $gemmable,
);
$json = json_encode($payload, JSON_HEX_TAG | JSON_HEX_AMP | JSON_UNESCAPED_UNICODE);

function asset($f) {
    $p = __DIR__ . DIRECTORY_SEPARATOR . $f;
    return $f . (file_exists($p) ? '?v=' . filemtime($p) : '');
}
function parentAsset($f) {
    $p = dirname(__DIR__) . DIRECTORY_SEPARATOR . $f;
    return '../' . $f . (file_exists($p) ? '?v=' . filemtime($p) : '');
}
?><!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MHN Set Suggester</title>
<link rel="stylesheet" href="<?php echo asset('app.css'); ?>">
<link rel="stylesheet" href="<?php echo asset('suggest.css'); ?>">
</head>
<body>

<header class="topbar">
  <h1>Set Suggester</h1>
  <p class="sub">
    <?php echo count($weapons); ?> weapons &middot; <?php echo count($armour); ?> armour pieces &middot;
    <a href="./">armour picker</a> &middot; <a href="weapons.php">weapon picker</a>
  </p>
</header>

<section class="filters">
  <div class="fgroup">
    <label class="flabel" for="s-weapon">Weapon</label>
    <select id="s-weapon"></select>
  </div>
  <div class="fgroup narrow">
    <label class="flabel" for="s-atk">Attack bonus</label>
    <input id="s-atk" type="number" value="0" step="10">
  </div>
  <div class="fgroup narrow">
    <label class="flabel" for="s-ele">Element bonus</label>
    <input id="s-ele" type="number" value="0" step="10">
  </div>
  <div class="fgroup narrow">
    <label class="flabel" for="s-aff">Affinity bonus</label>
    <input id="s-aff" type="number" value="0" step="10">
  </div>
  <div class="fgroup">
    <label class="flabel">Options</label>
    <div class="checkrow" id="s-opts"></div>
  </div>
  <button type="button" id="s-go" class="linkbtn">suggest sets</button>
</section>

<!-- A driftstone skill you already hold changes the answer a lot: one Ice
     Attack gem on Barioth Vambraces was worth +8% on a Charge Blade, because it
     let Ice Attack reach 5 in two pieces instead of three. So this is a real
     input, not a refinement. -->
<section class="filters own">
  <div class="fgroup grow">
    <label class="flabel" for="s-own">Driftstone skills you already have &mdash; one per line, <code>Piece = Skill</code></label>
    <textarea id="s-own" rows="4" spellcheck="false"
      placeholder="Barioth Vambraces = Ice Attack&#10;Lunagaron Mail = Ice Attack"></textarea>
    <p class="hint" id="s-own-msg"></p>
  </div>
</section>

<p class="count" id="s-status">Pick a weapon, then press suggest.</p>
<section id="s-out"></section>

<section class="notes" id="s-notes"></section>

<script id="data" type="application/json"><?php echo $json; ?></script>
<script src="<?php echo parentAsset('suggest-engine.js'); ?>"></script>
<script src="<?php echo parentAsset('suggest-search.js'); ?>"></script>
<script src="<?php echo asset('suggest.js'); ?>"></script>
</body>
</html>
