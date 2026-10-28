# Visionary — Engineering Notes

Everything that has been built, changed, decided and left to do, in one place. This file is the source of truth; `/studio-notes` is generated from it by `tools/build_notes.py` so the same notes are readable inside the Studio admin area.

Conventions: dates are release dates; commit hashes refer to `main` on `github.com/llm24-bot/Visionary`. "Manual step" means something that has to be done in a dashboard or terminal, not by pushing code.

---

## 1. What Visionary is

A routine and focus app that merges three ideas:

- **The living day horizon** — the day as an arc the sun travels along, with blocks placed to the minute, natural-language quick actions, and schedule import from text or screenshots.
- **Autonomous scheduling** — a booking agent that finds free time in plain English, smart buffers between deep work and meetings, and private booking links that expose only free/busy.
- **Momentum engineering** — five-minute micro-steps for intimidating tasks, Momentum Grace so a chaotic day doesn't break a streak, and quiet, data-backed nudges.

Plus deep-work focus sessions (timer, stopwatch, ambient audio, full-screen mode, session journal), a 30-second end-of-day reflection, and pattern analytics (26-week heatmap, category mix, energy by task type, follow-through by hour).

## 2. Stack and why it stayed this way

| Layer | Choice | Reason |
|---|---|---|
| Front end | Static HTML, CSS and vanilla JavaScript with `// @ts-check` + JSDoc types | The deployed app, auth flow, Studio editor, consent system and CSP were all built on this. A rewrite to React/Next.js would have thrown away working, audited code and re-opened every security review for no user-visible gain. Type safety comes from `@ts-check` and `jsconfig.json` (editors run the TypeScript checker on plain JS). |
| Styling | One hand-written design system in `css/style.css` (+ `css/clock.css`) with CSS custom properties | Dark-mode-first, Satoshi (UI) and Instrument Serif (display) self-hosted in `assets/fonts`. No Tailwind: a utility framework would need a build step and the design tokens already exist. |
| Charts / timeline | Hand-rolled SVG for the horizon and timeline; Chart.js (self-hosted, lazy-loaded) for analytics | SVG gives full control of the arc and drag-and-drop; Chart.js loads only when Patterns opens. |
| Backend | Supabase — Postgres with Row Level Security, Auth, Edge Functions (Deno) | One hosted Postgres, auth and serverless in one place. Every table is `auth.uid() = user_id`. |
| AI | Anthropic Claude via the `ai-suggest` edge function | The API key never reaches the browser. Every AI mode has a local fallback so the app works offline or over quota. |
| Hosting | Vercel (static) | `vercel.json` sets strict security headers, caching, clean URLs and redirects. |
| Offline / local-first | Demo mode runs entirely in memory; focus sessions and settings are mirrored to `localStorage` and synced to the cloud when available | Legacy-schema fallbacks keep older databases working: if an insert fails with a "column … does not exist" error, the client retries without the new columns and tells the user to run the latest migration. |

## 3. Repository map

```
index.html              App shell: sign-in, Today, Focus, History, Patterns, all modals
book.html               Public booking page (/book?u=slug) — built by tools/build_book.py
studio.html             Studio admin dashboard — built by tools/build_studio.py
studio-notes.html       This document, rendered — built by tools/build_notes.py
privacy.html, terms.html, 404.html   Built by tools/build_privacy.py / build_terms.py / build_404.py
css/style.css           Design system, app layout, all components
css/clock.css           Timer picker + stopwatch
js/theme-init.js        Applies theme before first paint
js/env.js               Public settings (Supabase URL, publishable key, owner email)
js/config.js            Creates the Supabase client
js/auth.js              Sign-in, sign-up, reset, lockout, Turnstile hook
js/parse.js             VisionaryParse — natural-language command + schedule-text parser
js/scheduler.js         VisionaryScheduler — busy intervals, free slots, ranking, buffers
js/momentum.js          VisionaryMomentum — grace rules, nudges, local micro-steps
js/shield.js            VisionaryShield — Web Audio ambient generator + full-screen focus
js/app.js               Planner: state, data layer, demo DB, horizon, timeline, focus, analytics, palette, import, AI
js/stopwatch.js         Independent timestamp-based stopwatch (logs sessions ≥ 1 min)
js/booking.js           Owner side of booking links (create/edit, requests, accept/decline)
js/book.js              Visitor side of booking links (availability, request form)
js/account.js           Account modal: password, sessions, export, delete, Studio access
js/consent.js           Cookie banner + consent-gated analytics
js/site-content.js      Loads published page edits + in-page visual editor (?edit)
js/studio.js            Studio dashboard
vendor/                 Pinned supabase-js 2.117.2 and Chart.js 4.4.0
supabase/functions/_shared/security.ts   Origin allowlist, size limits, auth, logging
supabase/functions/ai-suggest/           next-action, insight, schedule-import, schedule-text, breakdown
supabase/functions/account/              Account deletion
supabase/migrations/    20260928000000_security_hardening.sql
                        20260928010000_site_editor.sql
                        20261027000000_visionary_os.sql
tools/                  Page builders, local dev server (python3 tools/serve.py → :8000)
docs/                   ENGINEERING_NOTES.md (this file), payments.md
```

