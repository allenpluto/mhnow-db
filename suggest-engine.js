/**
 * Armour set suggester.
 *
 *   node suggest-engine.js "Squawkscythe"
 *   node suggest-engine.js "Squawkscythe" --gems          assume ideal driftgems
 *   node suggest-engine.js "Squawkscythe" --atk 80 --ele 80 --aff 30   style customisation
 *   node suggest-engine.js "Squawkscythe" --lock TORSO=Vangis Coil     force a slot
 *   node suggest-engine.js "Squawkscythe" --top 8
 *
 * HOW IT SEARCHES
 * 76 x 71 x 71 x 73 x 72 is 2.01 billion sets, but damage depends on skill
 * TOTALS, never on which piece supplied them. Collapsing each slot to its
 * distinct skill bundles gives 24-28 per slot, and dropping bundles that
 * another bundle beats on every skill leaves 17-21. That is about 2.1 million
 * combinations â€” small enough to evaluate every one, so the result is the
 * optimum rather than a good guess.
 *
 * Pareto pruning assumes more of a skill is never worse. Critical Ferocity
 * breaks that (it REDUCES affinity), so it is excluded from the domination test
 * and its bundles always survive to be scored properly.
 *
 * WHAT IT CANNOT KNOW
 * Of the 126 skills that appear on armour, about 20 carry a number this can use
 * directly. The rest are conditional â€” uptime after a roar, health thresholds,
 * consecutive hits â€” so they are priced by the rules in RULES below, which are
 * assumptions, not data. Anything absent from RULES scores zero and is reported
 * as ignored, so a set is never recommended on the strength of a skill that was
 * silently guessed at.
 */

/*
 * Loads both in Node (require) and in the browser (<script>). The damage model
 * has had several subtle faults already â€” uniform gems, unobtainable gems, a
 * missing Raw Power â€” so the website runs this exact file rather than a second
 * copy of the same arithmetic.
 *
 * No file or network access here: callers supply the data.
 */

