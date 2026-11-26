import { createClient } from "@supabase/supabase-js";

const DEFAULT_SUPABASE_URL = "https://yabrgtrerjyzahmswbzw.supabase.co";
const DEFAULT_PUBLISHABLE_KEY = "sb_publishable_E83KxLfg2p3U9HIGZe5qRg_kgKEyQ2J";

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  DEFAULT_SUPABASE_URL;

const supabaseKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  DEFAULT_PUBLISHABLE_KEY;

export const supabase = createClient(supabaseUrl, supabaseKey);
