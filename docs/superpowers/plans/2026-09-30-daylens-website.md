# Daylens Website Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the direction-A Daylens marketing site as plain static files in `website/`, deployed to GitHub Pages by GitHub Actions, with every download button pointing to a stable installer URL.

**Architecture:** One hand-written page: `index.html` plus `styles.css`, and a tiny `main.js` that only adds motion. Fonts and images are served from `website/assets/`. There's no build step. A static checker (`scripts/check-site.mjs`) guards references, head tags, privacy (no third-party requests) and the no-JS / reduced-motion rules. An Electron render check (`scripts/check-site-render.cjs`) guards phone and desktop layout. The GitHub Actions workflow runs the static checker, then publishes `website/`.

**Tech Stack:** HTML, CSS, vanilla JS, Node 20 (checker), Electron 33 from the repo (render check), GitHub Actions + Pages.

**Spec:** `docs/superpowers/specs/2026-09-30-daylens-website-design.md`

## Global Constraints

- The look is mockup A (`Main.dc.html` on https://claude.ai/artifact/TW7P3Y1PMiTRy1SgJrFPTY):
  - app-window frames with a 2px ink border and hard ink shadow;
  - tilted stickers and lowercase copy;
  - palette cream `#FBF8F4`, ink `#171717`, lavender `#D8D2FC`, mint `#BFEBD3`, pink `#F4C6C8`, peach `#F9DDB9`, sky `#CFE6FB`, sun `#F6B35E`, violet `#5b4bd6`, green `#2d6b54`.
- Hero art: the hand-drawn sunrise SVG above the headline (not the logo tile).
- Release pill `( ˘ ᵕ ˘ ) new · v1.0.1 is out` sits in a black strip above the nav and links to `https://github.com/aaron-sequeira/Daylens/releases/tag/v1.0.1`.
- Download URL (every download button, exactly): `https://github.com/aaron-sequeira/Daylens/releases/latest/download/Daylens-Setup.exe`
- Site URL: `https://aaron-sequeira.github.io/Daylens/`. All in-site paths are relative, never starting with `/`.
- No third-party requests from the site: fonts are self-hosted, with no Google Fonts or CDN.
- Copy stays true to the app: no invented stats, users, ratings or testimonials.
- Every `<img>` has `alt`, the decorative sunrise is `aria-hidden`, focus is visible, and text contrast is at least 4.5:1.
- No framework, no dependencies, no build step.

## Review Focus

1. **Phone width (390 px):** the floating windows and sticker must not cause horizontal scroll. Pinned by the render check in Task 2.
2. **JavaScript off or blocked:** every section must be visible, with only the motion missing. Pinned by the checker's "`.reveal` is hidden only under `.js`" rule in Task 1.
3. **Served under the `/Daylens/` subpath:** a root-absolute path would 404. Pinned by the checker's "no path starting with `/`" rule in Task 1.
4. **Download button:** the stable URL must return the installer, not a 404, once the site is live. Pinned by the curl check in Task 3.
5. **Reduced motion:** no animation or transition. Pinned by the checker's reduced-motion rule in Task 1.

---

### Task 1: The page — markup, styles, assets and the static checker

**Files:**
- Create: `scripts/check-site.mjs`
- Create: `website/index.html`
- Create: `website/styles.css`
- Create: `website/assets/` (copied images, video, logo, fonts + licences)

**Interfaces:**
- Produces: `website/index.html`, which marks animated containers with class `reveal`, download links with attribute `data-download`, and the reel play link with `data-play-reel`. It links `main.js` with `defer`; that file is created in Task 2, and the checker allows it to be missing until then only via the explicit `OPTIONAL` list.
- Produces: `node scripts/check-site.mjs`, which exits 0 and prints `check-site OK`, or exits 1 and lists the failures.

- [ ] **Step 1: Write the checker (the failing test)**

Create `scripts/check-site.mjs`:

```js
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
  ...[...html.matchAll(/\s(?:src|href)="([^"]+)"/g)].map((m) => m[1]),
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
for (const f of ['assets/daylens-showreel.mp4', 'assets/daylens-showreel-teaser.gif']) {
  if (existsSync(join(root, f)) && statSync(join(root, f)).size > 95 * 1024 * 1024) fail.push(`${f} is over GitHub's 100 MB file limit`);
}

if (fail.length) { console.error(fail.map((f) => `✗ ${f}`).join('\n')); process.exit(1); }
console.log('check-site OK');
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `node scripts/check-site.mjs`
Expected: exit 1, with lines including `✗ missing index.html` and `✗ missing styles.css`.

- [ ] **Step 3: Copy assets and fonts**