'use strict';

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SuggestEngine = factory();
}(typeof self !== 'undefined' ? self : this, function () {

// ---------------------------------------------------------------- assumptions
const ASSUME = {
  // 60% is the AVERAGE health over a hunt, not a constant. That distinction
  // matters: the Vital family scales with health continuously, so the average is
  // the right input for it, while the threshold skills either fire or do not.
  hpFraction: 0.60,
  baseHp: 100,             // before Health Boost
  // Valor fires once per hunt, on the first roar, and lasts the rest of it. 60%
  // therefore means the first roar lands 40% of the way in. That is the
  // pessimistic reading: a longer fight pushes the figure up, never down, so
  // this understates Valor rather than flattering it.
  valorUptime: 0.60,

  // Set by the user rather than measured â€” none of these can be read off
  // anything, and the earlier figures were my guesses. They were deliberately
  // lowered: a weak point is not always available, and a buff with a short
  // window is not up as often as it feels.
  weakPointUptime: 0.70,   // Weakness Exploit only applies on a weak point
  burstUptime: 0.35,
  offensiveGuardUptime: 0.00,   // zero unless you actually guard

  /* Elemental Release is not a free-floating uptime. The skill gives element
   * +100% for a stated 20 seconds after each Special Skill, so the uptime is
   * 20s times how many Specials a hunt yields, over its length — and the
   * Special count is now MEASURED rather than guessed.
   *
   * Two training-dummy recordings, attacking without pause:
   *   Charge Blade, attack 1450    39.1s and 40.9s between Specials
   *   Insect Glaive, attack 1155   42.0s and 33.3s
   * Two weapons 26% apart on attack and TWICE apart on hit rate (1.2 against
   * 2.5 hits a second) refilled in near enough the same wall-clock time, so
   * the gauge is filling on time spent attacking rather than on damage dealt
   * or hits landed. About 38 seconds of uninterrupted attacking per Special.
   *
   * One real hunt with the same glaive: Special fired at 6.9s, gauge back to
   * 67% by 41.4s, so a full refill would have taken 51.6s — about a third
   * longer than the dummy, which is the price of not being able to attack
   * continuously. That stretch is one fight by one player, so it is the
   * softest number here.
   */
  specialSeconds: 20,            // the skill's own stated duration
  specialRefillSeconds: 52,      // measured in a real fight
  openWithSpecial: true,         // you can enter a hunt on a full gauge

  // Threshold skills. An average of 60% health means full health and sub-29%
  // health are both occasional, so these are weighted at a tenth of nominal
  // rather than being deleted or taken at face value.
  peakPerformanceUptime: 0.10,  // needs FULL health
  heroicsUptime: 0.10,          // needs health at 29% or lower

  // How long the fight lasts. Two skills key off the clock rather than off
  // anything you do, so this is a real input: a standard hunt is 75 seconds
  // (Latent Power's two stated conditions, 47 seconds of combat and the last
  // 28 seconds, are the same moment only if the hunt is 75), while a base
  // defence runs about 2.5 minutes.
  huntSeconds: 75,

  // Latent Power starts at roughly 47 seconds of combat and holds to the end,
  // so its uptime follows from the hunt length rather than being guessed.
  // Attacking hard brings it forward, so this is a floor.
  latentPowerStart: 47,

  // --- the status path ----------------------------------------------------
  // A status weapon's buildup is not damage, but it drives skills that are.
  //
  // Base chance that a hit inflicts buildup, with no Status Sneak Attack or
  // hitting from the front. Measured.
  statusProcBase: 0.33,

  // Poison runs for a 10-second window per application, and players average
  // 1 to 2 applications in a 75-second hunt â€” thresholds rise after each proc,
  // so uptime cannot approach 100%. 1.5 x 10 / 75 is 20%, not the 50% first
  // assumed here. Both the proc count and the hunt length scale together, so
  // the share stays roughly constant on a longer fight.
  poisonTickSeconds: 10,
  poisonProcsPer75s: 1.5,

  // Paralysis is far shorter than poison: about 4 seconds, or up to 7 on some
  // elders. Thresholds rise after each proc the same way, so the same 1.5
  // applications per hunt is assumed. 1.5 x 4 / 75 is 8%.
  paralysisTickSeconds: 4,
  paralysisProcsPer75s: 1.5,
  // A paralysed monster takes 10% more damage regardless of any skill, so this
  // applies to every paralysis weapon, not only ones carrying the Exploit.
  paralysisBaseBonus: 0.10,

  // Share of hits landed from behind. Deliberately NOT tied to the weak-point
  // figure: a weak point can be at the back, so the two overlap rather than
  // competing, and binding them would wrongly make Weakness Exploit look wasted
  // on a player who fights from behind.
  behindRate: 0.80,

  // Blast stacks do not arrive evenly. Each threshold is about 30% harder than
  // the last, so solo procs come progressively later and the final one lands so
  // near the end that it barely contributes. In a group the picture inverts:
  // other players' procs land stacks almost immediately and the cap is held for
  // most of the fight.
  blastSoloProcs: 5,
  blastThresholdGrowth: 1.3,
  blastGroupEarlyStacks: 4,     // from other players, almost at once
  blastGroupCapShare: 0.75,     // share of a long fight spent at the 10 cap
  multiplayer: false,
};

// Worth as a fraction of the set's damage, for skills damage cannot price.
// These are the user's own exchange rates â€” Power Prolonger and Quick Work at
// 15% for their max level, Lock On a flat 10% â€” not anything derived from data.
const UTILITY = {
  'Power Prolonger': { 1: 0.05, 2: 0.10, 3: 0.15 },
  'Quick Work': { 1: 0.05, 2: 0.10, 3: 0.15 },
  'Lock On': { 1: 0.10 },

  // Rude Awakener multiplies the FIRST attack on a sleeping monster by 1.3,
  // 1.6 or 2.0, on top of the 2.0 that waking a monster already gives â€” so up
  // to 4.0 on one hit. Averaging a single hit across a whole hunt would be
  // dishonest arithmetic, so it is scored as utility instead.
  //
  // THE RATE BELOW IS A GUESS. The multipliers are measured; what one boosted
  // hit is worth as a fraction of a hunt's damage is not.
  'Rude Awakener': { 1: 0.05, 2: 0.10, 3: 0.15 },

  // Ranged handling. The anchors are the user's — Focus 20% at Lv5, the rest
  // 15% at Lv3 — and Focus keeps the shape of its own in-game ladder
  // (5/10/15/20/30% charge time) scaled to that anchor, rather than being
  // flattened to a straight line.
  Focus: { 1: 0.033, 2: 0.067, 3: 0.100, 4: 0.133, 5: 0.200 },
  Ballistics: { 1: 0.05, 2: 0.10, 3: 0.15 },
  // Neither handling skill is a flat percentage — see handlingTable(), which
  // works each one out from the weapon's own magazines against measured tier
  // timings. Both can be worth nothing at all on a gun whose rounds the skill
  // cannot move a band, and a great deal on one where it can. The entries here
  // are only the fallback for a weapon whose rounds are not known.
  'Recoil Down': { 1: 0.10, 2: 0.20, 3: 0.28 },
  'Reload Speed': { 1: 0.05, 2: 0.10, 3: 0.15 },

  // Refills ammo on an evade, which covers much of what Reload Speed does —
  // so unlike Reload Speed it stays useful on a style-selectable bowgun, where
  // sliding and guard reload have already taken that job. Anchored to the same
  // 15% as Reload Speed at its own max of 5; that anchor is assumed.
  'Evading Reload': { 1: 0.04, 2: 0.07, 3: 0.10, 4: 0.13, 5: 0.15 },

  // A 10/20/30% chance a shot does not consume ammo, so a magazine of n yields
  // n/(1-p) shots out of one reload. Worked out per weapon by handlingTable()
  // off the same measured cycle as the two handling skills, since what the
  // skill is really worth is one fewer reload — this entry is the fallback.
  'Spare Shot': { 1: 0.03, 2: 0.06, 3: 0.09 },
};

// Utility skills that only apply to a weapon of a given element. Rude Awakener
// does nothing without a monster to put to sleep.
const UTILITY_ELEMENT = {
  'Rude Awakener': ['Sleep'],
};

/**
 * Conditions too involved for the type and element tables above.
 *
 * Ranged weapons changed with style selection, so which skills matter depends
 * on the weapon's style as well as what it is. A style-selectable status bow is
 * played with dodgebolt rather than charged shots, so the charging skills stop
 * earning their slot and it wants the status build instead.
 */
const UTILITY_WHEN = {
  // Charging skills: every bow shot is charged, EXCEPT on a style-selectable
  // status bow, which is not played that way.
  Focus: (w) => w.category === 'Bow' && !(w.styleSelectable && isStatus(w)),
  // Optimal firing distance. On a bow it always matters, however it is played.
  // On a bowgun only normal, piercing and spread ammo benefit, so it is worth a
  // slot only when the weapon actually carries one of those.
  Ballistics: (w) => w.category === 'Bow' ||
    (RANGED_GUNS.indexOf(w.category) >= 0 &&
     BALLISTICS_AMMO.some((t) => (w.ammo || []).indexOf(t) >= 0)),
  // Bowgun handling. Style-selectable bowguns are left out pending their rules.
  // Wyvern ammo gains nothing from reduced recoil, so a bowgun whose only ammo
  // is wyvern has no use for the skill even when its style leaves recoil as the
  // remaining job. It still takes Artillery, which does cover wyvern.
  'Recoil Down': (w) => gunHandling(w).recoil &&
    (w.ammo || []).some((t) => RECOIL_EXEMPT_AMMO.indexOf(t) < 0),
  'Reload Speed': (w) => gunHandling(w).reload,
  // The skill names gunlance and charge blade too, and it survives style
  // selection, so it is offered on every weapon that can use it.
  'Evading Reload': (w) => EVADE_RELOAD_TYPES.indexOf(w.category) >= 0,
  // Bowguns only, by its own text, and worthless on a one-round magazine where
  // every shot reloads anyway.
  'Spare Shot': (w) => RANGED_GUNS.indexOf(w.category) >= 0,
};
const EVADE_RELOAD_TYPES = ['Light Bowgun', 'Heavy Bowgun', 'Gunlance', 'Charge Blade'];
// Only these ammo families gain from a longer optimal firing distance.
const BALLISTICS_AMMO = ['NORMAL', 'PIERCING', 'SPREAD'];
// Ammo that gains nothing from reduced recoil.
const RECOIL_EXEMPT_AMMO = ['WYVERN'];

/* ------------------------------------------------ recoil and reload ----
 * MEASURED, 2026-11-09, from seven screen recordings of a training dummy.
 *
 * Method. Each recording was resampled to a constant 20fps — the device
 * records at a variable rate, so frame counts cannot be trusted for timing —
 * and the "n HIT" counter in the Total Damage panel was decoded frame by
 * frame, a change in that region being the counter moving. That times every
 * hit to 0.05s. A hit is not a shot, since pierce and sticky rounds land more
 * than once, but within a shot the hits are 0.10s apart and between shots
 * 0.6-2.1s, so the two never run together.
 *
 * Four of the recordings are the same weapon, Laguna Blitz, fired the same
 * way at Recoil Down and Reload Speed 0, 1, 2 and 3, with a weapon-screen
 * screenshot taken at each level. The screenshot matters: the weapon screen
 * shows the tier AFTER the skills, so each recording says both what the game
 * claimed and what it actually did.
 *
 * THE CENTRAL FINDING. The two agree exactly. Laguna Blitz's pierce magazine
 * read High at Recoil Down 1 and fired at 1.05s, the same as at Recoil Down
 * 0; it read Average at Lv2 and fired at 0.87s, the same as a magazine that
 * is natively Average; it read Low at Lv3 and fired at 0.60s. Its sticky
 * magazine dropped from Very high to High at Lv3 and went from 2.05s to
 * 1.08s. So the displayed tier is the whole story for timing: there is
 * nothing hidden inside a tier, and a skill is worth exactly the tiers it
 * moves you down.
 */
const SHOT_SECONDS = [0.603, 0.862, 1.063, 2.056];   // Low, Average, High, Very high
const RELOAD_SECONDS = [1.90, 2.85, 3.30, 4.83];     // Fast, Normal, Slow, Very slow

/*
 * Shot interval, pooled across every recording by the tier on screen:
 *
 *   Low        0.603s   18 gaps, 3 weapons
 *   Average    0.862s   17 gaps, 3 weapons
 *   High       1.063s   19 gaps, 4 weapons
 *   Very high  2.056s    9 gaps, 1 weapon
 *
 * Very high is nearly double High rather than one more even step.
 *
 * Reload is the gap from the last shot of one magazine to the first shot of
 * the next, since a bowgun reloads by switching magazines. Only Laguna Blitz
 * is used, because all four clips are one weapon fired one way, so whatever
 * fixed cost the switch carries is constant throughout:
 *
 *   Fast       1.90s   1 reading
 *   Normal     2.85s   1 reading
 *   Slow       3.30s   3 readings, 3.40 / 3.20 / 3.30
 *   Very slow  4.83s   3 readings, 4.90 / 5.00 / 4.60
 *
 * Rex Fusillade, a different weapon, puts Slow 0.45s above Normal; so does
 * Laguna Blitz, to the millisecond. The absolute level does carry a per-weapon
 * offset — Rex sits about 0.35s above Laguna on both tiers — so these figures
 * are Laguna's, and another weapon's reloads may run a little longer or
 * shorter together.
 *
 * The tier shown against a magazine is the cost of switching INTO it, not out
 * of it, which Dual Threat settles: its long gap is the one going into its
 * very-slow pierce magazine.
 */

/*
 * How the game turns a stat into a word, and what the skills do to it.
 *
 * The data holds five recoil values and five reload values, but the weapon
 * screen has only ever shown four words for each. Quickcaster carries the two
 * that had never been seen — RECOIL_LARGE_2 and RELOAD_LARGE_2 — and shows
 * them as "High" and "Slow", the same words as plain LARGE. So two values
 * share a band.
 *
 * Within a band the skills still tell them apart, which is how the positions
 * below are pinned. Laguna Blitz is Average/High/Very high on recoil, and
 * Recoil Down moved them like this:
 *
 *                 Lv1          Lv2          Lv3
 *   Average       Low          Low          Low
 *   High          High         Average      Low
 *   Very high     Very high    Very high    High
 *
 * Reload Speed moved the reload words in exactly the same pattern. A skill
 * that simply dropped one band per level cannot do that — High would have
 * fallen to Average at Lv1. What fits all twelve cells, and the twelve for
 * reload too, is a finer ladder where the skill subtracts its own level:
 * Average sits one step up, High spans two steps, and Very high sits three
 * steps above the top of High.
 *
 * LARGE_2 therefore sits at the BOTTOM of the High band and LARGE at the top,
 * despite the name. That is forced: Laguna's High magazine is LARGE and still
 * read High after one level, so there has to be another step below it inside
 * the same band, and LARGE_2 is the only candidate the data offers. The
 * LARGE_2 row of the table is the one part of this that is derived rather
 * than watched.
 */
const STEP = {
  RECOIL_SMALL: 0, RECOIL_MEDIUM: 1, RECOIL_LARGE_2: 2, RECOIL_LARGE: 3,
  RECOIL_EXTRA_LARGE: 6,
  RELOAD_SMALL: 0, RELOAD_MEDIUM: 1, RELOAD_LARGE_2: 2, RELOAD_LARGE: 3,
  RELOAD_EXTRA_LARGE: 6,
};
// Which band each step falls in: 0 Low/Fast, 1 Average/Normal, 2 High/Slow,
// 3 Very high/Very slow.
const BAND_OF_STEP = [0, 1, 2, 2, 3, 3, 3];

/** The band a stat ends up in once a handling skill has taken its levels off. */
function bandAfter(tier, levels) {
  const step = STEP[tier];
  if (step === undefined) return null;
  return BAND_OF_STEP[Math.max(0, step - (levels || 0))];
}

/* --------------------------------------------------------------- styles ----
 * A style does not merely decide which handling skill is still wanted. It
 * changes the firing itself, and by much more than any skill does.
 *
 * STEPPING SHOT replaces the shot with a dodge, and the cadence is the dodge's,
 * not the ammo's. Anja Buster on stepping shot, one recording: its sticky
 * rounds are natively Very high, 2.056s, and fired at 0.975s; its flaming
 * rounds are natively Average, 0.862s, and fired at about 1.00s. Two magazines
 * three tiers apart landing within 0.03s of each other is the whole finding -
 * the interval is FIXED, so the style is an enormous gain on bad recoil and a
 * real loss on good recoil, and Recoil Down is worth nothing under it.
 *
 * CROUCHING SHOT accelerates while firing and carries extra rounds. The
 * recording shows a burst of twelve at 0.60 0.55 0.55 0.45 0.35 0.35 0.30
 * 0.30 0.35 0.35 0.35 and a later burst of eight at a flat 0.30. Those are
 * the pierce magazine, 8 rounds plus 4, and the normal magazine, 4 plus 4 —
 * not one magazine firing past its capacity, as first read here. The extra
 * rounds per ammo family are the game's own published rule, not a measurement.
 *
 * The cadence does not start from the ammo's own interval: pierce is natively
 * Average at 0.862s and opened at 0.60s. It opens near 0.60 whatever the
 * rounds and falls to about 0.30, and the second burst running flat at 0.30
 * says the acceleration survives a magazine change while firing continues.
 * The ramp below is taken from the twelve-shot burst, which is the one that
 * clearly started cold, so it understates continuous fire.
 *
 * The cadence is also untouched by Recoil Down, which was worth checking
 * rather than assuming. The same weapon and the same twelve-round pierce
 * magazine, with Recoil Down 3, went 0.60 0.55 0.55 0.40 0.40 0.35 0.30 0.35
 * 0.35 0.30 0.35 against 0.60 0.55 0.55 0.45 0.35 0.35 0.30 0.30 0.35 0.35
 * 0.35 without it — 4.50s both times, to the hundredth. The skill was
 * certainly doing something, since the weapon screen had moved that magazine
 * from Average to Low; crouching shot simply does not care.
 *
 * SLIDING RELOAD changes magazine on a dodge, and will do it on a magazine
 * that is not empty. Anja Buster, one shot then one slide, repeated: gaps
 * between consecutive shots of 2.05 2.50 2.90 2.50 3.00 2.35, mean 2.52s.
 *
 * Do NOT try to take a shot out of that. Subtracting each magazine's own
 * steady-fire interval gives 1.79s from the flaming gaps and 0.39s from the
 * sticky ones — a four-fold disagreement, so the two are not additive. The
 * slide cancels the shot's recovery instead of queueing behind it, which is
 * why sliding out of a Very high magazine costs no more than sliding out of
 * an Average one.
 *
 * No subtraction is needed anyway. The gap measured here is last shot to the
 * next magazine's first shot, which is exactly the quantity the reload ladder
 * holds, so 2.52s goes in as it stands and is directly comparable: a little
 * quicker than a Normal reload and far quicker than a Very slow one. It does
 * carry more of the player than the ladder does, since each cycle needs a
 * deliberate slide and re-aim rather than firing straight on; the fastest of
 * the six, 2.05s, is the least contaminated and is the floor.
 *
 * This style will always read low here, and that is the model's limit rather
 * than the number's. Its point is that a dodge is safe where a reload is not,
 * and nothing in this engine knows what being hit costs. An empty magazine is
 * also a trap under it — hold the press through empty and the hunter plays a
 * long standing reload that loads nothing — so it is meant to be slid out of
 * early, carrying fewer rounds per cycle than modelled here.
 *
 * GUARD RELOAD changes magazine without firing, and loads only HALF the
 * rounds — seen directly, a hold-and-slide putting 4 of 8 pierce rounds up.
 * On an empty magazine it reloads on a single press, and Dual Threat did that
 * in 2.05s from its last shot to the next, against the 4.83s its pierce
 * magazine costs unaided. So it is a Fast reload on a Very slow magazine, at
 * the price of half the capacity.
 */
const DODGE_SECONDS = 0.975;      // measured; what an evade costs
const SLIDE_RELOAD_SECONDS = 2.52;   // measured, same basis as the ladder
const GUARD_RELOAD_SECONDS = 2.05;   // measured directly
const CROUCH_OPEN = 0.60;         // measured, whatever the ammo
const CROUCH_FLOOR = 0.30;        // measured
const CROUCH_RAMP = 6;            // shots to get there, from one cold burst
// Rounds crouching shot adds to a magazine, by ammo family. The game's rule.
const CROUCH_BONUS = {
  NORMAL: 4, PIERCING: 4, SPREAD: 4, SLICING: 2, STICKY: 2, CLUSTER: 1, WYVERN: 0,
};

/** How many rounds a magazine actually holds under a style. */
function magazineSize(round, style) {
  const cap = round.capacity || 1;
  const name = style && style.name;
  if (name === 'crouching shot') {
    const bonus = CROUCH_BONUS[round.type];
    return cap + (bonus === undefined ? 4 : bonus);
  }
  // Guard reload trades capacity for a reload it can take at any time.
  if (name === 'guard reload') return Math.max(1, Math.round(cap / 2));
  return cap;
}

/** The average interval between shots over one magazine, under a style. */
function shotSeconds(round, style, recoilLevels) {
  const native = SHOT_SECONDS[bandAfter(round.recoil, recoilLevels)];
  const name = style && style.name;
  if (name === 'stepping shot') return DODGE_SECONDS;
  if (name === 'crouching shot') {
    const gaps = Math.max(1, magazineSize(round, style) - 1);
    let sum = 0;
    for (let i = 0; i < gaps; i++) {
      const f = Math.min(1, i / CROUCH_RAMP);
      sum += CROUCH_OPEN + (CROUCH_FLOOR - CROUCH_OPEN) * f;
    }
    return sum / gaps;
  }
  return native;
}

/** What it costs to get the next magazine up, under a style. */
function reloadSeconds(round, style, reloadLevels) {
  const name = style && style.name;
  // Both of these swap the magazine on a movement rather than a reload, so the
  // reload tier stops mattering whatever it was — which is why neither style
  // wants Reload Speed. Both figures are measured.
  if (name === 'sliding reload') return SLIDE_RELOAD_SECONDS;
  if (name === 'guard reload') return GUARD_RELOAD_SECONDS;
  return RELOAD_SECONDS[bandAfter(round.reload, reloadLevels)];
}

/**
 * How much faster or slower a style fires than no style at all, as a ratio of
 * damage per second.
 *
 * This is what decides which style a bowgun should be played on, and until now
 * the suggester had nothing to decide it with — it only knew which handling
 * skill each style left wanted.
 */
function styleRate(w) {
  if (!w.style || !w.rounds || !w.rounds.length) return 1;
  const seen = {};
  const rounds = w.rounds.filter((r) => {
    if (seen[r.type] || STEP[r.recoil] === undefined || STEP[r.reload] === undefined) return false;
    seen[r.type] = 1;
    return true;
  });
  if (!rounds.length) return 1;
  let num = 0, den = 0;
  rounds.forEach((r) => {
    const share = ammoShare(w, { types: [r.type] }) || 1 / rounds.length;
    const cap = r.capacity || 1;
    const styledCap = magazineSize(r, w.style);
    const plain = (cap - 1) * shotSeconds(r, null, 0) + reloadSeconds(r, null, 0);
    const styled = (styledCap - 1) * shotSeconds(r, w.style, 0) +
      reloadSeconds(r, w.style, 0);
    num += share * (styledCap / styled);
    den += share * (cap / plain);
  });
  return den ? num / den : 1;
}

/**
 * What a handling skill is worth on one weapon, as a fraction of its damage.
 *
 * A magazine of n rounds has n-1 gaps between its shots and then one gap to
 * the next magazine's first shot, so a cycle is (capacity - 1) shot intervals
 * plus a reload. Recoil Down shortens the first part, Reload Speed the second,
 * and the gain is the ratio of the two cycles.
 *
 * Rounds the skill does nothing for are left out, and the rest are weighted by
 * how much of the hunt each is actually fired for, so sliding reload's 90% of
 * shots on normal ammo counts as such.
 */
function handlingTable(w, which) {
  const seen = {};
  const rounds = (w.rounds || []).filter((r) => {
    if (seen[r.type] || STEP[r.recoil] === undefined || STEP[r.reload] === undefined) return false;
    seen[r.type] = 1;
    return which !== 'recoil' || RECOIL_EXEMPT_AMMO.indexOf(r.type) < 0;
  });
  if (!rounds.length) return null;
  const weight = rounds.map((r) => ammoShare(w, { types: [r.type] }) || 1 / rounds.length);
  const span = weight.reduce((a, b) => a + b, 0) || 1;

  const out = {};
  for (let lv = 1; lv <= 3; lv++) {
    let sum = 0;
    rounds.forEach((r, i) => {
      const cap = magazineSize(r, w.style);
      const shot0 = shotSeconds(r, w.style, 0);
      const load0 = reloadSeconds(r, w.style, 0);
      const before = (cap - 1) * shot0 + load0;

      let after, shots = cap;
      if (which === 'spare') {
        // A chance not to consume the round stretches the magazine, so more
        // shots come out of one reload rather than each shot coming sooner.
        shots = cap / (1 - SPARE_SHOT_CHANCE[lv]);
        after = (shots - 1) * shot0 + load0;
      } else {
        const shot1 = which === 'recoil' ? shotSeconds(r, w.style, lv) : shot0;
        const load1 = which === 'reload' ? reloadSeconds(r, w.style, lv) : load0;
        after = (cap - 1) * shot1 + load1;
      }
      sum += weight[i] * ((shots / after) / (cap / before) - 1);
    });
    out[lv] = sum / span;
  }
  return out;
}
// The chance a shot does not consume ammo, from the skill's own text.
const SPARE_SHOT_CHANCE = { 1: 0.10, 2: 0.20, 3: 0.30 };


/**
 * The utility ladder for one skill on one weapon.
 *
 * Most skills are worth the same wherever they go, so this hands back the flat
 * table. The two handling skills are not among them: what they are worth comes
 * out of the weapon's own magazines and is measured rather than assumed, so
 * the flat entry is only a fallback for a weapon whose rounds are not known.
 */
function utilityTable(name, w) {
  if (name === 'Recoil Down') return handlingTable(w, 'recoil') || UTILITY[name];
  if (name === 'Reload Speed') return handlingTable(w, 'reload') || UTILITY[name];
  if (name === 'Spare Shot') return handlingTable(w, 'spare') || UTILITY[name];
  return UTILITY[name];
}

/**
 * Which handling skill a bowgun still needs, given its style.
 *
 * Before style selection a bowgun wants both. A style does one of the two jobs
 * and leaves the other, and which style you take follows from the ammo:
 *
 *   LBG, normal ammo      sliding reload   -> keeps Recoil Down
 *   LBG, otherwise        stepping shot    -> keeps Reload Speed
 *   HBG, spread/wyvern    guard reload     -> keeps Recoil Down
 *   HBG, otherwise        crouching shot   -> keeps Reload Speed
 *
 * Consistent throughout: sliding reload and guard reload cover reloading, so
 * Recoil Down is what remains; stepping shot and crouching shot cover recoil,
 * so Reload Speed is what remains.
 */
function gunHandling(w) {
  if (w.style) return w.style;          // a variant has already decided
  const none = { recoil: false, reload: false };
  if (RANGED_GUNS.indexOf(w.category) < 0) return none;
  if (!w.styleSelectable) return { recoil: true, reload: true };

  const has = (t) => (w.ammo || []).indexOf(t) >= 0;
  if (w.category === 'Light Bowgun') {
    return has('NORMAL') ? { recoil: true, reload: false } : { recoil: false, reload: true };
  }
  return (has('SPREAD') || has('WYVERN'))
    ? { recoil: true, reload: false }
    : { recoil: false, reload: true };
}

/**
 * The distinct builds a weapon can be played as.
 *
 * A bowgun usually carries two or three magazines, so a style-selectable one
 * genuinely fits more than one style and they are different builds, not one
 * build scored differently: an LBG with normal and slicing can be played on
 * sliding reload around its normal ammo, or on stepping shot around the
 * slicing. Each wants a different handling skill, a different ammo boost and a
 * different share of shots, so each is searched separately and the best wins.
 *
 * Everything else has exactly one variant.
 */
function styleVariants(weapon) {
  const one = [{ label: null, weapon: weapon }];
  if (RANGED_GUNS.indexOf(weapon.category) < 0 || !weapon.styleSelectable) return one;

  const has = (t) => (weapon.ammo || []).indexOf(t) >= 0;
  const make = (label, style) => ({
    label: label,
    weapon: Object.assign({}, weapon, { style: style }),
  });

  const out = [];
  if (weapon.category === 'Light Bowgun') {
    // Sliding reload is only worth considering when there is normal ammo to
    // build around; it is the style that makes normal ammo dominate the hunt.
    if (has('NORMAL')) {
      out.push(make('sliding reload, around normal ammo',
        { name: 'sliding reload', recoil: true, reload: false, primary: 'NORMAL' }));
    }
    out.push(make('stepping shot, even magazine use',
      { name: 'stepping shot', recoil: false, reload: true, primary: null }));
  } else {
    if (has('SPREAD') || has('WYVERN')) {
      out.push(make('guard reload',
        { name: 'guard reload', recoil: true, reload: false, primary: null }));
    }
    out.push(make('crouching shot',
      { name: 'crouching shot', recoil: false, reload: true, primary: null }));
  }
  return out.length ? out : one;
}
const RANGED_GUNS = ['Light Bowgun', 'Heavy Bowgun'];
function isStatus(w) { return STATUS.indexOf(w.element) >= 0; }

/* ------------------------------------------------- the three stat slots ----
 * Style customisation gives a weapon three slots, each one of attack +100,
 * element +100 or affinity +10%. They are off by default, because a weapon
 * that has not been customised does not have them, and because the suggester
 * is usually asked what armour to wear rather than how to spend them.
 *
 * Which is best is not a property of the weapon. Affinity is worth more the
 * more Critical Boost and Critical Element the set carries, element is worth
 * more behind a high affinity, and attack is steady — so the slots have to be
 * chosen against the set, not before it. They are therefore searched with the
 * set rather than fixed first, and the winning split is reported.
 *
 * TWO LIMITS. On a status weapon the element slot gives +50 to the buildup
 * value rather than +100 element, and this engine prices status by how often
 * it procs rather than by the buildup number, so it cannot put a figure on
 * that slot. The option is left out there and the choice falls between attack
 * and affinity. And maxing style customisation also grants a flat attack and
 * element bonus on top of these three, which differs per weapon — Squawkscythe
 * gets +80/+80 where Skullwhistle gets +100/+40 — so it is not derivable and
 * stays with --atk and --ele.
 */
const STAT_SLOTS = 3;
const STAT_SLOT_ATTACK = 100;
const STAT_SLOT_ELEMENT = 100;
const STAT_SLOT_AFFINITY = 10;
const NO_SLOTS = [{ atk: 0, ele: 0, aff: 0, label: null }];

/** Every way the three slots can be split, for this weapon. */
function statSlotChoices(w) {
  if (!w.statSlots || !w.styleSelectable) return null;
  const kinds = [
    ['attack', STAT_SLOT_ATTACK, 0, 0],
    ['affinity', 0, 0, STAT_SLOT_AFFINITY],
  ];
  if (ELEMENTS.indexOf(w.element) >= 0) kinds.push(['element', 0, STAT_SLOT_ELEMENT, 0]);

  const out = [];
  const n = kinds.length;
  // Combinations with repetition: the slots are interchangeable, so only the
  // counts matter and i <= j <= k avoids scoring the same split six times.
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      for (let k = j; k < n; k++) {
        const pick = [kinds[i], kinds[j], kinds[k]];
        const count = {};
        let atk = 0, ele = 0, aff = 0;
        pick.forEach((p) => {
          atk += p[1]; ele += p[2]; aff += p[3];
          count[p[0]] = (count[p[0]] || 0) + 1;
        });
        const label = ['attack', 'element', 'affinity']
          .filter((kind) => count[kind])
          .map((kind) => kind + ' +' +
            (kind === 'attack' ? STAT_SLOT_ATTACK * count[kind]
              : kind === 'element' ? STAT_SLOT_ELEMENT * count[kind]
                : STAT_SLOT_AFFINITY * count[kind] + '%'))
          .join(', ');
        out.push({ atk: atk, ele: ele, aff: aff, label: label });
      }
    }
  }
  return out;
}