## 4. Release history

### 5.0.1 — Hardening pass · 2026-10-27

A review of 5.0 before the migration was run in production. Everything here is backwards compatible.

**Database (`20261027000000_visionary_os.sql`, same file, re-runnable)**
- Section 0 now creates `vn_clean_text` if it is missing, so the file runs on its own (it used to assume the 4.1 migration had been applied).
- `vn_sanitize_task` also nulls `scheduled_minute` when `scheduled_hour` is null, rejects a task that is its own parent, and rejects a `parent_id` that belongs to another user. The trigger is dropped and recreated so re-running the file is safe.
- `public_availability` treats completed tasks as busy too (a finished block still occupied that time) and widens its query window by a day on each side so timezone offsets never drop a day.
- `request_booking` validates the slot server-side before touching rate limits: it must fall on an allowed weekday, inside the page's start/end hours (in the owner's timezone), on a 5-minute boundary, and must not collide with the owner's existing tasks plus buffer. Previously only the client enforced this.

**Client**
- Buffer routing actually fires now. The main input used to ignore the parser's category guess (the "Focus" chip always won), so "run" or "gym" never counted as a health block. The guess now wins until the user clicks a chip. When a deep-work block and a health/rest block are back to back, the new task is nudged by the buffer length and the buffer is inserted in the gap; the toast explains the move. Existing buffers are never duplicated.
- The "Added" toast reports the final time (after any nudge) and warns when the new block overlaps something already on the timeline.
- `scheduleTask` takes a `silent` option so the buffer router cannot recurse into itself.
- Changing a task's length on a pre-5.0 database shows the setup hint instead of a generic error.
- Account gains a **Setup** card that appears only when the app detects the database is behind (minute-level time, length or micro-step writes fall back). It lists the three manual steps.
- Account → Export now includes `focus_sessions`, `booking_pages` and `booking_requests` (skipped quietly on older databases).

**QA**: `/home/user/qa7.mjs` covers the buffer flow (nudge, insert, no duplicate, overlap warning), time inputs, History and the Setup card; the PGlite migration test adds weekend, off-hours, task-clash and foreign-parent cases plus a standalone run of the 5.0 file alone.

### 5.0 — "Visionary OS" · 2026-10-27

The big one. Goal: merge the three product ideas above without breaking anything that already worked.

**Time engine**
- Tasks now carry `scheduled_minute`, `duration_min`, `kind` (`task` | `microstep` | `buffer` | `booking`), `people`, `note` and `parent_id`. Everything is additive; old rows read as "top of the hour, 60 minutes, kind task".
- The horizon draws duration arcs (`.task-span`) along the day, not just dots. Buffers are dashed.
- The timeline is minute-precise: dropping a task snaps to 5 minutes; each task has a time input (5-minute step) and a length picker.
- `Ctrl/Cmd+K` understands "gym with Aryan at 6pm for 45 mins", "deep work on C++ compiler from 9am to 11am", "tomorrow", weekday names, "after lunch", categories by keyword.
- Schedule import: paste text (syllabus, class list, meeting notes) → AI `schedule-text` mode → local parser fallback. Drop a screenshot anywhere on the app or paste one from the clipboard. Import rows now have minute and length. Overlapping imports are nudged to the next free 15-minute boundary.

