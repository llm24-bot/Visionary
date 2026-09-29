// ============================================================================
// Visionary — public client configuration (loaded on every page)
//
// Everything in this file ships to the browser, so it must only contain values
// that are designed to be public:
//   * SUPABASE_URL / publishable key — safe to expose; access is enforced by
//     Row Level Security (see supabase/migrations). Never put the service_role
//     key or any sb_secret_* key here.
//   * Turnstile *site* key — public by design (the secret lives in Supabase Auth).
//
// Secrets (Anthropic API key, service role key, Turnstile secret) live only in
// Supabase function secrets / the Supabase dashboard. See SECURITY.md.
// ============================================================================

window.VISIONARY_CONFIG = Object.freeze({
  supabaseUrl: 'https://emwwwpdbdczqywjgiuzf.supabase.co',
  supabasePublishableKey: 'sb_publishable_dAZIBBwcuBPl7fbdYV9GGw_rWGfYR7x',

  // Cloudflare Turnstile site key. Leave empty until CAPTCHA protection is
  // enabled in Supabase → Authentication → Attack Protection.
  turnstileSiteKey: '',

  // Client-side guard rails (the server enforces its own limits too).
  maxLoginAttempts: 5,
  lockoutMinutes: 15,
  resetCooldownSeconds: 60,
  maxUploadMB: 15,
  allowedUploadTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
});