/**
 * How much of the hunt Elemental Release is up for.
 *
 * The skill reads "elemental attack power increases by 100% for 20 secs. after
 * activating a Special Skill", so this is 20s per Special over the hunt, and
 * the Special count comes from the measured refill — see ASSUME. It works out
 * at about half a hunt whatever the hunt's length: 50% over 40 seconds, 53%
 * over 75, 40% over 150. All of those are well above the 35% that used to be
 * assumed here.
 *
 * NERGIGANTE AVIDITY BREAKS THAT. Its own text is "Damage increased by 20%,
 * but Special Gauge will no longer fill when attacking", so a set carrying it
 * gets no Specials from fighting at all — only the ones the hunt hands over:
 * the one you can open with if you enter on a full gauge, and the one Valor
 * grants outright on the first roar. Two Specials in a 75s hunt is 53%; one is
 * 27%. The two skills were priced independently before this, so the suggester
 * was handing a set Avidity's +20% and a full Elemental Release at the same
 * time, which the game does not allow.
 *
 * Still missing: Evasive Concentration, Guard and Parry Concentration and
 * Special Partbreaker all put gauge back without attacking, so they would
 * survive Avidity too. None of them is priced by this engine yet, and how
 * often each fires is unknown, so none is counted.
 */
function elemReleaseUptime(avidityLevel, valorLevel) {
  let specials = ASSUME.openWithSpecial ? 1 : 0;
  // Valor's roar hands over a full gauge outright, so it survives Avidity and
  // adds a Special that would otherwise have had to be earned.
  if (valorLevel) specials += 1;
  if (!avidityLevel) {
    specials += Math.floor(ASSUME.huntSeconds / ASSUME.specialRefillSeconds);
  }
  if (!specials) return 0;
  return Math.min(1, ASSUME.specialSeconds * specials / ASSUME.huntSeconds);
}