```bash
mkdir -p website/assets/fonts
cp docs/images/daylens-today.png docs/images/daylens-insights.png docs/images/daylens-break.png docs/images/daylens-reminders.png website/assets/
cp docs/media/daylens-showreel-teaser.gif docs/media/daylens-showreel.mp4 website/assets/
cp apps/consumer/resources/logo-full.svg website/assets/logo.svg
cp node_modules/@fontsource-variable/dm-sans/files/dm-sans-latin-wght-normal.woff2 website/assets/fonts/dm-sans.woff2
cp node_modules/@fontsource-variable/dm-sans/LICENSE website/assets/fonts/DM-Sans-OFL.txt
curl -sfL -o website/assets/fonts/dm-mono-400.woff2 https://cdn.jsdelivr.net/npm/@fontsource/dm-mono@5/files/dm-mono-latin-400-normal.woff2
curl -sfL -o website/assets/fonts/dm-mono-500.woff2 https://cdn.jsdelivr.net/npm/@fontsource/dm-mono@5/files/dm-mono-latin-500-normal.woff2
curl -sfL -o website/assets/fonts/DM-Mono-OFL.txt https://cdn.jsdelivr.net/npm/@fontsource/dm-mono@5/LICENSE
ls -la website/assets website/assets/fonts
```

Expected: 4 PNGs, the GIF (about 3.7 MB), the MP4 (about 15 MB), `logo.svg`, 3 woff2 files and 2 licence files, all non-empty. The fonts are fetched once at build time and committed; the site itself never calls a CDN.

- [ ] **Step 4: Write `website/index.html`**

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Daylens — a little sun that lives on your PC</title>
<meta name="description" content="Daylens shows where your screen time goes, writes your daily report and reminds you to take breaks, drink water and eat lunch. Free for Windows 10 and 11. Everything stays on your PC.">
<link rel="canonical" href="https://aaron-sequeira.github.io/Daylens/">
<meta property="og:type" content="website">
<meta property="og:title" content="Daylens — a little sun that lives on your PC">
<meta property="og:description" content="Screen time, daily reports and gentle break reminders for Windows. Free, private, on-device.">
<meta property="og:url" content="https://aaron-sequeira.github.io/Daylens/">
<meta property="og:image" content="https://aaron-sequeira.github.io/Daylens/assets/og.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#FBF8F4">
<link rel="icon" href="assets/logo.svg" type="image/svg+xml">
<link rel="preload" href="assets/fonts/dm-sans.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="styles.css">
<script>document.documentElement.classList.add('js')</script>
<script src="main.js" defer></script>
</head>
<body>
<a class="skip" href="#main">skip to content</a>

<a class="strip" id="whats-new" href="https://github.com/aaron-sequeira/Daylens/releases/tag/v1.0.1">
  <span class="pill">( ˘ ᵕ ˘ ) new · v1.0.1 is out</span>
  <span class="strip-text">real app icons, a startup switch and a few fixes — see what's new →</span>
</a>

<nav class="nav wrap" aria-label="Main">
  <a class="brand" href="#top"><img src="assets/logo.svg" alt="" width="36" height="36">daylens</a>
  <div class="nav-links">
    <a href="#features">what it does</a>
    <a href="#privacy">privacy</a>
    <a href="#faq">faq</a>
    <a class="btn-pill" data-download href="https://github.com/aaron-sequeira/Daylens/releases/latest/download/Daylens-Setup.exe">download</a>
  </div>
</nav>

<main id="main">
<header id="top" class="hero wrap">
  <svg class="sunrise" viewBox="0 0 220 120" width="220" height="120" fill="none" stroke-linecap="round" aria-hidden="true">
    <path class="sun" pathLength="1" d="M58 96a52 52 0 0 1 104 0" stroke="#F6B35E" stroke-width="8"/>
    <path class="rays" pathLength="1" d="M110 30V10M70 42 58 26M150 42l12-16M42 72 24 64M178 72l18-8" stroke="#F6B35E" stroke-width="7"/>
    <path class="horizon" pathLength="1" d="M14 100c16-4 30-8 46-4s30 8 50 4 30-8 50-4 30 6 46 2" stroke="#171717" stroke-width="7"/>
  </svg>
  <h1>a little sun that lives on your pc</h1>
  <p class="lede">daylens quietly notices where your screen time goes, writes you a daily report, and reminds you to drink water, eat lunch and look away from the screen. all on your pc.</p>
  <div class="ctas">
    <a class="btn btn-dark" data-download href="https://github.com/aaron-sequeira/Daylens/releases/latest/download/Daylens-Setup.exe">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 5.5 10.5 4.4v7.1H3zM11.5 4.3 21 3v8.5h-9.5zM3 12.5h7.5v7.1L3 18.5zM11.5 12.5H21V21l-9.5-1.3z"/></svg>
      download for windows</a>
    <a class="btn btn-light" href="#reel">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round" aria-hidden="true"><path d="M7 4.5v15l12-7.5z"/></svg>
      watch the 60s reel</a>
  </div>
  <p class="fine">free · windows 10 &amp; 11 · no account</p>

  <div class="stage reveal">
    <div class="win float win-reminder" style="--bar: #BFEBD3">
      <div class="win-bar"><span>reminder</span><span class="win-ctl" aria-hidden="true">— ✕</span></div>
      <div class="note"><b>water o'clock</b><p>an hour of screen time. had a glass?</p><span class="chip">i had some</span></div>
    </div>
    <div class="win float win-break" style="--bar: #F9DDB9">
      <div class="win-bar"><span>break.exe</span><span class="win-ctl" aria-hidden="true">— ✕</span></div>
      <img src="assets/daylens-break.png" alt="A Daylens break screen with a hand-drawn glass filling with water" width="720" height="600" loading="lazy">
    </div>
    <p class="sticker">100%<br>on your pc</p>
    <div class="win win-main" style="--bar: #D8D2FC">
      <div class="win-bar"><span>daylens — today</span><span class="win-ctl" aria-hidden="true">— ▢ ✕</span></div>
      <img src="assets/daylens-today.png" alt="The Daylens Today screen: a screen health ring, time per category and a timeline of the day" width="1280" height="820">
    </div>
  </div>
