import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

/**
 * Client Supabase singleton (clé anon + URL projet).
 * Les variables VITE_* doivent être définies dans `.env` (voir `.env.example`).
 * La session est persistée automatiquement dans localStorage (storageKey) par le SDK.
 */
export function getSupabaseClient(): SupabaseClient {
  if (client) {
    return client;
  }
  const url = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Configuration Supabase manquante : définissez VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY dans .env"
    );
  }
  const projectRef = (() => {
    try {
      return new URL(url).hostname.split(".")[0] ?? "default";
    } catch {
      return "default";
    }
  })();
  client = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // Tauri / HashRouter : évite d’interpréter des fragments d’URL non liés à OAuth
      detectSessionInUrl: false,
      flowType: "pkce",
      // Évite les collisions de session entre plusieurs projets Supabase.
      storageKey: `nexus-supabase-auth:${projectRef}`,
    },
  });
  return client;
}