/** One hit's damage before the flat multipliers, for given stats. */
function critDamage(atk, ele, aff, m, ce, cfLevel) {
  const c = (aff > 100 ? 100 : aff < -100 ? -100 : aff) / 100;
  if (c >= 0) return atk * (1 + c * (m - 1)) + ele * (c * m * ce + (1 - c));
  // Negative final affinity: those hits land at 75%, or at the Critical
  // Ferocity multiplier on the 30% of them that proc it.
  const n = -c;
  const neg = cfLevel ? 0.30 * CFERO_MULT[cfLevel] + 0.70 * 0.75 : 0.75;
  return (atk + ele) * ((1 - n) + n * neg);
}

/** Does this utility skill apply to this weapon at all? */
function utilityApplies(name, w) {
  const scope = UTILITY_SCOPE[name];
  if (scope && scope.indexOf(w.category) < 0) return false;
  const el = UTILITY_ELEMENT[name];
  if (el && el.indexOf(w.element) < 0) return false;
  const when = UTILITY_WHEN[name];
  if (when && !when(w)) return false;
  return true;
}
// Which weapons each utility skill is worth anything on.
const UTILITY_SCOPE = {
  // The game's own text names seven types for Power Prolonger. You listed four;
  // the other three are here at the same weight pending your call.
  'Power Prolonger': ['Dual Blades', 'Long Sword', 'Switch Axe', 'Charge Blade',
    'Hunting Horn', 'Gunlance', 'Insect Glaive'],
  // "sheathing or transforming" â€” Long Sword is your priority, the transforming
  // weapons are included at the same weight pending your call.
  'Quick Work': ['Long Sword', 'Switch Axe', 'Charge Blade'],
  // The skill text itself says "close-range weapon", so this is data, not taste.
  'Lock On': ['Great Sword', 'Long Sword', 'Sword & Shield', 'Dual Blades', 'Hammer',
    'Hunting Horn', 'Lance', 'Gunlance', 'Switch Axe', 'Charge Blade', 'Insect Glaive'],
};