</header>

<section id="features" class="wrap">
  <p class="kicker">{ what it does }</p>
  <h2>it pays attention so you don't have to</h2>
  <div class="cards reveal">
    <article class="win" style="--bar: #CFE6FB">
      <div class="win-bar"><span>where-it-went.txt</span><span class="win-ctl" aria-hidden="true">— ✕</span></div>
      <div class="card-body"><h3>knows where the day went</h3><p>apps and windows, grouped into work, learning, chat and fun. a timeline, a daily goal and a 0–100 screen health score.</p></div>
    </article>
    <article class="win" style="--bar: #D8D2FC">
      <div class="win-bar"><span>report.pdf</span><span class="win-ctl" aria-hidden="true">— ✕</span></div>
      <div class="card-body"><h3>writes your report</h3><p>a plain-language daily report and weekly insights, written by a small ai model on your own pc. search them, save pdfs, draft an email.</p></div>
    </article>
    <article class="win" style="--bar: #BFEBD3">
      <div class="win-bar"><span>breathe.exe</span><span class="win-ctl" aria-hidden="true">— ✕</span></div>
      <div class="card-body"><h3>nudges you to breathe</h3><p>eye breaks, stretches, water, lunch and tea — with hand-drawn break screens. it waits while you're on a call.</p></div>
    </article>
  </div>
  <div class="shots reveal">
    <div class="win" style="--bar: #F4C6C8">
      <div class="win-bar"><span>daylens — insights</span><span class="win-ctl" aria-hidden="true">— ▢ ✕</span></div>
      <img src="assets/daylens-insights.png" alt="Weekly insights: stacked bars of screen time per day with a health score line" width="910" height="720" loading="lazy">
    </div>
    <div class="win" style="--bar: #F9DDB9">
      <div class="win-bar"><span>daylens — reminders</span><span class="win-ctl" aria-hidden="true">— ▢ ✕</span></div>
      <img src="assets/daylens-reminders.png" alt="Reminder settings with water, lunch, tea and dinner plus custom reminders" width="910" height="720" loading="lazy">
    </div>
  </div>
</section>

<section id="reel" class="wrap">
  <div class="reel reveal">
    <div>
      <p class="kicker">&gt; play showreel.mp4</p>
      <h2>the whole thing in sixty seconds</h2>
      <p>your day, the on-device ai, reports, breaks, reminders and travel mode — with the sound on.</p>
      <a class="btn btn-sun" data-play-reel href="assets/daylens-showreel.mp4">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l12-7.5z"/></svg>
        watch with sound</a>
    </div>
    <div class="reel-media"><img src="assets/daylens-showreel-teaser.gif" alt="Highlights from the Daylens showreel" width="720" height="405" loading="lazy"></div>
  </div>
</section>

<section id="privacy" class="wrap">
  <div class="privacy reveal">
    <div>
      <p class="kicker">{ privacy }</p>
      <h2>no account. no cloud. yours.</h2>
      <p class="lede lede-left">everything is stored and understood on your pc. screen reading is opt-in, text only — never screenshots — and skips password managers, banking and private windows.</p>
    </div>
    <ul class="facts">
      <li><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/></svg><span><b>on-device ai.</b> the labeller and the report writer run locally.</span></li>
      <li><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12s3.5-6.5 9-6.5S21 12 21 12s-3.5 6.5-9 6.5S3 12 3 12z"/><path d="M4 20 20 4"/></svg><span><b>never screenshots.</b> only the text of the window in front, when you allow it.</span></li>
      <li><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V4.5h6V7M6 7l1 13h10l1-13"/></svg><span><b>delete it all, any time.</b> export or wipe your history in one click.</span></li>
    </ul>
  </div>