**Autonomous scheduling**
- "find 30 minutes next Tuesday after discrete math" in the palette: the scheduler loads that day's blocks, removes the hours before the named anchor, ranks free slots by the user's historical follow-through per hour (`VisionaryScheduler.hourScores`) and preferred part of day, and offers up to three. Picking one creates the block.
- Smart buffers: when a deep-work block (focus/learn/build) sits next to a social/health/meeting block, a `buffer` row is inserted between them. Buffer length comes from the last seven days of energy (`bufferLength`): low energy → longer buffers. Toggle in Account → Assistant.
- Booking links: `booking_pages` (one per user; slug, title, length, buffer, hours, days, horizon, time zone, on/off) and `booking_requests`. Two security-definer RPCs for visitors: `public_availability(slug, from, to)` returns settings and busy intervals only — never titles, notes or people — and `request_booking(...)` which is rate-limited (20 per page per hour, 3 per email per day), checks the horizon window and clashes, and sanitises inputs. Owners accept (creates a `booking` block on their horizon) or decline from Account → Booking link. Public page: `/book?u=slug`, noindex, works with no account.

**Momentum**
- Micro-steps: the steps button on any task asks the AI (`breakdown` mode) for 3–7 five-minute steps, falling back to templates in `VisionaryMomentum.localMicroSteps`. Steps are real tasks with `kind = 'microstep'` and `parent_id`; completing them all completes the parent, un-completing one re-opens it.
- Momentum Grace: `checkStreak(reflected)` — a day counts if every top-level task is done, or if the user reflected / finished at least one task (a "grace day", stored as `profiles.grace_days`, `last_grace_date`, `reflections.grace`). The streak stat shows "Saved by grace" when that happened today.
- Nudges: `computeNudges` looks at focus sessions (where sessions on a category stop early), reflections (energy dips by weekday), and overdue blocks, and shows at most one quiet card per hour in the Today view with a one-click action (shorter timer, suggest, break down, reflect). Dismissals are remembered for three days. Toggle in Account → Assistant.

**Deep work**
- Focus sessions (timer and stopwatch) are written to `focus_sessions` and mirrored locally; the Focus view shows today and the last seven days.
- Finishing a timer checks the linked task off (existing) and now opens a session journal (one optional note, stored on the session).
- Distraction shield: ambient rain / brown noise / wind synthesised with the Web Audio API (no audio files, nothing downloaded), and a full-screen focus mode that hides everything except the dial (`body.zen`, Escape exits).
- The stopwatch logs a session when reset after a run of a minute or more.

**Intelligence**
- Patterns adds "Energy by task type", "Follow-through by hour" (from the last 26 weeks of scheduled tasks), focused time and grace-day summaries, next to the existing heatmap, completion, category mix and energy/focus charts.
- Reflection sets the grace flag and the AI insight prompt now sees focus minutes.

**Engineering**
- `// @ts-check` + JSDoc on the new modules and `app.js`; `jsconfig.json` with `checkJs` so editors type-check plain JS.
- The demo DB gained `neq/gte/lte/in/is/limit/maybeSingle`, cascade delete of micro-steps, and sample `focus_sessions`, `booking_pages`, `booking_requests`.
- Page builders moved into the repo (`tools/`).

**Manual steps for 5.0**
1. Supabase → SQL Editor → paste `supabase/migrations/20261027000000_visionary_os.sql` → Run (idempotent; tested against a clean copy of the earlier schema).
2. `supabase functions deploy ai-suggest` (new modes `schedule-text`, `breakdown`; optional secret `AI_DAILY_LIMIT_BREAKDOWN`, default 20).
3. Nothing to change in Vercel.

### Timer and stopwatch · 2026-09-29 · `f75e3ed`
- Phone-style picker: hours, minutes and seconds (00:00:01–99:59:59), remembered per browser.
- Independent stopwatch with pause/resume, reset and up to 100 laps, timestamp-based so it never drifts.
- Switching modes leaves clocks running; signing out stops both.

