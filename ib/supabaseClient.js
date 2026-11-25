import { createClient } from "@supabase/supabase-js";
import { supabaseConfig } from "./supabaseConfig";

if (!supabaseConfig.url || !supabaseConfig.publishableKey) {
  console.warn(
    "Missing Supabase URL or publishable key. Check your environment variables."
  );
}

export const supabase = createClient(
  supabaseConfig.url || "https://placeholder.supabase.co",
  supabaseConfig.publishableKey || "placeholder-key"
);
