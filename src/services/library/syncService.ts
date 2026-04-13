import type { SupabaseClient } from "@supabase/supabase-js";
import { appendClientLog } from "@/services/observability/clientLogService";

export type SyncSource = "mal" | "anilist";
export type SyncMediaType = "anime" | "reading";

export type SyncRun = {
  id: string;
  source: SyncSource;
  media_type: SyncMediaType;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  current_stage: "import" | "enrich" | "translate" | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  error_message: string | null;
};

export type SyncProgressRow = {
  stage: "import" | "enrich" | "translate";
  total: number;
  processed: number;
  created_count: number;
  updated_count: number;
  error_count: number;
  current_item_label: string | null;
  rate_per_min: number | null;
  eta_seconds: number | null;
  updated_at: string;
};

export type SyncStatusPayload = {
  active_run: SyncRun | null;
  active_progress: SyncProgressRow[];
  recent_runs: SyncRun[];
};

export type SyncStartOptions = {
  selectedFieldIds?: string[];
  targetMalId?: number;
};

function stringifyPayloadSummary(payload: unknown): string {
  if (!payload) {
    return "";
  }
  if (typeof payload === "string") {
    return payload;
  }
  if (typeof payload === "object") {
    const data = payload as Record<string, unknown>;
    const preferred = [
      data.error,
      data.message,
      data.details,
      data.hint,
      data.code,
    ].filter((value) => typeof value === "string" && value.trim().length > 0) as string[];
    if (preferred.length > 0) {
      return preferred.join(" | ");
    }
    try {
      return JSON.stringify(payload);
    } catch {
      return String(payload);
    }
  }
  return String(payload);
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) {
    return null;
  }
  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const json = atob(padded);
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function invokeFunction<T>(supabase: SupabaseClient, fn: string, body: unknown): Promise<T> {
  async function runWithCurrentSession(): Promise<{ data: unknown; error: unknown }> {
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      throw new Error("Session Supabase introuvable (getSession en erreur).");
    }
    let session = data.session ?? null;
    if (!session || (session.expires_at && session.expires_at * 1000 <= Date.now() + 60_000)) {
      const refreshed = await supabase.auth.refreshSession();
      if (refreshed.error) {
        throw new Error("Session Supabase expirée (refresh impossible).");
      }
      session = refreshed.data.session ?? null;
    }
    const accessToken = session?.access_token ?? "";
    if (!accessToken) {
      throw new Error("Session Supabase absente (token vide).");
    }
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
    if (!anonKey) {
      throw new Error("Configuration Supabase invalide (clé anon manquante).");
    }
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
    if (!supabaseUrl) {
      throw new Error("Configuration Supabase invalide (URL manquante).");
    }
    const projectRef = (() => {
      try {
        return new URL(supabaseUrl).hostname.split(".")[0] ?? "";
      } catch {
        return "";
      }
    })();
    const jwtPayload = decodeJwtPayload(accessToken) ?? {};
    const tokenRef = String(jwtPayload.ref ?? "");
    if (projectRef && tokenRef && tokenRef !== projectRef) {
      throw new Error(
        `JWT invalide pour ce projet (token.ref=${tokenRef}, attendu=${projectRef}). Déconnecte-toi puis reconnecte-toi.`
      );
    }
    // Vérifie explicitement que le token courant est accepté par Auth.
    try {
      const authResp = await fetch(`${supabaseUrl.replace(/\/+$/, "")}/auth/v1/user`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          apikey: anonKey,
        },
      });
      if (!authResp.ok) {
        throw new Error(`Token rejeté par /auth/v1/user (HTTP ${authResp.status}).`);
      }
      appendClientLog("info", "supabase.auth.user", "Connexion Supabase OK", `HTTP ${authResp.status}`);
    } catch (authError) {
      const msg = authError instanceof Error ? authError.message : "Token rejeté par Auth.";
      appendClientLog("error", "supabase.auth.user", "Connexion Supabase rejetée", msg);
      throw new Error(`${msg} Déconnecte-toi puis reconnecte-toi.`);
    }
    const endpoint = `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/${fn}`;
    try {
      const startedAt = performance.now();
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
          apikey: anonKey,
        },
        body: JSON.stringify((body ?? {}) as Record<string, unknown>),
      });
      let payload: unknown = null;
      const rawText = await response.text();
      if (rawText.trim().length > 0) {
        try {
          payload = JSON.parse(rawText) as unknown;
        } catch {
          payload = rawText;
        }
      }
      if (!response.ok) {
        const summary = stringifyPayloadSummary(payload);
        appendClientLog(
          "error",
          `supabase.functions.${fn}`,
          `POST /functions/v1/${fn} échoué`,
          `HTTP ${response.status}${summary ? ` — ${summary}` : ""}`
        );
        return {
          data: null,
          error: {
            message: "non-2xx status code",
            context: { status: response.status, payload },
          },
        };
      }
      appendClientLog(
        "info",
        `supabase.functions.${fn}`,
        `POST /functions/v1/${fn} OK`,
        `HTTP ${response.status} — ${Math.round(performance.now() - startedAt)} ms`
      );
      return { data: payload, error: null };
    } catch (networkError) {
      appendClientLog(
        "error",
        `supabase.functions.${fn}`,
        `POST /functions/v1/${fn} erreur réseau`,
        networkError instanceof Error ? networkError.message : String(networkError)
      );
      return { data: null, error: networkError };
    }
  }

  function formatFunctionError(rawError: unknown): string {
    const typed = rawError as { message?: string; context?: unknown };
    let details = "";
    if (typeof typed.context === "string" && typed.context.trim().length > 0) {
      try {
        const parsed = JSON.parse(typed.context) as { error?: string };
        details = parsed.error ?? typed.context;
      } catch {
        details = typed.context;
      }
    } else if (typed.context instanceof Response) {
      details = `HTTP ${typed.context.status}`;
    } else if (typed.context && typeof typed.context === "object") {
      const withStatus = typed.context as { status?: unknown; payload?: unknown };
      if (typeof withStatus.status === "number") {
        details = `HTTP ${withStatus.status}`;
      }
      if (withStatus.payload) {
        const payloadSummary = stringifyPayloadSummary(withStatus.payload);
        details = details
          ? `${details} — ${payloadSummary}`
          : payloadSummary;
      }
    }
    const baseMessage = typed.message || "Erreur Edge Function";
    return details ? `[${fn}] ${baseMessage} — ${details}` : `[${fn}] ${baseMessage}`;
  }

  let { data, error } = await runWithCurrentSession();
  if (error) {
    const typed = error as { message?: string; context?: unknown };
    const isUnauthorized =
      (typeof typed.message === "string" && typed.message.includes("non-2xx status code")) ||
      (typed.context instanceof Response && typed.context.status === 401);
    if (isUnauthorized) {
      await supabase.auth.refreshSession().catch(() => undefined);
      ({ data, error } = await runWithCurrentSession());
      if (error) {
        // Dernier fallback en mode SDK natif sans en-têtes custom.
        ({ data, error } = await supabase.functions.invoke(fn, { body: (body ?? {}) as Record<string, unknown> }));
      }
    }
  }
  if (error) {
    throw new Error(formatFunctionError(error));
  }
  return data as T;
}