### Focus length, full-width horizon, sidebar fixes · 2026-09-29 · `f8a7bc4`
- Custom focus length (any minute, not presets); the dial and task completion follow it.
- Day horizon spans the full card width; alignment bug reported with a screenshot fixed.
- Studio link visible in the sidebar for admins and in Account; `refreshStudioAccess` runs after sign-in.
- Fixed a duplicate `focus-minutes` id that broke the stat display.

### Studio — visual site editor · 2026-09-29 · `017cec9`
- `/studio` dashboard plus `?edit` on any page: click text to edit, drag blocks to reorder, add/duplicate/delete, Publish (Ctrl/Cmd+S), History with restore, Restore original.
- Database: `site_admins`, `site_content`, `site_content_history`, `is_site_admin()` RPC, strict HTML allowlist check in Postgres, every change versioned and logged to `security_events`. Admins can't be added from the browser.
- Migration `20260928010000_site_editor.sql` makes `louisl4764@gmail.com` the first admin.
- Lesson: Studio appeared "missing" until that migration was run; the Account modal now explains this.

### Demo resets every time · 2026-09-29 · `3463267`
- Demo mode moved to an in-memory database seeded deterministically (`seedDemoData`) so every visit starts from the same sample data. Nothing from the demo is persisted.

### 4.1 — Trust and polish · 2026-09-28 · `0973ddb`
A 40-item legal, security, SEO and accessibility pass:
- Privacy Policy, Terms of Service, cookie consent banner (consent-gated analytics), custom 404, `security.txt`.
- Account center: change password (signs out other devices), sign out everywhere, download your data (JSON), delete account (edge function).
- Auth: password reset with expiring links, uniform messages that don't reveal whether an email exists, client lockout after 5 failures, honeypot, optional Turnstile.
- Server: RLS on every table, `anon` has no table privileges, origin allowlist and body size caps in edge functions, per-user AI quotas (`consume_ai_quota`), magic-byte image checks, prompt-injection defences, `security_events` log with salted IP hashes.
- Headers: strict CSP (`script-src 'self'`), HSTS preload, frame blocking, Referrer-Policy, Permissions-Policy. All fonts and libraries self-hosted; Chart.js lazy-loaded.
- SEO: titles, descriptions, OG image, favicons, manifest, sitemap, robots.
- WCAG AA contrast in both themes, focus styles, tablet layouts.
- Migration `20260928000000_security_hardening.sql`.

### 4.0 — Horizon · 2026-09-24 · `6ef75a3`
- Full redesign: dark-first design system, Satoshi + Instrument Serif, grain and glow backdrop.
- Day horizon arc with a sun that tracks the time; timeline with drag-and-drop.
- Focus sessions tied to tasks; schedule scan (image → AI → review list → import); 26-week patterns heatmap; command palette; demo mode; What's new modal.

### Before 4.0 (April–May 2026)
- v0 → v3: timeline, categories, drag-and-drop, AI panel, end-of-day reflection, analytics, light/dark theme.
- Supabase auth and cloud sync for tasks, reflections and profile; History view with copy-to-today; AI suggest + reflection insight; mobile layout; schedule-import connector; several fixes for blank-shell and date bugs.

## 5. Database schema (current)

Only ever add tables or columns. Never drop, rename or change types — older app versions and the legacy fallbacks depend on it.

```
profiles           id (auth.users), streak, longest_streak, last_complete_date,
                   grace_days, last_grace_date, settings jsonb
tasks              id, user_id, text, category, completed, completed_at, date, scheduled_hour, created_at,
                   scheduled_minute (0–59), duration_min (1–1440), kind, people, note, parent_id → tasks.id (cascade)
reflections        user_id, date, total, completed, rate, energy, focus, note, categories, grace   (unique user_id+date)
focus_sessions     id, user_id, date, label, category, task_id, seconds, mode, completed, note, started_at
booking_pages      id, user_id, slug (unique), title, duration_min, buffer_min, start_hour, end_hour, days[], horizon_days, timezone, active
booking_requests   id, page_id, user_id (owner), requester_name, requester_email, starts_at, duration_min, note, status, requester_ip
ai_usage, security_events                       service role only
site_admins, site_content, site_content_history Studio
```

