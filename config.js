const SUPABASE_URL = 'https://emwwwpdbdczqywjgiuzf.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_dAZIBBwcuBPl7fbdYV9GGw_rWGfYR7x';

if (!window.supabase) {
  throw new Error('Supabase client library failed to load.');
}

window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);