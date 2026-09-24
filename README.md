# Visionary

A calm daily planner: tasks, a live day horizon, focus sessions, 30-second reflections, and an AI coach. Plain HTML/CSS/JS on the front end, Supabase for auth + data, and a Supabase Edge Function (`ai-suggest`) that calls Claude.

## What's new in 4.0 — "Horizon"

- **New look** — night-ink / first-light amber palette, Instrument Serif + Satoshi + JetBrains Mono, sidebar layout on desktop and a bottom tab bar on phones. Light mode is saved between visits.
- **Day horizon** — the day drawn as an arc: the sun tracks the current time and scheduled tasks sit along it. Shows time left today and what's next.
- **Focus sessions** — 25 / 50 / 10 minute timer with a dial, optional "mark task done when finished", and a daily session log (stored in the browser).
- **Scan schedule, with review** — upload a photo/screenshot, the image is downscaled, sent to `ai-suggest` (`schedule-import`), and you can edit / uncheck / re-time each item before importing.
- **Smart add** — type `gym at 6pm` or `study @ 14:00` and the time is set for you.
- **Inline editing** — double-click a task to rename it; pick a time from the dropdown on each task (works on mobile, where drag-and-drop doesn't).
- **Patterns page** — 26-week consistency heatmap plus rule-based pattern cards (plan size, energy, best weekday, category balance, week-over-week trend).
- **Quick actions** — `Ctrl/⌘ K` command palette; `N` new task, `1–4` switch views.
- **Demo mode** — "Explore the demo" on the sign-in screen runs the full app on seeded local data, no account needed.
- **Fixes** — streaks now reset after a missed day, optimistic updates with rollback + toasts instead of silent console errors, boot splash so signed-in users don't see a flash of the login screen, more robust JSON parsing in the edge function.

## Run locally

```bash
python -m http.server 8000   # then open http://localhost:8000
```

## Deploy the edge function

```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
supabase functions deploy ai-suggest
```

No database schema changes are required for 4.0.