const ELEMENTS = ['Fire', 'Water', 'Thunder', 'Ice', 'Dragon'];
const STATUS = ['Blast', 'Poison', 'Paralysis', 'Sleep'];

// Skills that feed the damage model. Everything else scores zero.
const CEYE = { 1: 10, 2: 15, 3: 20, 4: 30, 5: 40 };
const WEX = { 1: 20, 2: 25, 3: 30, 4: 40, 5: 50 };
const CBOOST = { 0: 1.25, 1: 1.30, 2: 1.35, 3: 1.40, 4: 1.45, 5: 1.50 };
const CELEM = { 0: 1.00, 1: 1.30, 2: 1.40, 3: 1.50, 4: 1.60, 5: 1.80 };
const ATTACK_BOOST = { 1: 50, 2: 100, 3: 150, 4: 200, 5: 300 };
const ADV_ATTACK = { 1: 150, 2: 350 };
const ELEM_ATTACK = { 1: 50, 2: 100, 3: 200, 4: 350, 5: 500 };
const ADV_ELEM = { 1: 200, 2: 400 };
const VITAL = { 1: 2, 2: 4, 3: 8 };
const HEALTH = { 1: 10, 2: 20, 3: 30, 4: 40, 5: 50 };
const VALOR = { 1: 400, 2: 550, 3: 700, 4: 850, 5: 1000 };
const PEAK = { 1: 100, 2: 200, 3: 300, 4: 400, 5: 500 };
const CFERO_AFF = { 1: 10, 2: 15, 3: 20, 4: 25, 5: 30 };
const CFERO_MULT = { 1: 1.50, 2: 1.75, 3: 2.00, 4: 2.25, 5: 2.50 };
const ELEM_RELEASE = { 1: 0.20, 2: 0.40, 3: 0.60, 4: 0.80, 5: 1.00 };
const BURST = { 1: 0.05, 2: 0.10, 3: 0.15, 4: 0.20, 5: 0.30 };
const ADV_BURST = { 1: 0.05, 2: 0.10 };
const LATENT = { 1: 20, 2: 30, 3: 40, 4: 50, 5: 60 };
const OFF_GUARD = { 1: 0.10, 2: 0.15, 3: 0.20, 4: 0.30, 5: 0.40 };
const HEROICS = { 1: 0.10, 2: 0.20, 3: 0.30, 4: 0.40, 5: 0.50 };

// Rising Tide ramps on the clock: measured at +30 attack from 25 seconds and
// another +30 from 50, per level. Averaging both stages over the hunt gives the
// attack it is worth across the whole fight, which is why a long base defence
// is where it earns its place.
const TIDE_PER_LEVEL = 30;
const TIDE_STAGES = [25, 50];
function tideAttack(level, huntSeconds) {
  if (!level) return 0;
  var total = 0;
  for (var i = 0; i < TIDE_STAGES.length; i++) {
    var active = huntSeconds - TIDE_STAGES[i];
    if (active > 0) total += TIDE_PER_LEVEL * level * (active / huntSeconds);
  }
  return total;
}

// --- the status path ---------------------------------------------------
const STATUS_EXPLOIT = {
  Poison: { 1: 0.30, 2: 0.45, 3: 0.60, 4: 0.80, 5: 1.00 },
  Paralysis: { 1: 0.50, 2: 0.75, 3: 1.00, 4: 1.30, 5: 1.60 },
};
const BUILDUP_BOOST = { 1: 0.10, 2: 0.20, 3: 0.30, 4: 0.40, 5: 0.50 };
const SNEAK = { 1: 0.10, 2: 0.15, 3: 0.20, 4: 0.25, 5: 0.30 };
const BLAST_EXPLOIT_ATK = { 1: 30, 2: 60, 3: 90, 4: 120, 5: 150 };
const BLAST_EXPLOIT_CAP = 10;

// Blast Exploit also raises the chance of inflicting buildup, which the attack
// bonus alone missed. Measured: Blast Exploit 5 with Teostra Blastpowder 1
// procced 38 of 50 hits, so 76% against a 33% base — the two together add 43
// points. Splitting that between them is an assumption: Blast Exploit's text
// says "massively" and Blastpowder's says "slightly", so 38 and 5. A reading
// of either skill on its own would separate them properly.
const BLAST_EXPLOIT_PROC = { 1: 0.08, 2: 0.15, 3: 0.23, 4: 0.30, 5: 0.38 };
const BLASTPOWDER_PROC = { 1: 0.05, 2: 0.10, 3: 0.15 };
// Same wording as Blastpowder — slightly / moderately / significantly — so the
// same ladder, for poison instead of blast.
const VENOMIST_PROC = { 1: 0.05, 2: 0.10, 3: 0.15 };

/**
 * Monster skills that multiply a weapon's element value.
 *
 * Fully specified in the data, so no uptime to guess — unlike most of this
 * file. Two apply to ice and stack; the rest are one per element. Their
 * percentages are summed with Elemental Release rather than compounded, which
 * is the conservative reading.
 */
const ELEMENT_SKILLS = {
  Ice: [['Kushala Frostwind', { 1: 0.10, 2: 0.15, 3: 0.25 }],
        ['Velkhana Aegis', { 1: 0.10, 2: 0.15, 3: 0.20 }]],
  Thunder: [['Kirin Flashstorm', { 1: 0.10, 2: 0.15, 3: 0.25 }]],
  Water: [['Namielle Electrowave', { 1: 0.10, 2: 0.15, 3: 0.25 }]],
  Dragon: [['Malzeno Crimsonblood', { 1: 0.10, 2: 0.15, 3: 0.25 }]],
};

