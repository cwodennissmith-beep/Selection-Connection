/**
 * SC Platform Configuration
 *
 * Replace the placeholder values with your actual Supabase project credentials.
 * These are safe to expose in frontend code — RLS policies protect the data.
 *
 * To get these values:
 * 1. Go to dashboard.supabase.com
 * 2. Select your project
 * 3. Settings → API
 * 4. Copy "Project URL" and "anon public" key
 */

var SC_CONFIG = {
  SUPABASE_URL: "https://YOUR_PROJECT_ID.supabase.co",
  SUPABASE_ANON_KEY: "YOUR_ANON_KEY",
  SITE_URL: "https://selection-connection.com",
  STRIPE_PUBLISHABLE_KEY: "pk_test_YOUR_KEY"
};

/* Initialize Supabase client (requires supabase-js CDN script loaded first) */
var scSupabase = null;

function initSupabase() {
  if (scSupabase) return scSupabase;
  if (typeof supabase === "undefined" || !supabase.createClient) {
    console.error("Supabase JS client not loaded. Add the CDN script tag before sc-config.js");
    return null;
  }
  scSupabase = supabase.createClient(SC_CONFIG.SUPABASE_URL, SC_CONFIG.SUPABASE_ANON_KEY);
  return scSupabase;
}