</section>

<section id="faq" class="wrap faq">
  <h2>questions, answered</h2>
  <div class="reveal">
    <details><summary>is it really free?</summary><p>yes. no account, no subscription, no ads.</p></details>
    <details><summary>does anything leave my pc?</summary><p>no. the optional cloud writer only turns on if you add your own api key, and it never receives screen text.</p></details>
    <details><summary>what do i need?</summary><p>windows 10 (1903 or later) or windows 11, 64-bit. 8 gb of ram or more for writing reports on your pc.</p></details>
    <details><summary>windows says it protected my pc?</summary><p>the installer isn't code-signed yet. choose more info, then run anyway.</p></details>
    <details><summary>mac?</summary><p>not yet — daylens is windows-only for now.</p></details>
  </div>
</section>
</main>

<footer>
  <div class="foot wrap">
    <h2>see your day clearly.</h2>
    <a class="btn btn-dark" data-download href="https://github.com/aaron-sequeira/Daylens/releases/latest/download/Daylens-Setup.exe">download for windows</a>
  </div>
  <p class="legal">
    <span>daylens 1.0.1 · made with ( ^ ω ^ ) for windows</span>
    <a href="https://github.com/aaron-sequeira/Daylens">github</a>
    <a href="#privacy">privacy</a>
  </p>
</footer>
</body>
</html>
```

- [ ] **Step 5: Write `website/styles.css`**

```css
@font-face { font-family: 'DM Sans'; src: url(assets/fonts/dm-sans.woff2) format('woff2'); font-weight: 100 1000; font-style: normal; font-display: swap; }
@font-face { font-family: 'DM Mono'; src: url(assets/fonts/dm-mono-400.woff2) format('woff2'); font-weight: 400; font-display: swap; }
@font-face { font-family: 'DM Mono'; src: url(assets/fonts/dm-mono-500.woff2) format('woff2'); font-weight: 500; font-display: swap; }

