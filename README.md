# Visionary

A calm daily planner: a live day timeline, focus sessions, 30-second reflections and an AI coach.

**Stack:** static HTML/CSS/JS on Vercel · Supabase (Postgres, Auth, Edge Functions) · Anthropic Claude for AI features.

## Project structure

```
index.html              App (sign-in + planner)
privacy.html            Privacy Policy
terms.html              Terms of Service
404.html                Custom not-found page
css/                    style.css (design system), fonts.css (self-hosted fonts)
js/
  theme-init.js         Applies theme before first paint
  config.js             Public client config (no secrets)
  auth.js               Sign-in, sign-up, reset, lockout, validation
  app.js                Planner, focus timer, patterns, AI, demo mode
  account.js            Password change, sessions, export, delete account
  consent.js            Cookie banner + consent-gated analytics
vendor/                 Pinned, self-hosted supabase-js and Chart.js
assets/                 Icons, fonts, social preview image
supabase/
  functions/_shared/    Origin allowlist, size limits, auth, security logging
  functions/ai-suggest/ AI suggestions, insights, schedule scanning
  functions/account/    Account deletion
  migrations/           RLS, grants, sanitisation, AI quotas, security log
vercel.json             Security headers, caching, clean URLs, redirects
SECURITY.md             Security model + required dashboard settings
docs/payments.md        Rules for adding payments later
```

## Run locally

```bash
python3 -m http.server 8000   # open http://localhost:8000/
```

Use **Explore the demo** on the sign-in screen to try everything without an account.

## Deploy

1. Push to `main` — Vercel deploys the static site.
2. Run the SQL migration and deploy the edge functions — see [SECURITY.md](SECURITY.md).

## Release notes

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
