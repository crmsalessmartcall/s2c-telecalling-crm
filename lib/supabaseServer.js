import { createClient } from "@supabase/supabase-js";
import { supabaseConfig } from "./supabaseConfig";

export function getServiceSupabase() {
  if (!supabaseConfig.url || !supabaseConfig.secretKey) {
    throw new Error("Missing Supabase URL or SUPABASE_SECRET_KEY / SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(supabaseConfig.url, supabaseConfig.secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function getCallerProfile(req, supabaseAdmin) {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return { error: "Missing bearer token", status: 401 };

  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
  if (userErr || !userData?.user) {
    return { error: "Invalid or expired session", status: 401 };
  }

  const { data: profile, error: profErr } = await supabaseAdmin
    .from("profiles")
    .select("*")
    .eq("id", userData.user.id)
    .single();

  if (profErr || !profile || !profile.is_active) {
    return { error: "Profile not found or inactive", status: 403 };
  }

  return { profile, status: 200 };
}