:root {
  --cream: #FBF8F4; --ink: #171717; --muted: #4b4642; --fine: #6b655f; --line: #e7dfd8;
  --lav: #D8D2FC; --mint: #BFEBD3; --pink: #F4C6C8; --peach: #F9DDB9; --sky: #CFE6FB;
  --sun: #F6B35E; --violet: #5b4bd6; --green: #2d6b54;
  --mono: 'DM Mono', ui-monospace, Consolas, monospace;
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0; font-family: 'DM Sans', system-ui, sans-serif; color: var(--ink); overflow-x: hidden;
  background: var(--cream) radial-gradient(var(--line) 1.2px, transparent 1.2px) 0 0 / 26px 26px;
  -webkit-font-smoothing: antialiased;
}
img { display: block; max-width: 100%; height: auto; }
a { color: inherit; }
a:focus-visible, summary:focus-visible, video:focus-visible { outline: 3px solid var(--violet); outline-offset: 3px; border-radius: 10px; }
.wrap { max-width: 1240px; margin: 0 auto; padding: 0 32px; }
.skip { position: absolute; left: -999px; top: 8px; z-index: 10; background: var(--ink); color: #fff; padding: 10px 16px; border-radius: 10px; }
.skip:focus { left: 8px; }

/* announcement strip */
.strip { display: flex; justify-content: center; align-items: center; gap: 12px; flex-wrap: wrap; text-align: center; text-decoration: none; background: var(--ink); color: var(--cream); padding: 11px 20px; font-family: var(--mono); font-size: 14px; }
.strip .pill { background: var(--cream); color: var(--ink); border-radius: 999px; padding: 4px 12px; }
.strip:hover .strip-text { text-decoration: underline; }

/* nav */
.nav { display: flex; align-items: center; justify-content: space-between; gap: 24px; flex-wrap: wrap; padding-top: 22px; padding-bottom: 22px; }
.brand { display: flex; align-items: center; gap: 10px; text-decoration: none; font-weight: 800; font-size: 22px; letter-spacing: -0.03em; }
.nav-links { display: flex; align-items: center; gap: 28px; font-size: 15px; }
.nav-links a { text-decoration: none; }
.nav-links a:not(.btn-pill):hover { color: var(--violet); }
.btn-pill { background: var(--ink); color: #fff; padding: 12px 20px; border-radius: 999px; font-weight: 700; }

/* hero */
.hero { text-align: center; padding-top: 40px; padding-bottom: 40px; }
.sunrise { display: block; width: 220px; height: auto; margin: 0 auto 26px; }
.sunrise path { stroke-dasharray: 1 2; stroke-dashoffset: 0; }
h1 { margin: 0 auto; max-width: 900px; font-size: clamp(46px, 7.4vw, 104px); line-height: 0.95; letter-spacing: -0.055em; font-weight: 800; }
.lede { margin: 26px auto 0; max-width: 600px; font-size: 20px; line-height: 1.5; color: var(--muted); }
.ctas { margin-top: 34px; display: flex; gap: 14px; justify-content: center; flex-wrap: wrap; }
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 12px; text-decoration: none; font-weight: 700; font-size: 18px; padding: 18px 28px; border-radius: 18px; transition: transform 0.2s ease, box-shadow 0.2s ease; }
.btn-dark { background: var(--ink); color: #fff; box-shadow: 0 6px 0 var(--violet); }
.btn-dark:hover { transform: translateY(2px); box-shadow: 0 4px 0 var(--violet); }
.btn-light { background: #fff; color: var(--ink); border: 2px solid var(--ink); }
.btn-light:hover { transform: translateY(-2px); }
.btn-sun { background: var(--sun); color: var(--ink); }
.btn-sun:hover { transform: translateY(-2px); }
.fine { margin: 16px 0 0; font-size: 14px; color: var(--fine); }

/* app windows */
.win { background: #fff; border: 2px solid var(--ink); border-radius: 18px; box-shadow: 8px 8px 0 var(--ink); overflow: hidden; transform: rotate(var(--r, 0deg)); transition: transform 0.25s ease, box-shadow 0.25s ease; }
.win:hover { transform: translate(-3px, -3px) rotate(var(--r, 0deg)); box-shadow: 11px 11px 0 var(--ink); }
.win-bar { display: flex; justify-content: space-between; align-items: center; gap: 12px; background: var(--bar, var(--lav)); border-bottom: 2px solid var(--ink); padding: 9px 14px; font-family: var(--mono); font-size: 12.5px; }
.win-ctl { letter-spacing: 5px; }
.stage { position: relative; max-width: 1000px; margin: 64px auto 0; }
.win-main { position: relative; z-index: 1; border-radius: 20px; box-shadow: 12px 12px 0 var(--ink); }
.float { position: absolute; z-index: 2; }
.win-reminder { left: -130px; top: 60px; width: 250px; --r: -6deg; }
.win-break { right: -120px; top: 250px; width: 230px; --r: 5deg; }
.sticker { position: absolute; right: -40px; top: -40px; z-index: 3; margin: 0; width: 118px; height: 118px; display: grid; place-items: center; text-align: center; background: var(--sun); border: 2px solid var(--ink); border-radius: 50%; font-weight: 800; font-size: 15px; line-height: 1.1; transform: rotate(8deg); }
.note { padding: 16px 18px; text-align: left; }
.note b { display: block; font-size: 17px; }
.note p { margin: 6px 0 12px; font-size: 14px; color: var(--muted); }
.chip { display: inline-block; background: var(--ink); color: #fff; border-radius: 999px; padding: 8px 14px; font-size: 13px; font-weight: 700; }

/* sections */
section { padding-top: 90px; padding-bottom: 90px; }
.kicker { margin: 0; font-family: var(--mono); font-size: 14px; color: var(--violet); }
h2 { margin: 10px 0 44px; max-width: 760px; font-size: clamp(34px, 4.6vw, 64px); line-height: 1; letter-spacing: -0.045em; font-weight: 800; }
.cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 28px; }
.card-body { padding: 26px; }
.card-body h3 { margin: 0 0 10px; font-size: 26px; letter-spacing: -0.03em; }
.card-body p { margin: 0; font-size: 16px; line-height: 1.55; color: var(--muted); }
.shots { margin-top: 60px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 28px; align-items: start; }
.shots .win { box-shadow: 10px 10px 0 var(--ink); }
.shots .win:nth-child(1) { --r: -1.2deg; }
.shots .win:nth-child(2) { --r: 1.4deg; margin-top: 60px; }

.reel { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 48px; align-items: center; background: var(--ink); color: var(--cream); border-radius: 28px; padding: 56px; }
.reel .kicker { color: var(--sun); }
.reel h2 { margin: 12px 0 16px; }
.reel p { margin: 0 0 26px; font-size: 18px; line-height: 1.55; color: #cfc8c1; }
.reel-media { aspect-ratio: 16 / 9; background: #000; border: 2px solid var(--cream); border-radius: 18px; overflow: hidden; box-shadow: 10px 10px 0 var(--sun); }
.reel-media img, .reel-media video { width: 100%; height: 100%; object-fit: cover; display: block; }

.privacy { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 56px; align-items: center; }
.privacy .kicker { color: var(--green); }
.privacy h2 { margin-bottom: 22px; }
.lede-left { margin: 0; max-width: none; font-size: 18px; line-height: 1.6; }
.facts { display: grid; gap: 16px; margin: 0; padding: 0; list-style: none; }
.facts li { display: flex; gap: 16px; align-items: center; background: #fff; border: 2px solid var(--ink); border-radius: 16px; padding: 20px 22px; box-shadow: 6px 6px 0 var(--ink); font-size: 17px; }
.facts svg { flex: none; }

.faq { max-width: 900px; padding-top: 20px; }
.faq h2 { margin: 0 auto 30px; text-align: center; }
.faq details { background: #fff; border: 2px solid var(--ink); border-radius: 16px; padding: 20px 24px; margin-bottom: 14px; }
.faq summary { display: flex; justify-content: space-between; gap: 16px; font-weight: 700; font-size: 19px; cursor: pointer; list-style: none; }
.faq summary::-webkit-details-marker { display: none; }
.faq summary::after { content: '+'; font-family: var(--mono); font-size: 22px; line-height: 1; transition: transform 0.2s ease; }
.faq details[open] summary::after { transform: rotate(45deg); }
.faq details p { margin: 12px 0 0; font-size: 16px; line-height: 1.55; color: var(--muted); }

footer { background: var(--sun); border-top: 2px solid var(--ink); }
.foot { display: flex; justify-content: space-between; align-items: center; gap: 32px; flex-wrap: wrap; padding-top: 70px; padding-bottom: 40px; }
.foot h2 { margin: 0; max-width: 640px; font-size: clamp(36px, 5vw, 72px); line-height: 0.95; letter-spacing: -0.05em; }
.foot .btn-dark { box-shadow: 0 6px 0 #fff; }
.legal { display: flex; justify-content: center; gap: 18px; flex-wrap: wrap; margin: 0; padding: 0 32px 30px; font-size: 13px; color: #3d2f1c; }

/* motion (only with JS; never hides content otherwise) */
.js .reveal { opacity: 0; transform: translateY(24px); transition: opacity 0.7s ease, transform 0.7s cubic-bezier(0.2, 0.8, 0.2, 1); }
.js .reveal.in { opacity: 1; transform: none; }
.js .sunrise path { animation: draw 1.1s cubic-bezier(0.65, 0, 0.35, 1) both; }
.js .sunrise .sun { animation-delay: 0.35s; }
.js .sunrise .rays { animation-delay: 0.8s; }
.sticker { animation: wobble 4s ease-in-out infinite; }
@keyframes draw { from { stroke-dashoffset: 1.001; } to { stroke-dashoffset: 0; } }
@keyframes wobble { 0%, 100% { transform: rotate(8deg); } 50% { transform: rotate(3deg) scale(1.04); } }

/* smaller screens */
@media (max-width: 1180px) {
  .win-reminder { left: -40px; }
  .win-break { right: -30px; }
  .sticker { right: -10px; }
}
@media (max-width: 900px) {
  .nav-links a:not(.btn-pill) { display: none; }
  .cards, .shots, .reel, .privacy { grid-template-columns: minmax(0, 1fr); }
  .shots .win:nth-child(2) { margin-top: 0; }
  .reel { padding: 32px; }
  .stage { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 22px; margin-top: 48px; }
  .win-main { grid-column: 1 / -1; order: -1; }
  .float { position: static; width: auto; }
  .sticker { right: -6px; top: -30px; width: 92px; height: 92px; font-size: 12px; }
  section { padding-top: 64px; padding-bottom: 64px; }
}
@media (max-width: 600px) {
  .wrap { padding: 0 18px; }
  .stage { grid-template-columns: minmax(0, 1fr); }
  .strip-text { display: none; }
  .lede { font-size: 18px; }
  .ctas .btn, .foot .btn { width: 100%; }
  .foot { padding-top: 50px; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; }
  .js .reveal { opacity: 1; transform: none; }
}
```

- [ ] **Step 6: Run the checker and confirm it passes**

Run: `CHECK_SITE_ALLOW_MISSING=main.js node scripts/check-site.mjs`
Expected: `check-site OK`, exit 0. (`main.js` is allowed to be missing until Task 2; `assets/og.png` is only referenced by an absolute `https://` URL, so the checker doesn't look for it.)

- [ ] **Step 7: Commit**

```bash
git add scripts/check-site.mjs website/index.html website/styles.css website/assets
git commit -m "feat(website): Daylens landing page (direction A) with static checks"
```

---

### Task 2: Motion, the showreel player, the render check and the share image

**Files:**
- Create: `website/main.js`
- Create: `scripts/check-site-render.cjs`
- Create: `website/assets/og.png` (generated)

**Interfaces:**
- Consumes: `.reveal` containers, the `[data-play-reel]` link (href = MP4 path) and `.reel-media` from Task 1's `index.html`; the `.js` class set by the inline head script.
- Produces: `node_modules/electron/dist/electron.exe scripts/check-site-render.cjs <outDir> [--og]`. It exits 0 when no width has horizontal scroll, writes `desktop.png` and `phone.png` to `<outDir>`, and with `--og` also writes `website/assets/og.png`.

- [ ] **Step 1: Write the render check (the failing test)**

Create `scripts/check-site-render.cjs`:

```js
// Renders website/index.html headless (Electron offscreen) at desktop and phone widths: fails if either width
// scrolls sideways, saves full-page screenshots to <outDir>, and with --og writes the 1200×630 share image.
// Run: node_modules/electron/dist/electron.exe scripts/check-site-render.cjs <outDir> [--og]
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2).filter((a) => !a.startsWith('--') && !a.endsWith('.cjs'));
const outDir = args[args.length - 1];
const wantOg = process.argv.includes('--og');
const page = path.join(__dirname, '..', 'website', 'index.html');
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.disableHardwareAcceleration();

function paint(win, minHeight) {
  return new Promise((resolve) => {
    const onPaint = (_e, _dirty, img) => {
      if (!img.isEmpty() && img.getSize().height >= minHeight) { win.webContents.off('paint', onPaint); resolve(img); }
    };
    win.webContents.on('paint', onPaint);
    win.webContents.invalidate();
  });
}

async function render(width, name) {
  const win = new BrowserWindow({ width, height: 900, show: false, enableLargerThanScreen: true, webPreferences: { offscreen: true } });
  await win.loadFile(page);
  const m = await win.webContents.executeJavaScript(
    'document.fonts.ready.then(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, sh: document.documentElement.scrollHeight }))');
  const ok = m.sw <= m.iw;
  console.log(`${name} ${m.iw}px: scrollWidth ${m.sw} → ${ok ? 'OK' : 'HORIZONTAL SCROLL'}`);
  const full = Math.min(m.sh, 9000);
  win.setSize(width, full);
  await new Promise((r) => setTimeout(r, 1600)); // reveals and the sunrise finish
  fs.writeFileSync(path.join(outDir, `${name}.png`), (await paint(win, Math.min(full, 1000))).toPNG());
  win.destroy();
  return ok;
}

async function og() {
  const win = new BrowserWindow({ width: 1200, height: 630, show: false, webPreferences: { offscreen: true } });
  await win.loadFile(page);
  await win.webContents.executeJavaScript('document.fonts.ready');
  await new Promise((r) => setTimeout(r, 2000));
  fs.writeFileSync(path.join(__dirname, '..', 'website', 'assets', 'og.png'), (await paint(win, 630)).toPNG());
  win.destroy();
  console.log('wrote website/assets/og.png');
}

app.whenReady().then(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const results = [await render(1440, 'desktop'), await render(390, 'phone')];
  if (wantOg) await og();
  app.exit(results.every(Boolean) ? 0 : 1);
});
```

- [ ] **Step 2: Run the static checker without the allowance and confirm it fails**

Run: `node scripts/check-site.mjs`
Expected: exit 1 with `✗ missing file: main.js`.

- [ ] **Step 3: Write `website/main.js`**

```js
// Motion and the showreel player. The page is complete without this file: .reveal only hides content once the
// inline head script has added the .js class, and the reel link falls back to opening the MP4 directly.
(() => {
  const reveals = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }, { rootMargin: '0px 0px -8% 0px' });
    reveals.forEach((el) => io.observe(el));
  } else {
    reveals.forEach((el) => el.classList.add('in'));
  }

  const play = document.querySelector('[data-play-reel]');
  const media = document.querySelector('.reel-media');
  if (play && media) {
    play.addEventListener('click', (ev) => {
      ev.preventDefault();
      const video = document.createElement('video');
      video.src = play.getAttribute('href');
      video.controls = true;
      video.playsInline = true;
      video.setAttribute('aria-label', 'Daylens showreel');
      media.replaceChildren(video);
      video.focus();
      video.play().catch(() => {}); // autoplay refused: the controls are there to press play
    }, { once: true });
  }
})();
```

- [ ] **Step 4: Run both checks and generate the share image**

Run:
```bash
node scripts/check-site.mjs
node_modules/electron/dist/electron.exe scripts/check-site-render.cjs "$TEMP/daylens-site" --og
```
Expected: `check-site OK`, then `desktop 1440px: scrollWidth 1440 → OK`, `phone 390px: scrollWidth 390 → OK` and `wrote website/assets/og.png`, with exit 0.

Then open `desktop.png` and `phone.png` from `$TEMP/daylens-site`, plus `website/assets/og.png`, and compare them against mockup A:
- sunrise above the headline, the release strip on top, and the floating windows beside the hero on desktop;
- on phone, the windows stacked under the screenshot, with nothing cut off;
- the share image shows the strip, the nav, the sunrise and the headline.

- [ ] **Step 5: Commit**

```bash
git add website/main.js scripts/check-site-render.cjs website/assets/og.png
git commit -m "feat(website): scroll reveals, sunrise draw-in, showreel player, render check and share image"
```

---

### Task 3: Deploy — workflow, stable installer name, Pages, and the live check

**Files:**
- Create: `.github/workflows/pages.yml`
- Create: `apps/consumer/scripts/stable-installer.mjs`
- Modify: `apps/consumer/package.json` (the `dist` script)
- Modify: `README.md` (add the website link under the badges)

**Interfaces:**
- Consumes: `node scripts/check-site.mjs` (CI gate) and the whole `website/` folder.
- Produces: `https://aaron-sequeira.github.io/Daylens/`, plus a `Daylens-Setup.exe` asset on every release (v1.0.1 now, later ones via `pnpm dist`).

- [ ] **Step 1: Confirm the current major versions of the Pages actions**

Run:
```bash
for a in checkout configure-pages upload-pages-artifact deploy-pages; do printf "%s " $a; gh api repos/actions/$a/releases/latest --jq .tag_name; done
```
Use the major version each prints (for example `v4`) in the workflow below. The versions shown in Step 2 are what's expected; if a newer major version is printed, use that one.

- [ ] **Step 2: Write `.github/workflows/pages.yml`**

```yaml
name: Deploy website

on:
  push:
    branches: [main]
    paths: ['website/**', 'scripts/check-site.mjs', '.github/workflows/pages.yml']
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - name: Check the site
        run: node scripts/check-site.mjs
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: website
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 3: Give every future release the stable installer name**

Create `apps/consumer/scripts/stable-installer.mjs`:

```js
// The website's download buttons point at releases/latest/download/Daylens-Setup.exe, so each release also
// carries an unversioned copy of the installer. This makes that copy next to the versioned one.
import { copyFileSync, readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
copyFileSync(new URL(`../release/Daylens-Setup-${version}.exe`, import.meta.url), new URL('../release/Daylens-Setup.exe', import.meta.url));
console.log(`[stable-installer] release/Daylens-Setup.exe ← Daylens-Setup-${version}.exe`);
```

In `apps/consumer/package.json`, append ` && node scripts/stable-installer.mjs` to the end of the `dist` script (after `node scripts/check-build.mjs`).

Run: `cd apps/consumer && node scripts/stable-installer.mjs && ls -la release/Daylens-Setup*.exe`
Expected: `release/Daylens-Setup.exe` exists with the same size as `release/Daylens-Setup-1.0.1.exe` (184,280,381 bytes).

- [ ] **Step 4: Upload the stable copy to v1.0.1 and confirm the download URL works**

```bash
gh release upload v1.0.1 apps/consumer/release/Daylens-Setup.exe --repo aaron-sequeira/Daylens
curl -sIL -o /dev/null -w "%{http_code} %{size_download}\n" https://github.com/aaron-sequeira/Daylens/releases/latest/download/Daylens-Setup.exe
```
Expected: the upload succeeds and curl prints `200`.

- [ ] **Step 5: Add the website link to the README**

In `README.md`, directly under the line holding the `Download-v1.0.1` badge, add:

```markdown
**[daylens website →](https://aaron-sequeira.github.io/Daylens/)**
```

- [ ] **Step 6: Run the app tests (the dist script changed)**

Run (from `apps/consumer`): `ELECTRON_RUN_AS_NODE=1 ../../node_modules/electron/dist/electron.exe ../../node_modules/vitest/vitest.mjs run`
Expected: all test files pass (800 tests at the time of writing, 3 skipped).

- [ ] **Step 7: Commit, turn on Pages and push**

```bash
git add .github/workflows/pages.yml apps/consumer/scripts/stable-installer.mjs apps/consumer/package.json README.md
git commit -m "ci(website): deploy website/ to GitHub Pages; stable Daylens-Setup.exe on releases"
gh api -X POST repos/aaron-sequeira/Daylens/pages -f build_type=workflow
git push origin main
```
Expected: the Pages API returns JSON with `"build_type": "workflow"`, and the push succeeds. If Pages already exists, the POST returns 409; then run `gh api -X PUT repos/aaron-sequeira/Daylens/pages -f build_type=workflow`.

- [ ] **Step 8: Watch the deploy and check the live site**

```bash
gh run watch --repo aaron-sequeira/Daylens --exit-status $(gh run list --repo aaron-sequeira/Daylens --workflow pages.yml --limit 1 --json databaseId --jq '.[0].databaseId')
for p in "" styles.css main.js assets/og.png assets/daylens-today.png assets/fonts/dm-sans.woff2 assets/daylens-showreel.mp4; do
  printf "%s " "${p:-index}"; curl -s -o /dev/null -w "%{http_code}\n" "https://aaron-sequeira.github.io/Daylens/$p"
done
```
Expected: the run finishes green, and every line prints `200`.
