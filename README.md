# Visionary

A routine and focus ecosystem: a living day horizon with minute-precise blocks, natural-language scheduling and a booking agent, five-minute micro-steps with streak grace, deep-work sessions with a distraction shield, 30-second reflections and pattern analytics.

**Stack:** static HTML/CSS/JS (`// @ts-check` + JSDoc) on Vercel · Supabase (Postgres with RLS, Auth, Edge Functions) · Anthropic Claude for AI features, with local fallbacks for every mode.

Full engineering notes (every release, schema, decisions, operations): [docs/ENGINEERING_NOTES.md](docs/ENGINEERING_NOTES.md), also rendered at `/studio-notes` for admins.

## Project structure

```
index.html              App (sign-in + planner)
book.html               Public booking page (/book?u=slug)
studio-notes.html       Engineering notes for admins (built from docs/)
privacy.html            Privacy Policy
terms.html              Terms of Service
404.html                Custom not-found page
studio.html             Studio: site editor dashboard (admins only)
css/                    style.css (design system), fonts.css (self-hosted fonts)
js/
  theme-init.js         Applies theme before first paint
  config.js             Public client config (no secrets)
  auth.js               Sign-in, sign-up, reset, lockout, validation
  parse.js              Natural-language command + schedule-text parser
  scheduler.js          Free-slot search, ranking, smart buffers
  momentum.js           Streak grace, nudges, local micro-steps
  shield.js             Ambient audio (Web Audio) + full-screen focus
  app.js                Planner, horizon, focus, patterns, AI, demo mode
  stopwatch.js          Independent stopwatch
  booking.js / book.js  Booking links (owner side / public page)
  account.js            Password change, sessions, export, delete account
  consent.js            Cookie banner + consent-gated analytics
  env.js                Public settings shared by every page
  site-content.js       Loads published page edits + the in-page visual editor
  studio.js             Studio dashboard
vendor/                 Pinned, self-hosted supabase-js and Chart.js
assets/                 Icons, fonts, social preview image
supabase/
  functions/_shared/    Origin allowlist, size limits, auth, security logging
  functions/ai-suggest/ AI suggestions, insights, schedule scan/text, micro-steps
  functions/account/    Account deletion
  migrations/           RLS, grants, sanitisation, AI quotas, security log
tools/                  Page builders (studio, notes, book, legal) + local server
vercel.json             Security headers, caching, clean URLs, redirects
SECURITY.md             Security model + required dashboard settings
docs/ENGINEERING_NOTES.md  Everything built, decided and left to do
docs/payments.md        Rules for adding payments later
```

## Run locally

```bash
python3 tools/serve.py        # open http://localhost:8000/ (clean URLs like /book and /studio work)
```

Use **Explore the demo** on the sign-in screen to try everything without an account.

## Editing the site (Studio)

Sign in with an admin account, open **Account → Open Studio** (or go to `/studio`), and pick a page. You can also add `?edit` to any page URL.

- Click any text and type. The toolbar adds bold, italic, links, headings and bullet lists.
- Hover a block to drag it, move it up or down, add a new one below, duplicate it or delete it.
- **Publish** (or Ctrl/Cmd+S) makes changes live for everyone. **History** restores earlier versions; **Restore original** brings back the text from the code.
- Try it without an account on your computer: `http://localhost:8000/privacy?edit&local=1` (changes stay in that browser).

## Deploy

1. Push to `main` — Vercel deploys the static site.
2. Run the SQL migration and deploy the edge functions — see [SECURITY.md](SECURITY.md).

## Release notes

### 5.0 — Visionary OS
- Minute-precise blocks with length and people; the horizon draws duration arcs; drag to the timeline snaps to 5 minutes.
- Quick actions understand "gym with Aryan at 6pm for 45 min", "deep work from 9 to 11", and "find 30 minutes next Tuesday after discrete math".
- Paste a syllabus or drop a screenshot anywhere to import a schedule; overlaps are resolved.
- Micro-steps (AI or local), Momentum Grace for streaks, quiet data-backed nudges, smart buffers.
- Focus sessions synced to the cloud, session journal, ambient rain/brown/wind, full-screen focus; stopwatch runs are saved.
- Private booking links (`/book?u=…`) that show free slots only; accept requests onto your horizon.
- New Patterns charts: energy by task type, follow-through by hour, focused time, grace days.
- Database: `supabase/migrations/20261027000000_visionary_os.sql` (additive). Edge function: new `schedule-text` and `breakdown` modes.

### Phone-style clocks
- Timer: choose hours, minutes and seconds, from 00:00:01 to 99:59:59.
- Stopwatch: independent start, pause, resume, reset and up to 100 recent laps.
- Switching modes leaves clocks running; signing out stops both. Keep the page open: running clocks and laps do not survive reloads.
- Countdown completion is checked against a timestamp, not counted interval ticks. Browser background suspension can delay the completion sound until the page resumes.

### 4.1 — Trust & polish
- New Privacy Policy and Terms of Service, cookie consent banner, custom 404 page.
- Account center: change password (signs out other devices), sign out everywhere, download your data, delete your account.
- Password reset with expiring links, clear error messages that don't reveal whether an email is registered, temporary lockout after repeated failed sign-ins, honeypot + optional Turnstile CAPTCHA.
- Server hardening: Row Level Security, origin allowlist, request size limits, per-user AI quotas, image type checks, prompt-injection defenses, security event log.
- Strict security headers (CSP, HSTS, frame blocking), self-hosted fonts and libraries, lazy-loaded charts.
- SEO: page titles and descriptions, social preview image, favicons, web app manifest, sitemap and robots.txt.
- WCAG AA color contrast in both themes, keyboard focus styles, tablet-friendly layouts.

### 4.0 — Horizon
- Redesign, day horizon, focus sessions, schedule scan with review, patterns heatmap, command palette, demo mode.
