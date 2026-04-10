import { createClient } from "jsr:@supabase/supabase-js@2";
import { envOrThrow } from "./integration-helpers.ts";

export type SyncSource = "mal" | "anilist";
export type SyncStage = "import" | "enrich" | "translate";

export function createServiceSupabaseClient() {
  const supabaseUrl = envOrThrow("SUPABASE_URL");
  const serviceRoleKey = envOrThrow("SUPABASE_SERVICE_ROLE_KEY");
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export function nowIso(): string {
  return new Date().toISOString();
}