export async function startAnimeSync(
  supabase: SupabaseClient,
  source: SyncSource,
  options?: SyncStartOptions
): Promise<{ run_id: string; reused: boolean }> {
  const selected = Array.isArray(options?.selectedFieldIds)
    ? options?.selectedFieldIds.filter((id) => typeof id === "string" && id.trim().length > 0)
    : [];
  const targetMalId =
    Number.isFinite(options?.targetMalId) && Number(options?.targetMalId) > 0
      ? Math.floor(Number(options?.targetMalId))
      : null;
  let data: { ok: boolean; run_id: string; reused?: boolean };
  try {
    data = await invokeFunction<{ ok: boolean; run_id: string; reused?: boolean }>(
      supabase,
      "sync-start",
      {
        source,
        media_type: "anime",
        selected_field_ids: selected,
        target_mal_id: targetMalId,
      }
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Erreur inconnue";
    throw new Error(
      `[sync-start] media=anime source=${source} target_mal_id=${targetMalId ?? "null"} — ${reason}`
    );
  }
  if (!data?.ok || !data.run_id) {
    throw new Error("Impossible de démarrer la synchronisation.");
  }
  return { run_id: data.run_id, reused: Boolean(data.reused) };
}

export async function startReadingSync(
  supabase: SupabaseClient,
  source: SyncSource,
  options?: SyncStartOptions
): Promise<{ run_id: string; reused: boolean }> {
  const selected = Array.isArray(options?.selectedFieldIds)
    ? options?.selectedFieldIds.filter((id) => typeof id === "string" && id.trim().length > 0)
    : [];
  const targetMalId =
    Number.isFinite(options?.targetMalId) && Number(options?.targetMalId) > 0
      ? Math.floor(Number(options?.targetMalId))
      : null;
  let data: { ok: boolean; run_id: string; reused?: boolean };
  try {
    data = await invokeFunction<{ ok: boolean; run_id: string; reused?: boolean }>(
      supabase,
      "sync-start",
      {
        source,
        media_type: "reading",
        selected_field_ids: selected,
        target_mal_id: targetMalId,
      }
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Erreur inconnue";
    throw new Error(
      `[sync-start] media=reading source=${source} target_mal_id=${targetMalId ?? "null"} — ${reason}`
    );
  }
  if (!data?.ok || !data.run_id) {
    throw new Error("Impossible de démarrer la synchronisation lectures.");
  }
  return { run_id: data.run_id, reused: Boolean(data.reused) };
}

export async function getAnimeSyncStatus(supabase: SupabaseClient): Promise<SyncStatusPayload> {
  const data = await invokeFunction<{ ok: boolean } & SyncStatusPayload>(supabase, "sync-status", {});
  if (!data?.ok) {
    throw new Error("Impossible de récupérer l’état de synchronisation.");
  }
  return {
    active_run: data.active_run ?? null,
    active_progress: data.active_progress ?? [],
    recent_runs: data.recent_runs ?? [],
  };
}

export async function getReadingSyncStatus(supabase: SupabaseClient): Promise<SyncStatusPayload> {
  const data = await invokeFunction<{ ok: boolean } & SyncStatusPayload>(supabase, "sync-status", {
    media_type: "reading",
  });
  if (!data?.ok) {
    throw new Error("Impossible de récupérer l’état de synchronisation lectures.");
  }
  return {
    active_run: data.active_run ?? null,
    active_progress: data.active_progress ?? [],
    recent_runs: data.recent_runs ?? [],
  };
}

export async function tickAnimeSyncWorker(supabase: SupabaseClient): Promise<void> {
  await invokeFunction(supabase, "sync-worker", {});
}

export async function tickReadingSyncWorker(supabase: SupabaseClient): Promise<void> {
  await invokeFunction(supabase, "sync-worker", {});
}
