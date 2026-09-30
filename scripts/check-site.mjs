// Static checks for website/: local references exist (and are relative, so the site works under /Daylens/),
// sharing tags are present, nothing is fetched from third parties, images have alt text, download buttons use
// the stable installer URL, and motion never hides content without JS or with reduced motion.
// Run: node scripts/check-site.mjs
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'website');
const DOWNLOAD = 'https://github.com/aaron-sequeira/Daylens/releases/latest/download/Daylens-Setup.exe';
const OPTIONAL = new Set(process.env.CHECK_SITE_ALLOW_MISSING ? process.env.CHECK_SITE_ALLOW_MISSING.split(',') : []);
const fail = [];
const read = (f) => (existsSync(join(root, f)) ? readFileSync(join(root, f), 'utf8') : (fail.push(`missing ${f}`), ''));
const html = read('index.html');
const css = read('styles.css');

const refs = [
  ...[...html.matchAll(/\s(?:src|href|srcset)="([^"]+)"/g)].map((m) => m[1]),
  ...[...css.matchAll(/url\(([^)]+)\)/g)].map((m) => m[1].replace(/['"]/g, ''))
];
for (const r of refs) {
  if (/^(https?:|mailto:|#|data:)/.test(r)) continue;
  if (r.startsWith('/')) { fail.push(`root-absolute path breaks under /Daylens/: ${r}`); continue; }
  const file = r.split('#')[0];
  if (!existsSync(join(root, file)) && !OPTIONAL.has(file)) fail.push(`missing file: ${r}`);
}
for (const need of ['<html lang="en">', '<title>', 'name="viewport"', 'name="description"', 'rel="canonical"',
  'property="og:title"', 'property="og:image"', 'name="twitter:card"']) {
  if (!html.includes(need)) fail.push(`missing head tag: ${need}`);
}
for (const [name, src] of [['index.html', html], ['styles.css', css]]) {
  if (/googleapis|gstatic|jsdelivr|unpkg|cdnjs/.test(src)) fail.push(`third-party request in ${name}`);
}
for (const m of html.matchAll(/<img\b[^>]*>/g)) if (!/\salt="/.test(m[0])) fail.push(`img without alt: ${m[0].slice(0, 90)}`);
const downloads = [...html.matchAll(/<a\b[^>]*\bdata-download\b[^>]*>/g)].map((m) => (m[0].match(/href="([^"]+)"/) || [])[1]);
if (downloads.length < 3) fail.push(`expected at least 3 download buttons, found ${downloads.length}`);
for (const d of downloads) if (d !== DOWNLOAD) fail.push(`download button points to ${d}`);
if (/(^|[^s]\s)\.reveal\s*\{[^}]*opacity:\s*0/.test(css)) fail.push('.reveal is hidden without the .js guard');
if (!/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[^@]*animation:\s*none\s*!important[^@]*transition:\s*none\s*!important/.test(css)) {
  fail.push('missing prefers-reduced-motion rule that turns off animation and transition');
}
if (!/<picture>\s*<source media="\(prefers-reduced-motion: reduce\)" srcset="[^"]+">\s*<img src="assets\/daylens-showreel-teaser\.gif"/.test(html)) {
  fail.push('the teaser GIF needs a still <source> for prefers-reduced-motion');
}
if (!/\.reel a:focus-visible\s*\{[^}]*outline-color:\s*var\(--sun\)/.test(css)) fail.push('focus ring on the dark reel panel needs the sun outline (violet is under 3:1 there)');
if (!html.includes('not unless you turn on the optional cloud writer')) fail.push('privacy FAQ must mention the optional cloud writer, not a flat "no"');
if (!html.includes('an internet connection once')) fail.push('requirements FAQ must mention the one-time model download');
if (!html.includes('daylensMotion')) fail.push('head script needs the fallback that un-hides content when main.js never runs');
for (const f of ['assets/daylens-showreel.mp4', 'assets/daylens-showreel-teaser.gif']) {
  if (existsSync(join(root, f)) && statSync(join(root, f)).size > 95 * 1024 * 1024) fail.push(`${f} is over GitHub's 100 MB file limit`);
}

if (fail.length) { console.error(fail.map((f) => `✗ ${f}`).join('\n')); process.exit(1); }
console.log('check-site OK');
