# Daylens website — design

**Date:** 2026-09-30 · **Status:** draft for review

## Goal

Build a public marketing site that presents Daylens and gets people to download it. Success means a visitor understands what Daylens does within one screen, can see the real app, trusts the privacy story, and reaches a working Windows download in one click.

**Audience:** Windows 10/11 users who care about screen time, focus and healthy habits, and who may be wary of cloud tracking apps.

## Decisions already made

- **Look:** direction **A · Desktop buddy** from the mockups (https://claude.ai/artifact/TW7P3Y1PMiTRy1SgJrFPTY, artboard `Main.dc.html`). It is inspired by heyclicky.com: app-window frames with thick outlines and hard shadows, tilted stickers, lowercase playful copy, and text faces like `( ^ ω ^ )`.
- **Hero art:** the hand-drawn sunrise (orange sun and rays over a black wavy horizon) sits above the headline, not the app-icon tile.
- **Release pill:** "( ˘ ᵕ ˘ ) new · v1.0.1 is out" lives in a slim black announcement strip above the navigation and links to the release notes.
- **Hosting:** GitHub Pages, deployed by GitHub Actions from the `aaron-sequeira/Daylens` repo, which must be **public** (free Pages requires it). No separate organisation or repo.
- **Address:** `https://aaron-sequeira.github.io/Daylens/` to start. A custom domain can be added later with a `CNAME` file plus DNS, with no code changes.

## Page structure (top to bottom)

1. **Announcement strip.** Release pill plus a one-line summary, linking to the GitHub release page for the current version.
2. **Nav.** Logo tile + "daylens" wordmark; links to what it does, privacy, faq; a black "download" pill.
3. **Hero.**
   - Hand-drawn sunrise, then the headline "a little sun that lives on your pc" and a short sub-line.
   - Two buttons: **download for windows** (primary) and **watch the 60s reel** (secondary).
   - A small line under them: "free · windows 10 & 11 · no account".
   - The Today screenshot in a lavender app window, with a tilted "water o'clock" reminder window, a tilted break-screen window and a round "100% on your pc" sticker around it.
4. **What it does.**
   - Three window cards: knows where the day went · writes your report · nudges you to breathe.
   - Below them, two tilted windows showing the Insights and Reminders screenshots.
5. **Showreel.** A dark panel with the teaser GIF and a "watch with sound" button that plays the full MP4 in a `<video controls>` element (poster = first frame; the file loads only when played).
6. **Privacy.** "no account. no cloud. yours." plus three statement cards (on-device ai, never screenshots, delete it all).
7. **FAQ.** Native `<details>`: is it free · does anything leave my pc · what do i need · mac? The Mac answer says "windows first" with no waitlist link until one exists.
8. **Footer CTA.** Sun-orange band: "see your day clearly." with a download button, a version line, and links to GitHub and the privacy section.

Copy stays true to the app: no invented stats, users, ratings or testimonials.

## Download link

- Every download button points to `https://github.com/aaron-sequeira/Daylens/releases/latest/download/Daylens-Setup.exe`.
- Each release therefore also gets a copy of the installer under the fixed name **`Daylens-Setup.exe`**, beside the versioned file, so the link never goes stale.
- For v1.0.1 that copy is uploaded when the site ships.
- The version shown on the page (strip, footer) is plain text, updated by hand with each release (ponytail: one string in two places; automate if releases become frequent).

## Technology

- **Plain static files** in `website/`: `index.html`, `styles.css`, a small `main.js`, and `assets/`. No framework, no build step, no dependencies.
- **Fonts:** DM Sans and DM Mono, self-hosted as woff2 from `@fontsource-variable/dm-sans` (already in the repo) plus DM Mono. No Google Fonts request, which fits the privacy story.
- **Assets:** copied into `website/assets/`: the four screenshots from `docs/images/`, the logo SVG, the teaser GIF and the web MP4 from `docs/media/`, and a favicon from the logo.
- **Motion:** light and CSS-only where possible.
  - Windows lift on hover.
  - Sections fade and rise in as they scroll into view (IntersectionObserver in `main.js`).
  - The sunrise draws itself on load.
  - All motion is off under `prefers-reduced-motion`.
- **Responsive:** the desktop layout matches the mockup at 1440 px. Below about 900 px the grids stack to one column, the floating windows and sticker tuck under the hero screenshot instead of hanging off its sides, and the nav collapses to logo + download.
- **SEO and sharing:** `<title>`, meta description, Open Graph and Twitter card tags with a 1200×630 share image rendered from the hero, `lang="en"`, and a canonical URL.
- **Accessibility:** real links and buttons, alt text on every screenshot, visible focus rings, text contrast at least 4.5:1, and the decorative sunrise marked `aria-hidden`.

## Deployment

- A workflow `.github/workflows/pages.yml` runs on pushes to `main` that touch `website/**` (and manually).
- It uses the official `actions/configure-pages`, `actions/upload-pages-artifact` (path `website/`) and `actions/deploy-pages`.
- Pages is switched on with source "GitHub Actions" via `gh api`.
- There are no secrets and no third-party actions.

## Testing

- Render the page headless at 1440×900 and 390×844 and compare against the mockup; check there is no horizontal scroll on mobile.
- Check every link resolves: download URL after the stable asset is uploaded, release notes, GitHub, and in-page anchors.
- Check the video plays and the page works with JavaScript off (content visible, only the scroll animations missing).
- After the first deploy, fetch the live URL and confirm it returns 200 and the assets load.

## Out of scope

Analytics, a blog, a changelog page, a Mac waitlist form, localisation, and a custom domain purchase.

## Prerequisite (user)

- Make `aaron-sequeira/Daylens` public (Settings → General → Danger Zone → Change visibility).
- Until then, Pages can't publish and the download link returns 404 for visitors.
