import { createClient } from "@supabase/supabase-js";
import { supabaseConfig } from "./supabaseConfig";

const DEFAULT_SUPABASE_URL = "https://yabrgtrerjyzahmswbzw.supabase.co";

export function getServiceSupabase() {
  const url =
    supabaseConfig?.url ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    DEFAULT_SUPABASE_URL;

  const secretKey =
    supabaseConfig?.secretKey ||
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "";

  if (!url || !secretKey) {
    throw new Error(
      "Missing SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY in server environment"
    );
  }

  return createClient(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function getCallerProfile(req, supabaseAdmin) {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return { error: "Missing bearer token", status: 401 };

  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
  if (userErr || !userData?.user) {
    return { error: userErr?.message || "Invalid or expired session", status: 401 };
  }

  const { data: profile, error: profErr } = await supabaseAdmin
    .from("profiles")
    .select("*")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (profErr) {
    return { error: `Profile query error: ${profErr.message}`, status: 403 };
  }
  if (!profile) {
    return { error: `No profile row for user ${userData.user.id}`, status: 403 };
  }
  if (!profile.is_active) {
    return { error: "Profile is inactive (is_active is false)", status: 403 };
  }

  return { profile, status: 200 };
}