/**
 * Charge Master multiplies element on charged attacks. Every bow shot is
 * charged, so on a bow it is a straight element multiplier — and a large one,
 * 70% at Lv5. It is a damage skill, not a handling one.
 *
 * Other weapons charge only some attacks, and this model has no notion of an
 * attack mix, so they are left out rather than guessed at.
 */
const CHARGE_MASTER = { 1: 0.10, 2: 0.25, 3: 0.40, 4: 0.55, 5: 0.70 };

/**
 * Ammo boosts. These are the largest multipliers in the game — Normal/Element
 * Ammo Boost Lv3 is +200% — but each applies to ONE family of ammo, so a
 * bowgun carrying four kinds does not get it on every shot.
 *
 * A skill is only offered when the weapon actually carries matching ammo, which
 * is read from the database. The share of shots that use it cannot be read from
 * anywhere and is the assumption below.
 */
const AMMO_BOOSTS = [
  { skill: 'Normal/Element Ammo Boost', types: ['NORMAL'], levels: { 1: 0.60, 2: 1.20, 3: 2.00 } },
  { skill: 'Slicing Ammo Boost', types: ['SLICING'], levels: { 1: 0.30, 2: 0.60, 3: 1.00 } },
  { skill: 'Artillery', types: ['STICKY', 'WYVERN'],
    levels: { 1: 0.10, 2: 0.15, 3: 0.20, 4: 0.30, 5: 0.40 } },
];

function ammoBoostApplies(boost, w) {
  if (!w.ammo || !w.ammo.length) return false;
  return boost.types.some((t) => w.ammo.indexOf(t) >= 0);
}

/**
 * How much of a boost a weapon actually realises.
 *
 * A boost lifts one family of ammo, and a bowgun firing three kinds spends only
 * about a third of its shots on any one of them — so the effectiveness is one
 * over the number of ammo types it carries, 50% for two and 33% for three.
 * Derived from the weapon rather than assumed, which also means a focused
 * two-ammo bowgun correctly values its boost higher than a versatile one.
 */
function ammoShare(w, boost) {
  if (!w.ammo || !w.ammo.length) return 0;
  const n = w.ammo.length;

  // Sliding reload does not fire evenly: it empties the normal magazine and the
  // others get a shot each before it slides to reload. So normal ammo takes 90%
  // of the time with two magazines and 80% with three, and the rest share what
  // is left — rather than every magazine taking 1/n. Every other style, and
  // every unstyled bowgun, fires evenly.
  const primaryType = w.style && w.style.primary;
  if (primaryType && w.ammo.indexOf(primaryType) >= 0) {
    const primary = n <= 2 ? 0.90 : 0.80;
    if (!boost) return primary;
    const onPrimary = boost.types.indexOf(primaryType) >= 0;
    if (onPrimary) return primary;
    return n > 1 ? (1 - primary) / (n - 1) : 0;
  }

  return 1 / n;
}

// Flat damage on any weapon, at the cost of never filling the Special Gauge by
// attacking. The gain is priced; the cost is not, because Special Skills are
// outside this model entirely. On a build that leans on its Special, this skill
// is worth less than the number here suggests.
const AVIDITY = { 1: 0.10, 2: 0.15, 3: 0.20 };
const STATUS_BUILDUP = { 1: 50, 2: 75, 3: 100, 4: 125, 5: 150 };

/**
 * Chance that a hit inflicts buildup.
 *
 * 33% by default. Status Sneak Attack raises that to a guaranteed 100% at Lv5
 * and is treated as linear in between, but only on hits landed from behind â€”
 * so the average over a hunt is the two cases weighted by how often you get
 * behind the monster.
 */
/**
 * Share of the hunt a monster spends poisoned.
 *
 * Derived rather than assumed: applications times the tick window, over a
 * standard hunt. Note this prices only Poison Exploit's damage multiplier â€”
 * the poison's own damage over time (7-18% of the monster's max HP, depending
 * on its weakness) is damage to the MONSTER'S health pool, not to your hit, so
 * it cannot be folded into a per-hit figure and is not counted here.
 */
function poisonUptime() {
  const up = ASSUME.poisonProcsPer75s * ASSUME.poisonTickSeconds / 75;
  return up > 1 ? 1 : up;
}

/**
 * Average number of Blast Exploit stacks held across a hunt.
 *
 * A stack is worth only the part of the fight it is held for, so what matters
 * is not how many procs land but when.
 *
 * Solo, each threshold is ~30% harder than the last, so the gaps grow
 * geometrically and the last proc lands near the end contributing almost
 * nothing — five procs average about 2.5 stacks, not 5.
 *
 * In a group, other players' procs land several stacks almost immediately and
 * the 10 cap is reached early, so the average is close to the cap.
 */
function blastAverageStacks() {
  if (ASSUME.multiplayer) {
    const ramp = (ASSUME.blastGroupEarlyStacks + BLAST_EXPLOIT_CAP) / 2;
    return BLAST_EXPLOIT_CAP * ASSUME.blastGroupCapShare +
           ramp * (1 - ASSUME.blastGroupCapShare);
  }
  const n = Math.min(ASSUME.blastSoloProcs, BLAST_EXPLOIT_CAP);
  let total = 0;
  for (let i = 0; i < n; i++) total += Math.pow(ASSUME.blastThresholdGrowth, i);
  let elapsed = 0, held = 0;
  for (let i = 0; i < n; i++) {
    elapsed += Math.pow(ASSUME.blastThresholdGrowth, i) / total;
    held += 1 - elapsed;          // this stack is held for the rest of the hunt
  }
  return held;
}

/** Share of the hunt a monster spends paralysed — applications x 4 seconds. */
function paralysisUptime() {
  const up = ASSUME.paralysisProcsPer75s * ASSUME.paralysisTickSeconds / 75;
  return up > 1 ? 1 : up;
}

function procChance(ssaLevel, blastExploitLevel, powderOrVenomistLevel) {
  let base = ASSUME.statusProcBase
    + (BLAST_EXPLOIT_PROC[blastExploitLevel] || 0)
    + (BLASTPOWDER_PROC[powderOrVenomistLevel] || 0);   // same ladder as Venomist
  if (base > 1) base = 1;
  if (!ssaLevel) return base;

  // Status Sneak Attack closes the REMAINING gap to a guaranteed proc, rather
  // than adding a flat amount — Lv5 is "guaranteed" from behind whatever the
  // starting point. So the more the other sources already give, the less it is
  // worth: against a 76% base it can only buy the last 24 points.
  const behind = base + (1 - base) * (ssaLevel / 5);
  return ASSUME.behindRate * behind + (1 - ASSUME.behindRate) * base;
}

// Latent Power's share of the hunt, from when it starts to the end.
function latentUptime() {
  var up = (ASSUME.huntSeconds - ASSUME.latentPowerStart) / ASSUME.huntSeconds;
  return up < 0 ? 0 : up > 1 ? 1 : up;
}
// Raw Power: flat attack bought with affinity.
const RAW_ATK = { 1: 100, 2: 200, 3: 300, 4: 400, 5: 500 };
const RAW_AFF = { 1: 5, 2: 10, 3: 15, 4: 20, 5: 30 };

/** Every skill this engine understands, so the rest can be reported as ignored. */
/**
 * The skills worth considering for ONE weapon.
 *
 * Keeping this tight is not just tidiness: every skill dropped makes more
 * armour pieces collapse into the same bundle, which shrinks the search.
 *
 *   * Resistances and the other defensive skills never enter â€” they do not
 *     touch damage.
 *   * Only the weapon's OWN element is included. Dragon Attack is worthless on
 *     an ice weapon, so it is not a dimension worth searching.
 *   * A status weapon (Blast/Poison/Paralysis/Sleep) or a no-element weapon has
 *     no damaging element at all, so Critical Element, Elemental Release and the
 *     Vital family are dropped with it. They would otherwise be searched and
 *     scored at zero on every single candidate.
 *   * Lock On is close-range only, by its own description, so it is dropped
 *     entirely for bow and bowguns rather than carried at zero weight.
 */
