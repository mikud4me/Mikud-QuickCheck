import { createClient } from '@supabase/supabase-js';

// Replaces base44Client.js. Uses the publishable key only — safe to expose in
// the frontend bundle. Every Edge Function call and table access from this
// app is anonymous by design (no user login), matching the original app's
// `requiresAuth: false` Base44 client config.
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
);
