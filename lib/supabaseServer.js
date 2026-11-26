import { createClient } from "@supabase/supabase-js";
import { supabaseConfig } from "./supabaseConfig";

export function getServiceSupabase() {
  const url =
    supabaseConfig?.url ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    "";
  const secretKey =
    supabaseConfig?.secretKey ||
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "";

  if (!url || !secretKey) {
    throw new Error("Missing Supabase URL or secret key on the server");
  }

  return createClient(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