function knownSkills(weapon) {
  const s = new Set(['Attack Boost', 'Advanced Attack Boost', 'Critical Eye', 'Weakness Exploit',
    'Critical Boost', 'Critical Ferocity', 'Valor', 'Peak Performance', 'Burst',
    'Advanced Burst', 'Latent Power', 'Offensive Guard', 'Heroics',
    // Trades affinity for flat attack, which makes it a real option on a
    // negative-affinity weapon and a partner for Critical Ferocity. Omitting it
    // meant the optimiser scored it zero and never considered that build.
    'Raw Power',
    // Ramps on the clock, so it is worth most on a long base defence.
    'Rising Tide']);

  Object.keys(UTILITY).forEach((k) => { if (utilityApplies(k, weapon)) s.add(k); });

  s.add('Sneak Attack');            // damage from behind, any weapon
  s.add('Nergigante Avidity');      // flat damage, any weapon

  // An ammo boost is only worth searching for when the weapon carries ammo it
  // applies to, which the database knows per weapon.
  AMMO_BOOSTS.forEach((b) => { if (ammoBoostApplies(b, weapon)) s.add(b.skill); });

  if (ELEMENTS.indexOf(weapon.element) >= 0) {
    s.add(weapon.element + ' Attack');
    s.add('Advanced ' + weapon.element + ' Attack');
    s.add('Vital ' + weapon.element);
    s.add('Critical Element');
    s.add('Elemental Release');
    s.add('Health Boost');          // only matters through Vital
    (ELEMENT_SKILLS[weapon.element] || []).forEach((p) => s.add(p[0]));
    // Every bow shot is charged, so Charge Master is a flat element multiplier
    // there — except on a style-selectable status bow, played with dodgebolt.
    if (weapon.category === 'Bow' && !(weapon.styleSelectable && isStatus(weapon))) {
      s.add('Charge Master');
    }
  }

  // A status weapon's buildup deals no damage itself, but it drives a separate
  // family of skills that do. Only the matching status counts: Poison Exploit
  // is worthless on a blast weapon.
  if (STATUS.indexOf(weapon.element) >= 0) {
    s.add(weapon.element + ' Attack');     // raises buildup, so raises proc rate
    s.add('Buildup Boost');
    s.add('Status Sneak Attack');
    if (STATUS_EXPLOIT[weapon.element]) s.add(weapon.element + ' Exploit');
    if (weapon.element === 'Blast') {
      s.add('Blast Exploit');
      s.add('Teostra Blastpowder');   // also raises the proc chance
    }
    if (weapon.element === 'Poison') s.add('Chameleos Venomist');
  }
  return s;
}

/** Roll a set's skill totals into one damage figure. */
function score(totals, w) {
  const lv = (n) => totals[n] || 0;
  const elemental = ELEMENTS.indexOf(w.element) >= 0;

  let atk = w.atk;
  let ele = elemental ? w.ele : 0;        // status buildup is not damage
  let aff = w.aff;
  // Percentage lifts on element are kept apart from the flat ones, because a
  // stat slot adds to the weapon's element value and is lifted along with it.
  let elePct = 0;

  atk += ATTACK_BOOST[lv('Attack Boost')] || 0;
  if (lv('Attack Boost') >= 5) atk += ADV_ATTACK[lv('Advanced Attack Boost')] || 0;
  atk += RAW_ATK[lv('Raw Power')] || 0;
  atk += tideAttack(lv('Rising Tide'), ASSUME.huntSeconds);
  atk += (VALOR[lv('Valor')] || 0) * ASSUME.valorUptime;
  atk += (PEAK[lv('Peak Performance')] || 0) * ASSUME.peakPerformanceUptime;

  if (elemental) {
    ele += ELEM_ATTACK[lv(w.element + ' Attack')] || 0;
    if (lv(w.element + ' Attack') >= 5) ele += ADV_ELEM[lv('Advanced ' + w.element + ' Attack')] || 0;
    const hp = (ASSUME.baseHp + (HEALTH[lv('Health Boost')] || 0)) * ASSUME.hpFraction;
    ele += (VITAL[lv('Vital ' + w.element)] || 0) * hp;
    elePct = (ELEM_RELEASE[lv('Elemental Release')] || 0) *
      elemReleaseUptime(lv('Nergigante Avidity'), lv('Valor'));
    (ELEMENT_SKILLS[w.element] || []).forEach((p) => { elePct += p[1][lv(p[0])] || 0; });
    if (w.category === 'Bow' && !(w.styleSelectable && isStatus(w))) {
      elePct += CHARGE_MASTER[lv('Charge Master')] || 0;
    }
  }

  aff += (CEYE[lv('Critical Eye')] || 0);
  aff += (WEX[lv('Weakness Exploit')] || 0) * ASSUME.weakPointUptime;
  aff += (LATENT[lv('Latent Power')] || 0) * latentUptime();
  aff -= (CFERO_AFF[lv('Critical Ferocity')] || 0);
  aff -= (RAW_AFF[lv('Raw Power')] || 0);

  const m = CBOOST[Math.min(5, lv('Critical Boost'))];
  const ce = CELEM[Math.min(5, lv('Critical Element'))];
  const cf = lv('Critical Ferocity');

  // Flat multipliers on the whole hit. None of them depend on how the three
  // stat slots are split, so they are worked out once and applied after.
  let mult = 1;
  mult *= 1 + (BURST[lv('Burst')] || 0) * ASSUME.burstUptime;
  if (lv('Burst') >= 5) mult *= 1 + (ADV_BURST[lv('Advanced Burst')] || 0) * ASSUME.burstUptime;
  mult *= 1 + (OFF_GUARD[lv('Offensive Guard')] || 0) * ASSUME.offensiveGuardUptime;
  mult *= 1 + (HEROICS[lv('Heroics')] || 0) * ASSUME.heroicsUptime;
  mult *= 1 + (SNEAK[lv('Sneak Attack')] || 0) * ASSUME.behindRate;
  mult *= 1 + (AVIDITY[lv('Nergigante Avidity')] || 0);
  AMMO_BOOSTS.forEach((b) => {
    if (!ammoBoostApplies(b, w)) return;
    mult *= 1 + (b.levels[lv(b.skill)] || 0) * ammoShare(w, b);
  });

  // --- the status path --------------------------------------------------
  let blastBonus = 0;
  if (STATUS.indexOf(w.element) >= 0) {
    const proc = procChance(lv('Status Sneak Attack'),
      w.element === 'Blast' ? lv('Blast Exploit') : 0,
      w.element === 'Blast' ? lv('Teostra Blastpowder') : lv('Chameleos Venomist'));
    // Buildup Boost pays on the hit that procs, so it is the skill's value
    // times how often that happens.
    mult *= 1 + (BUILDUP_BOOST[lv('Buildup Boost')] || 0) * proc;

    const ex = STATUS_EXPLOIT[w.element];
    if (ex) {
      const poison = w.element === 'Poison';
      const uptime = poison ? poisonUptime() : paralysisUptime();
      // Paralysis carries a flat 10% on top, with or without the Exploit.
      const base = poison ? 0 : ASSUME.paralysisBaseBonus;
      mult *= 1 + (base + (ex[lv(w.element + ' Exploit')] || 0)) * uptime;
    }
    // Blast Exploit is flat attack per proc, stacking. Stacks accumulate
    // through the hunt, so the average held is about half the final count.
    if (w.element === 'Blast' && lv('Blast Exploit')) {
      blastBonus = (BLAST_EXPLOIT_ATK[lv('Blast Exploit')] || 0) * blastAverageStacks();
    }
  }
  mult *= styleRate(w);

  // The three stat slots are chosen against this set rather than before it.
  const slots = statSlotChoices(w) || NO_SLOTS;
  let dmg = -Infinity, pick = null;
  slots.forEach((s) => {
    const a = atk + s.atk;
    const e = elemental ? (ele + s.ele) * (1 + elePct) : 0;
    let d = critDamage(a, e, aff + s.aff, m, ce, cf) * mult;
    if (blastBonus) d *= (a + blastBonus) / a;
    if (d > dmg) { dmg = d; pick = s.label; }
  });

  // Utility, priced as a fraction of damage.
  let util = 0;
  Object.keys(UTILITY).forEach((n) => {
    if (!lv(n)) return;
    if (!utilityApplies(n, w)) return;
    const table = utilityTable(n, w);
    const max = Math.max.apply(null, Object.keys(table).map(Number));
    util += table[Math.min(lv(n), max)] || 0;
  });

  return { dmg: dmg, util: util, total: dmg * (1 + util), statSlots: pick };
}

/**
 * The same calculation returning only the number.
 *
 * The search evaluates a few tens of millions of candidates, and allocating a
 * result object for each one exhausted the heap. Reporting calls score() for
 * the handful of finalists instead.
 */
function scoreTotal(totals, w) {
  const s = score(totals, w);
  return s.total;
}

/**
 * A scorer bound to one weapon and one fixed skill ordering.
 *
 * The search evaluates millions of candidates, and the object-keyed score()
 * rebuilds a name-keyed map for every one of them. This resolves each skill to
 * an array index once, so the hot loop reads integers out of a typed array and
 * allocates nothing.
 *
 * Returns { names, scoreVec } where scoreVec takes an Int16Array of levels in
 * `names` order.
 */
