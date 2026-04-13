import { getSupabaseClient } from "@/lib/supabaseClient";

export type NautiljonRefreshResult = {
  ok: true;
  checked: number;
  changed: number;
  flagged: number;
  errors: Array<{ id: string; error: string }>;
};

export async function runNautiljonRefresh(options?: {
  readingId?: string;
  force?: boolean;
  limit?: number;
}): Promise<NautiljonRefreshResult> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.functions.invoke("nautiljon-refresh", {
    body: {
      reading_id: options?.readingId ?? null,
      force: Boolean(options?.force),
      limit: options?.limit ?? 50,
    },
  });
  if (error) {
    throw new Error(error.message);
  }
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

