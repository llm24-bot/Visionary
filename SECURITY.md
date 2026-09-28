# Security

Visionary is a static front end (Vercel) backed by Supabase (Postgres + Auth + Edge Functions). This document explains how each protection is implemented and lists the dashboard settings that can't be stored in code.

**Report a vulnerability:** email louisl4764@gmail.com (also published at `/.well-known/security.txt`). Please don't open a public issue.

---

## One-time setup checklist

These steps are required for the protections below to be active in production.

### 1. Database (run once)
Run `supabase/migrations/20260928000000_security_hardening.sql` in **Supabase → SQL Editor** (or `supabase db push`). It is idempotent. Afterwards, check for older permissive policies and remove any that are broader than "own rows only":

```sql
select tablename, policyname, roles, cmd, qual
from pg_policies where schemaname = 'public'
and tablename in ('tasks', 'reflections', 'profiles');
```

### 2. Edge functions
```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...            # never in the front end
supabase secrets set ALLOWED_ORIGINS=https://your-domain.com,https://visionary-llm24-bots-projects.vercel.app
supabase secrets set LOG_SALT=$(openssl rand -hex 16)        # salts IP hashes in security logs
# optional overrides: AI_DAILY_LIMIT_SUGGEST=30 AI_DAILY_LIMIT_INSIGHT=10 AI_DAILY_LIMIT_IMPORT=10 AI_PER_MINUTE_LIMIT=6
supabase functions deploy ai-suggest
supabase functions deploy account
```

### 3. Supabase → Authentication
| Setting | Where | Value |
|---|---|---|
| Site URL / Redirect URLs | URL Configuration | Your production URL(s) only, plus `http://localhost:8000` for development |
| Confirm email | Sign In / Providers → Email | **On** (also prevents sign-up enumeration) |
| Secure email change | Sign In / Providers → Email | **On** |
| Secure password change | Sign In / Providers → Email | **On** (requires recent sign-in to change password) |
| Minimum password length | Sign In / Providers → Email | **8**, require letters and digits |
| Leaked password protection | Attack Protection | **On** (Pro plan) |
| Email OTP / link expiry | Sign In / Providers → Email | **3600 s** or less — reset links expire after 1 hour |
| CAPTCHA | Attack Protection | Turnstile; then put the *site* key in `js/config.js` → `turnstileSiteKey` |
| Rate limits | Rate Limits | Emails ≤ 30/h, token refresh & verify defaults, sign-in/sign-up ≤ 30 per 5 min per IP |
| Custom SMTP | Emails → SMTP | Configure before launch (the built-in sender is limited to a few emails per hour) |

### 4. Vercel
* **Settings → Deployment Protection:** keep *Standard Protection* for previews, but make sure the production domain is public.
* **Analytics → Enable** Web Analytics and Speed Insights (they only load after a visitor consents).
* Add your custom domain; Vercel issues the TLS certificate and redirects HTTP → HTTPS automatically.
* If you use a custom domain, replace `https://visionary-llm24-bots-projects.vercel.app` in `index.html`, `privacy.html`, `terms.html`, `404.html`, `sitemap.xml`, `robots.txt` and `.well-known/security.txt`.

---

## How each protection works

| Area | Implementation |
|---|---|
| **Secrets off the front end** | `js/config.js` contains only the Supabase URL and *publishable* key (public by design; access enforced by RLS). The Anthropic key, service-role key and Turnstile secret live only in Supabase secrets. `.gitignore` blocks `.env*`; `.vercelignore` keeps `supabase/`, docs and Markdown off the CDN. |
| **HTTPS + HSTS** | Vercel redirects HTTP → HTTPS. `vercel.json` sends `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` and CSP `upgrade-insecure-requests`. |
| **Security headers** | Strict CSP (`script-src 'self'` + Turnstile only, `frame-ancestors 'none'`, `object-src 'none'`), `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, COOP. All scripts, fonts and libraries are self-hosted. |
| **CSRF** | Supabase auth uses bearer tokens in the `Authorization` header, not cookies, so browsers never attach credentials automatically and classic CSRF doesn't apply. Edge functions additionally reject any request whose `Origin` is not in `ALLOWED_ORIGINS`. |
| **CORS** | Edge functions reflect only allow-listed origins, allow only `POST`/`OPTIONS`, and log blocked origins. |
| **Row Level Security** | Every table is `auth.uid() = user_id`. `anon` has no table privileges. `ai_usage` and `security_events` have RLS with no policies (service role only). |
| **Sanitize before storing** | Client: `cleanInput()` strips control/bidi characters, collapses whitespace and enforces length. Server: `BEFORE INSERT/UPDATE` triggers do the same, clamp numbers and whitelist categories. Output is always HTML-escaped. |
| **Form validation** | Accessible inline errors (`aria-invalid`, live regions), email format, password policy, confirm-password on reset, `maxlength` on every input. |
| **Spam protection** | Honeypot field, minimum fill time, optional Cloudflare Turnstile (enforced server-side by Supabase), Supabase IP rate limits. |
| **User enumeration** | Sign-in, sign-up and reset all return the same message whether or not the email exists. |
| **Account lockout** | After 5 failed sign-ins for an email, the client pauses sign-in for 15 min (doubling on repeat). Server-side, Supabase rate-limits sign-ins per IP and CAPTCHA blocks automation. On the Teams plan, add the *Password Verification Attempt* auth hook for server-enforced per-account lockout. |
| **Password reset** | Reset links expire (Supabase OTP expiry). Expired/used links are detected and explained. A 60-second client cooldown mirrors Supabase's per-user email interval. |
| **Sessions after password change** | Both the reset flow and Account → Change password call `signOut({ scope: 'others' })`. Users can also sign out other devices or everywhere. |
| **Upload whitelist** | Client accepts only JPEG/PNG/WebP/GIF ≤ 15 MB, then re-encodes to JPEG (strips EXIF). Server checks MIME whitelist, base64 format, 5 MB limit and **magic bytes**. |
| **Request size limits** | Edge functions stream the body with a hard cap (7 MB image mode, 64 KB text modes, 2 KB account), regardless of `Content-Length`. |
| **Prompt injection** | Rules in the system prompt; user data wrapped in `<user_data>` with `<`/`>` neutralised; inputs cleaned and truncated; output stripped of links/markup and length-capped; schedule JSON validated field by field. |
| **AI usage caps** | `consume_ai_quota()` enforces per-user daily limits per mode and a per-minute burst limit atomically. |
| **Security logging** | `security_events` records blocked origins, oversized/invalid uploads, quota hits, unauthenticated calls, password changes, session revocations, exports and deletions. IPs are stored only as salted hashes. |
| **Admin routes** | There are none. The app has no admin UI; Supabase Studio is only reachable through your Supabase account. |
| **Directory listing** | Vercel never lists directories; unknown paths return the custom 404. |
| **Cookies** | Auth tokens are stored by supabase-js in localStorage (protected by the strict CSP). The only cookie, `vn_consent`, is `Secure; SameSite=Lax; Path=/`. |
| **Payments** | Not used yet. See `docs/payments.md` for the required webhook-signature verification and server-side pricing pattern before adding any. |

## Maintenance
```sql
-- run monthly (or schedule with pg_cron)
delete from public.security_events where created_at < now() - interval '180 days';
delete from public.ai_usage        where day        < current_date - 90;
```
