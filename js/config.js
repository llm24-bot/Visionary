// Creates the shared Supabase client from the public settings in js/env.js.
(function initSupabase() {
  if (!window.supabase) throw new Error('Supabase client library failed to load.');
  const cfg = window.VISIONARY_CONFIG;
  window.supabaseClient = window.supabase.createClient(cfg.supabaseUrl, cfg.supabasePublishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' }
  });
})();
