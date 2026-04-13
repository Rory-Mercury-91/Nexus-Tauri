import type { SupabaseClient } from "@supabase/supabase-js";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { appendClientLog } from "@/services/observability/clientLogService";

type SupabaseClientInternals = SupabaseClient & {
  supabaseUrl: string;
  supabaseKey: string;
};

/**
 * File d’attente : plusieurs `invokeEdgeFunction` en parallèle (ex. sync anime + reading)
 * peuvent déclencher des refresh concurrents et des 401 « Invalid JWT » sur /functions/v1.
 */
let invokeChain: Promise<unknown> = Promise.resolve();

/**
 * Appelle une Edge Function via `supabase.functions.invoke`.
 *
 * Un `fetch` manuel avec `VITE_*` contourne le `fetchWithAuth` du client (`apikey` + Bearer
 * issus de `createClient` + `getAccessToken()`), ce qui peut provoquer des 401 sur les
 * Functions alors que `/auth/v1/user` répond encore 200.
 *
 * En cas d’échec HTTP, on parse le corps de `FunctionsHttpError.context` (Response) pour
 * afficher le détail (ex. « Invalid JWT ») au lieu du seul message générique du SDK.
 */
export async function invokeEdgeFunction<T>(
  supabase: SupabaseClient,
  fn: string,
  body?: unknown
): Promise<T> {
  const run = async (): Promise<T> => {
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
    if (!session?.access_token) {
      throw new Error("Session Supabase absente (token vide).");
    }

    const client = supabase as SupabaseClientInternals;
    const projectRef = (() => {
      try {
        return new URL(client.supabaseUrl).hostname.split(".")[0] ?? "";
      } catch {
        return "";
      }
    })();
    const jwtPayload = decodeJwtPayload(session.access_token) ?? {};
    const tokenRef = String(jwtPayload.ref ?? "");
    if (projectRef && tokenRef && tokenRef !== projectRef) {
      throw new Error(
        `JWT invalide pour ce projet (token.ref=${tokenRef}, attendu=${projectRef}). Déconnecte-toi puis reconnecte-toi.`
      );
    }

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData.user) {
      throw new Error(
        "Session invalide côté serveur (getUser). Déconnecte-toi puis reconnecte-toi."
      );
    }

    const payloadBody = (body ?? {}) as Record<string, unknown>;
    const startedAt = performance.now();
    const anonKey = client.supabaseKey;

    /**
     * En-têtes explicites : même couple que le `fetchWithAuth` interne du client.
     * Sans ça, `getAccessToken()` peut retomber sur la clé anon comme Bearer si la session
     * et le fetch ne sont pas parfaitement synchrones — la gateway renvoie alors « Invalid JWT ».
     */
    async function callInvoke(): Promise<{ data: unknown; error: unknown }> {
      const { data: latest } = await supabase.auth.getSession();
      const token = latest.session?.access_token ?? "";
      if (!token) {
        throw new Error("Session Supabase absente (token vide).");
      }
      return supabase.functions.invoke(fn, {
        body: payloadBody,
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: anonKey,
        },
      });
    }

    let result = await callInvoke();
    if (result.error && isUnauthorizedFunctionsError(result.error)) {
      await supabase.auth.refreshSession().catch(() => undefined);
      result = await callInvoke();
    }

    if (result.error) {
      const message = await formatFunctionsHttpError(fn, result.error);
      appendClientLog(
        "error",
        `supabase.functions.${fn}`,
        `POST /functions/v1/${fn} échoué`,
        message.replace(`[${fn}] `, "")
      );
      throw new Error(message);
    }

    appendClientLog(
      "info",
      `supabase.functions.${fn}`,
      `POST /functions/v1/${fn} OK`,
      `HTTP 200 — ${Math.round(performance.now() - startedAt)} ms`
    );
    return (result.data ?? {}) as T;
  };

  const promise = invokeChain.then(() => run());
  invokeChain = promise.then(
    () => undefined,
    () => undefined
  );
  return promise as Promise<T>;
}

function isUnauthorizedFunctionsError(error: unknown): boolean {
  if (!(error instanceof FunctionsHttpError)) {
    return false;
  }
  const ctx = error.context;
  return ctx instanceof Response && ctx.status === 401;
}

async function formatFunctionsHttpError(fn: string, error: unknown): Promise<string> {
  if (error instanceof FunctionsHttpError && error.context instanceof Response) {
    const r = error.context;
    try {
      const text = await r.clone().text();
      let detail = text;
      if (text.trim().startsWith("{")) {
        const j = JSON.parse(text) as { msg?: string; error?: string; message?: string };
        detail = j.msg ?? j.error ?? j.message ?? text;
      }
      return `[${fn}] Edge Function returned a non-2xx status code — HTTP ${r.status} — ${detail}`;
    } catch {
      return `[${fn}] Edge Function returned a non-2xx status code — HTTP ${r.status}`;
    }
  }
  const e = error as { message?: string };
  return `[${fn}] ${e.message ?? "Erreur Edge Function"}`;
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
