const DEFAULT_SUPABASE_URL = "https://yabrgtrerjyzahmswbzw.supabase.co";
const DEFAULT_PUBLISHABLE_KEY = "sb_publishable_E83KxLfg2p3U9HIGZe5qRg_kgKEyQ2J";
const DEFAULT_JWKS_URL = "https://yabrgtrerjyzahmswbzw.supabase.co/auth/v1/.well-known/jwks.json";

export const supabaseConfig = {
  url:
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    DEFAULT_SUPABASE_URL,
  publishableKey:
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    DEFAULT_PUBLISHABLE_KEY,
  jwksUrl:
    process.env.NEXT_PUBLIC_SUPABASE_JWKS_URL ||
    process.env.SUPABASE_JWKS_URL ||
    DEFAULT_JWKS_URL,
  secretKey:
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "",
};