function makeScorer(w, damageOnly) {
  const names = Array.from(knownSkills(w)).sort();
  const at = {};
  names.forEach((n, i) => { at[n] = i; });
  const I = (n) => (at[n] === undefined ? -1 : at[n]);

  const elemental = ELEMENTS.indexOf(w.element) >= 0;
  const iAB = I('Attack Boost'), iAAB = I('Advanced Attack Boost');
  const iValor = I('Valor'), iPeak = I('Peak Performance'), iHero = I('Heroics');
  const iEA = elemental ? I(w.element + ' Attack') : -1;
  const iAEA = elemental ? I('Advanced ' + w.element + ' Attack') : -1;
  const iVital = elemental ? I('Vital ' + w.element) : -1;
  const iHealth = I('Health Boost'), iER = I('Elemental Release');
  const iCEye = I('Critical Eye'), iWEx = I('Weakness Exploit'), iLat = I('Latent Power');
  const iCF = I('Critical Ferocity'), iCB = I('Critical Boost'), iCE = I('Critical Element');
  const iBurst = I('Burst'), iAB2 = I('Advanced Burst'), iOG = I('Offensive Guard');
  const iRaw = I('Raw Power'), iTide = I('Rising Tide');
  const isStatusW = STATUS.indexOf(w.element) >= 0;
  const iSneak = I('Sneak Attack'), iSSA = I('Status Sneak Attack');
  const iBuildup = I('Buildup Boost');
  const iExploit = isStatusW ? I(w.element + ' Exploit') : -1;
  const exTable = STATUS_EXPLOIT[w.element] || null;
  const exUptime = w.element === 'Poison' ? poisonUptime() : paralysisUptime();
  const exBase = w.element === 'Paralysis' ? ASSUME.paralysisBaseBonus : 0;
  const iBlastEx = w.element === 'Blast' ? I('Blast Exploit') : -1;
  const iPowder = w.element === 'Blast' ? I('Teostra Blastpowder')
    : w.element === 'Poison' ? I('Chameleos Venomist') : -1;
  const iAvidity = I('Nergigante Avidity');
  // The share depends only on the weapon, not on any skill level, so it is
  // resolved once here rather than recomputed per candidate.
  const ammoBoosts = AMMO_BOOSTS.filter((b) => ammoBoostApplies(b, w) && I(b.skill) >= 0)
    .map((b) => ({ i: I(b.skill), levels: b.levels, share: ammoShare(w, b) }));
  // Element-multiplying monster skills for this weapon's element, resolved up front.
  const elemSkills = (ELEMENT_SKILLS[w.element] || [])
    .map((p) => ({ i: I(p[0]), table: p[1] })).filter((x) => x.i >= 0);
  const iCharge = (w.category === 'Bow' && !(w.styleSelectable && STATUS.indexOf(w.element) >= 0))
    ? I('Charge Master') : -1;

  // Utility skills that apply to this weapon, resolved up front.
  const util = [];
  Object.keys(UTILITY).forEach((n) => {
    if (!utilityApplies(n, w)) return;
    if (I(n) < 0) return;
    const table = utilityTable(n, w);
    util.push({ i: I(n), table: table,
      max: Math.max.apply(null, Object.keys(table).map(Number)) });
  });

  const g = (v, i) => (i < 0 ? 0 : v[i]);
  // Constant for the whole search: the style's own firing rate, and the ways
  // the three stat slots can be split.
  const sRate = styleRate(w);
  const slots = statSlotChoices(w) || NO_SLOTS;

  function scoreVec(v) {
    let atk = w.atk;
    let ele = elemental ? w.ele : 0;
    let aff = w.aff;
    let elePct = 0;

    atk += ATTACK_BOOST[g(v, iAB)] || 0;
    if (g(v, iAB) >= 5) atk += ADV_ATTACK[g(v, iAAB)] || 0;
    atk += RAW_ATK[g(v, iRaw)] || 0;
    atk += tideAttack(g(v, iTide), ASSUME.huntSeconds);
    atk += (VALOR[g(v, iValor)] || 0) * ASSUME.valorUptime;
    atk += (PEAK[g(v, iPeak)] || 0) * ASSUME.peakPerformanceUptime;

    if (elemental) {
      ele += ELEM_ATTACK[g(v, iEA)] || 0;
      if (g(v, iEA) >= 5) ele += ADV_ELEM[g(v, iAEA)] || 0;
      const hp = (ASSUME.baseHp + (HEALTH[g(v, iHealth)] || 0)) * ASSUME.hpFraction;
      ele += (VITAL[g(v, iVital)] || 0) * hp;
      elePct = (ELEM_RELEASE[g(v, iER)] || 0) *
        elemReleaseUptime(g(v, iAvidity), g(v, iValor));
      for (let k = 0; k < elemSkills.length; k++) {
        elePct += elemSkills[k].table[v[elemSkills[k].i]] || 0;
      }
      if (iCharge >= 0) elePct += CHARGE_MASTER[g(v, iCharge)] || 0;
    }

    aff += CEYE[g(v, iCEye)] || 0;
    aff += (WEX[g(v, iWEx)] || 0) * ASSUME.weakPointUptime;
    aff += (LATENT[g(v, iLat)] || 0) * latentUptime();
    aff -= CFERO_AFF[g(v, iCF)] || 0;
    aff -= RAW_AFF[g(v, iRaw)] || 0;

    const m = CBOOST[Math.min(5, g(v, iCB))];
    const ce = CELEM[Math.min(5, g(v, iCE))];
    const cf = g(v, iCF);

    // Everything that does not depend on how the stat slots are split.
    let dmg = 1;
    dmg *= 1 + (BURST[g(v, iBurst)] || 0) * ASSUME.burstUptime;
    if (g(v, iBurst) >= 5) dmg *= 1 + (ADV_BURST[g(v, iAB2)] || 0) * ASSUME.burstUptime;
    dmg *= 1 + (OFF_GUARD[g(v, iOG)] || 0) * ASSUME.offensiveGuardUptime;
    dmg *= 1 + (HEROICS[g(v, iHero)] || 0) * ASSUME.heroicsUptime;
    dmg *= 1 + (SNEAK[g(v, iSneak)] || 0) * ASSUME.behindRate;
    dmg *= 1 + (AVIDITY[g(v, iAvidity)] || 0);
    for (let k = 0; k < ammoBoosts.length; k++) {
      dmg *= 1 + (ammoBoosts[k].levels[v[ammoBoosts[k].i]] || 0) * ammoBoosts[k].share;
    }
    let blastBonus = 0;

    if (isStatusW) {
      const proc = procChance(g(v, iSSA), iBlastEx >= 0 ? g(v, iBlastEx) : 0,
        iPowder >= 0 ? g(v, iPowder) : 0);
      dmg *= 1 + (BUILDUP_BOOST[g(v, iBuildup)] || 0) * proc;
      if (exTable) dmg *= 1 + (exBase + (exTable[g(v, iExploit)] || 0)) * exUptime;
      if (iBlastEx >= 0 && g(v, iBlastEx)) {
        blastBonus = (BLAST_EXPLOIT_ATK[g(v, iBlastEx)] || 0) * blastAverageStacks();
      }
    }

    dmg *= sRate;

    // The three stat slots, chosen against this set. One entry when they are
    // off, so the usual case costs one pass of the formula as before.
    let best = -Infinity;
    for (let s = 0; s < slots.length; s++) {
      const a = atk + slots[s].atk;
      const e = elemental ? (ele + slots[s].ele) * (1 + elePct) : 0;
      let d = critDamage(a, e, aff + slots[s].aff, m, ce, cf) * dmg;
      if (blastBonus) d *= (a + blastBonus) / a;
      if (d > best) best = d;
    }
    dmg = best;

    if (damageOnly) return dmg;
    let u = 0;
    for (let k = 0; k < util.length; k++) {
      const lvl = v[util[k].i];
      // Capped at each skill's own max, not a blanket 3 — Focus runs to 5.
      if (lvl) u += util[k].table[lvl > util[k].max ? util[k].max : lvl] || 0;
    }
    return dmg * (1 + u);
  }

  return { names: names, at: at, scoreVec: scoreVec };
}

return { ASSUME: ASSUME, UTILITY: UTILITY, UTILITY_SCOPE: UTILITY_SCOPE,
  score: score, scoreTotal: scoreTotal, makeScorer: makeScorer,
  knownSkills: knownSkills, styleVariants: styleVariants,
  utilityTable: utilityTable, handlingTable: handlingTable,
  elemReleaseUptime: elemReleaseUptime,
  styleRate: styleRate, shotSeconds: shotSeconds,
  reloadSeconds: reloadSeconds, magazineSize: magazineSize,
  statSlotChoices: statSlotChoices,
  SHOT_SECONDS: SHOT_SECONDS, RELOAD_SECONDS: RELOAD_SECONDS,
  bandAfter: bandAfter,
  ELEMENTS: ELEMENTS, STATUS: STATUS };
}));