RPCs: `is_site_admin()`, `consume_ai_quota(...)`, `public_availability(text, date, date)`, `request_booking(text, timestamptz, text, text, text)`.

Triggers: `vn_sanitize_task`, `vn_sanitize_reflection`, `vn_sanitize_focus_session`, `vn_sanitize_booking_page`, site-content checks.

## 6. Edge function modes (`ai-suggest`)

| Mode | Input | Output | Daily limit (default) |
|---|---|---|---|
| `next-action` | today's tasks, time | one sentence | 30 |
| `insight` | reflection + stats | one paragraph | 10 |
| `schedule-import` | image (≤ 5 MB) | `{ tasks: [{ text, category, scheduledHour, scheduledMinute, durationMin }], message }` | 10 |
| `schedule-text` | text (≤ 6000 chars), date, timezone | same shape as above | 10 |
| `breakdown` | task text, category | `{ steps: [{ text, minutes }] }` (3–7 steps, ≤ 10 min each) | 20 |

Every mode has a local fallback in `app.js` (`localAI`) so a failed call still produces a useful result.

## 7. Studio (admin) — how it works

- Access: `/studio` or Account → Open Studio, visible only when `is_site_admin()` is true for the signed-in user.
- Edit any page with `?edit`. Content regions are marked `data-edit-region`; published HTML is stored in `site_content`, sanitised on save and on display, and every version is kept in `site_content_history`.
- These notes: `/studio-notes` (linked from Studio and from Account). Regenerate after editing this file: `python3 tools/build_notes.py`.
- Local try-out without an account: `http://localhost:8000/privacy?edit&local=1`.

## 8. Operations

**Local development**
```bash
python3 tools/serve.py        # http://localhost:8000 (SPA-friendly, clean URLs)
node --check js/*.js          # syntax check
deno check supabase/functions/ai-suggest/index.ts
```

**Deploy**: push to `main` → Vercel builds the static site. Database and edge-function changes are manual (see release notes above and `SECURITY.md`).

**Secrets** (Supabase only, never in the repo): `ANTHROPIC_API_KEY`, `ALLOWED_ORIGINS`, `LOG_SALT`, optional `AI_DAILY_LIMIT_*`, `AI_PER_MINUTE_LIMIT`.

**Testing migrations**: migrations are written to be idempotent and were replayed against a clean copy of the earlier schema in an embedded Postgres before shipping.

## 9. Decisions and lessons

- **No framework rewrite.** See section 2. Modularity comes from one global per module (`VisionaryParse`, `VisionaryScheduler`, `VisionaryMomentum`, `VisionaryShield`) and `@ts-check`.
- **Additive schema only.** Legacy fallbacks in the client match `/column|schema cache/i` and retry without new columns, then toast "run the 5.0 update".
- **Privacy on booking pages.** Availability leaves the database only as `{date, start, end}` minutes; titles, notes and people never cross the RPC boundary. Requests can only be created through `request_booking` (no direct insert grant for `anon`).
- **Time zones.** Booking slots are computed in the owner's stored time zone and displayed in the visitor's; the client has a DST-safe `instantIn` helper.
- **Nudges stay quiet.** One per hour at most, only from the user's own data, dismissable for three days, and the whole feature can be turned off.
- **Demo isolation.** The demo is in-memory and reseeded on every start; nothing in the demo touches localStorage except theme and consent.
- **Consent banner in QA.** Automated checks must dismiss `#consent-decline` first or clicks land on the banner.
- **Date words in commands.** "Plan tomorrow's lecture" is a task, not a date; the parser only treats date words as dates when they lead the sentence or sit next to a time.

## 10. Known gaps and ideas

- Booking confirmations are not emailed yet (would need an email provider secret + edge function). Requesters see "you'll hear back".
- Nudges are computed client-side only; a scheduled server job could deliver them as push notifications.
- Micro-step durations are suggestions; a "start the next step" timer shortcut would close the loop further.
- Playwright smoke tests exist as a manual script in the QA notes, not in CI.
