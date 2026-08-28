/**
 * Exports each picker as one self-contained, minified HTML file.
 *
 *   node export.js            -> mhnow-picker.html, mhnow-weapon-picker.html
 *
 * Each page is rendered through the PHP CLI rather than having its markup
 * rebuilt here, so an export can never drift from the site and no site file
 * needs to change to support it. The rendered page already carries its dataset
 * inlined, so the database travels with the file.
 *
 * Whatever stylesheets and scripts a page links are discovered from the
 * rendered HTML and inlined — adding a stylesheet to a page needs no change
 * here. The result opens straight off the filesystem: no server, no database,
 * no network.
 *
 * The two exports cross-link by filename, so keep them in the same folder if
 * you want those links to work. That is the only non-inlined reference either
 * file contains.
 *
 * Node 10 compatible; terser 4 / clean-css 4 are pinned to match.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const Terser = require('terser');
const CleanCSS = require('clean-css');

const HERE = __dirname;
const PICKER = path.join(HERE, 'picker');

const PAGES = [
  { page: 'index.php', out: 'mhnow-picker.html', label: 'armour picker' },
  { page: 'weapons.php', out: 'mhnow-weapon-picker.html', label: 'weapon picker' },
];

// Links between the two pages on the site -> the exported filenames.
const SIBLING = {
  './': 'mhnow-picker.html',
  'index.php': 'mhnow-picker.html',
  'weapons.php': 'mhnow-weapon-picker.html',
};

const kb = (s) => (Buffer.byteLength(s, 'utf8') / 1024).toFixed(1) + ' KB';

// --- render ----------------------------------------------------------------

function renderPage(file) {
  const candidates = ['php', 'C:\\wamp64\\bin\\php\\php5.6.35\\php.exe'];
  let lastErr;
  for (const bin of candidates) {
    try {
      return execFileSync(bin, [path.join(PICKER, file)], {
        encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, cwd: PICKER,
      });
    } catch (e) { lastErr = e; }
  }
  throw new Error('could not run the PHP CLI to render ' + file + ': ' + lastErr.message);
}

// --- minify ----------------------------------------------------------------

function minifyCss(css) {
  const res = new CleanCSS({ level: 2, returnPromise: false }).minify(css);
  if (res.errors && res.errors.length) throw new Error('CSS: ' + res.errors.join('; '));
  res.warnings.forEach((w) => console.log('    css warning: ' + w));
  return res.styles;
}

function minifyJs(js) {
  // Each app is a single IIFE with nothing exported, so top-level mangling is
  // safe and buys the most.
  const res = Terser.minify(js, {
    compress: { toplevel: true, passes: 2 },
    mangle: { toplevel: true },
    output: { comments: false },
  });
  if (res.error) throw res.error;
  return res.code;
}

// Collapse the markup without touching anything inside script/style.
function minifyHtml(html) {
  const stash = [];
  let out = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, (m) => {
    stash.push(m);
    return '\u0000' + (stash.length - 1) + '\u0000';
  });
  out = out
    .replace(/<!--(?!\[if)[\s\S]*?-->/g, '')
    .replace(/\s+/g, ' ')
    .replace(/>\s+</g, '><')
    .trim();
  return out.replace(/\u0000(\d+)\u0000/g, (m, i) => stash[Number(i)]);
}

// --- one page --------------------------------------------------------------

function exportPage(spec) {
  console.log('rendering picker/' + spec.page + ' ...');
  const page = renderPage(spec.page);

  if (/Cannot reach the mhnow database/.test(page)) {
    throw new Error(spec.page + ' could not reach the database — import schema.sql and seed.sql first');
  }

  const dataMatch = page.match(/<script id="data" type="application\/json">([\s\S]*?)<\/script>/);
  if (!dataMatch) throw new Error('no inlined dataset found in ' + spec.page);
  const payload = JSON.parse(dataMatch[1]);
  const rows = payload.weapons ? payload.weapons.length + ' weapons'
                               : payload.armor.length + ' armour pieces';
  console.log('  dataset: ' + rows + ' (' + kb(dataMatch[1]) + ')');

  let html = page;

  // Inline every local stylesheet the page links.
  let cssBefore = 0, cssAfter = 0, cssCount = 0;
  html = html.replace(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/gi, (tag, href) => {
    if (/^[a-z]+:|^\/\//i.test(href)) return tag;            // leave anything remote alone
    // The pages append a ?v=<mtime> cache-buster; strip it to find the file.
    const raw = fs.readFileSync(path.join(PICKER, href.split('?')[0]), 'utf8');
    const min = minifyCss(raw);
    cssBefore += Buffer.byteLength(raw, 'utf8');
    cssAfter += Buffer.byteLength(min, 'utf8');
    cssCount++;
    return '<style>' + min + '</style>';
  });

  // Inline every local script the page links.
  let jsBefore = 0, jsAfter = 0, jsCount = 0;
  html = html.replace(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/gi, (tag, src) => {
    if (/^[a-z]+:|^\/\//i.test(src)) return tag;
    const raw = fs.readFileSync(path.join(PICKER, src.split('?')[0]), 'utf8');
    const min = minifyJs(raw);
    jsBefore += Buffer.byteLength(raw, 'utf8');
    jsAfter += Buffer.byteLength(min, 'utf8');
    jsCount++;
    return '<script>' + min + '</script>';
  });

  if (!cssCount || !jsCount) {
    throw new Error('inlined ' + cssCount + ' stylesheet(s) and ' + jsCount +
      ' script(s) for ' + spec.page + ' — the tags no longer match what export.js looks for');
  }
  console.log('  css: ' + cssCount + ' file(s), ' + (cssBefore / 1024).toFixed(1) +
    ' KB -> ' + (cssAfter / 1024).toFixed(1) + ' KB');
  console.log('  js:  ' + jsCount + ' file(s), ' + (jsBefore / 1024).toFixed(1) +
    ' KB -> ' + (jsAfter / 1024).toFixed(1) + ' KB');

  // Re-encode the payload compactly, escaping the one sequence that could end
  // the script block early.
  const json = JSON.stringify(payload).replace(/<\//g, '<\\/');
  html = html.replace(
    /<script id="data" type="application\/json">[\s\S]*?<\/script>/,
    '<script id="data" type="application/json">' + json + '</script>'
  );

  // Point cross-page links at the exported filenames.
  html = html.replace(/href="([^"]+)"/g, (tag, href) =>
    SIBLING[href] ? 'href="' + SIBLING[href] + '"' : tag);

  html = html.replace('<title>',
    '<meta name="generator" content="mhnow-db export ' + new Date().toISOString().slice(0, 10) + '"><title>');

  const before = html;
  html = minifyHtml(html);
  fs.writeFileSync(path.join(HERE, spec.out), html, 'utf8');
  console.log('  html: ' + kb(before) + ' -> ' + kb(html));
  console.log('wrote ' + spec.out + ' (' + kb(html) + ')');

  // Anything still pointing outward, minus the deliberate sibling links.
  const refs = (html.match(/(?:src|href)="(?!data:|#)[^"]+"/g) || [])
    .filter((r) => !Object.keys(SIBLING).some((k) => r.indexOf(SIBLING[k]) > -1));
  if (refs.length) console.log('  WARNING external references remain: ' + refs.join(', '));
  else console.log('  self-contained: no external references (sibling links aside)');
  console.log('');
}

/**
 * Mirror the exports into docs/, which is what GitHub Pages serves.
 *
 * The armour picker becomes index.html so the site answers at the bare URL. The
 * weapon picker links back to it by filename, so that one link is rewritten —
 * the alternative is shipping the armour picker twice under two names.
 *
 * Regenerating docs/ on every export is the point: a hand-copied index.html
 * goes stale the first time you forget, and a stale public page is worse than
 * no public page.
 */
