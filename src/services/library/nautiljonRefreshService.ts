import { getSupabaseClient } from "@/lib/supabaseClient";
import { invokeEdgeFunction } from "@/services/supabase/edgeFunctionInvoke";

export type NautiljonRefreshResult = {
  ok: true;
  checked: number;
  changed: number;
  flagged: number;
  errors: Array<{ id: string; error: string }>;
};

type NautiljonRefreshPayload = {
  ok?: boolean;
  error?: string;
  checked?: number;
  changed?: number;
  flagged?: number;
  errors?: Array<{ id: string; error: string }>;
};

export async function runNautiljonRefresh(options?: {
  readingId?: string;
  force?: boolean;
  limit?: number;
}): Promise<NautiljonRefreshResult> {
  const supabase = getSupabaseClient();
  const data = await invokeEdgeFunction<NautiljonRefreshPayload>(supabase, "nautiljon-refresh", {
    reading_id: options?.readingId ?? null,
    force: Boolean(options?.force),
    limit: options?.limit ?? 50,
  });
  if (!data?.ok) {
    throw new Error(String(data?.error ?? "Erreur Nautiljon refresh."));
  }
  return {
    ok: true,
    checked: Number(data.checked ?? 0),
    changed: Number(data.changed ?? 0),
    flagged: Number(data.flagged ?? 0),
    errors: Array.isArray(data.errors) ? data.errors : [],
  };
}

