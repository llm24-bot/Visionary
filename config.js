// Supabase configuration
const SUPABASE_URL = 'https://emwwwpdbdczqywjgiuzf.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_dAZIBBwcuBPl7fbdYV9GGw_rWGfYR7x';

// Initialize Supabase client
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);