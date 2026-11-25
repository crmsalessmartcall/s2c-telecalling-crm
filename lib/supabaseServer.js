import { createClient } from "@supabase/supabase-js";
import { getCallerProfile as baseGetCallerProfile } from "./authHelper";
import { supabaseConfig } from "./supabaseConfig";

export function getServiceSupabase() {
  if (!supabaseConfig.url || !supabaseConfig.secretKey) {
    throw new Error(
      "Missing Supabase URL or SUPABASE_SECRET_KEY / SUPABASE_SERVICE_ROLE_KEY"
    );
  }

  return createClient(supabaseConfig.url, supabaseConfig.secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function getCallerProfile(req, supabaseAdmin) {
  return baseGetCallerProfile(req, supabaseAdmin);
}