function publishDocs() {
  const docs = path.join(HERE, 'docs');
  if (!fs.existsSync(docs)) fs.mkdirSync(docs);

  const armour = fs.readFileSync(path.join(HERE, 'mhnow-picker.html'), 'utf8');
  fs.writeFileSync(path.join(docs, 'index.html'), armour, 'utf8');

  let weapons = fs.readFileSync(path.join(HERE, 'mhnow-weapon-picker.html'), 'utf8');
  const before = (weapons.match(/href="mhnow-picker\.html"/g) || []).length;
  weapons = weapons.replace(/href="mhnow-picker\.html"/g, 'href="index.html"');
  if (!before) console.log('  WARNING the weapon picker has no link back to the armour picker');
  fs.writeFileSync(path.join(docs, 'mhnow-weapon-picker.html'), weapons, 'utf8');

  // Without this GitHub runs the pages through Jekyll, which skips files whose
  // names begin with an underscore. Nothing here does, but the build step is
  // pure overhead either way.
  fs.writeFileSync(path.join(docs, '.nojekyll'), '', 'utf8');

  console.log('docs/ ready for GitHub Pages: index.html (armour), ' +
    'mhnow-weapon-picker.html, .nojekyll — ' + before + ' back-link(s) repointed');
}

// Rendering needs PHP and a live database; mirroring into docs/ needs neither.
// --docs-only rebuilds the published folder from the exports already on disk,
// which is what you want when the database is down or you only changed how the
// site is published.
const DOCS_ONLY = process.argv.indexOf('--docs-only') > -1;

try {
  if (!DOCS_ONLY) PAGES.forEach(exportPage);
  else console.log('--docs-only: mirroring the existing exports, not re-rendering');
  publishDocs();
} catch (e) {
  console.error(e.message || e);
  process.exit(1);
}
