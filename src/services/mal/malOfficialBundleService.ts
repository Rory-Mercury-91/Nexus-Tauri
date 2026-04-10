import type { SupabaseClient } from "@supabase/supabase-js";
import { getInvokeAuthHeaders } from "@/services/integrations/integrationService";

/** Réponse d’une sous-requête MAL dans le bundle Edge Function. */
export type MalOfficialPart =
  | { ok: true; data: unknown }
  | { ok: false; status: number; body: string };

export type MalOfficialBundlePayload = {
  ok: true;
  mal_id: number;
  fetched_at: string;
  parts: {
    user_me: MalOfficialPart;
    anime_detail: MalOfficialPart;
    anime_suggestions: MalOfficialPart;
    animelist_recent: MalOfficialPart;
    anime_ranking_top_sample: MalOfficialPart;
  };
};

export type MalOfficialBundleErrorPayload = {
  ok: false;
  code: string;
  message: string;
};

/**
 * Agrège plusieurs appels API MAL v2 (via Edge Function + token OAuth stocké).
 * Sert au prototypage UI : comparer avec les données Jikan côté fiche animé.
 */
export async function fetchMalOfficialBundle(
  supabase: SupabaseClient,
  malId: number
): Promise<
  | { ok: true; payload: MalOfficialBundlePayload }
  | { ok: false; error: MalOfficialBundleErrorPayload | { message: string } }
> {
  const headers = await getInvokeAuthHeaders(supabase);
  if (!headers) {
    return {
      ok: false,
      error: { message: "Session utilisateur invalide." },
    };
  }
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  if (!supabaseUrl) {
    return {
      ok: false,
      error: { message: "VITE_SUPABASE_URL manquant." },
    };
  }
  const endpoint = `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/mal-official-bundle`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify({ mal_id: malId }),
  });
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? (JSON.parse(text) as unknown) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    let errorFromPayload = "";
    if (data && typeof data === "object") {
      const payload = data as Record<string, unknown>;
      if (typeof payload.error === "string") {
        errorFromPayload = payload.error;
      }
    }
    const rawMessage = errorFromPayload || text;
    const looksLikeAuthError = response.status === 401 || /unauthorized|jwt/i.test(rawMessage);
    return {
      ok: false,
      error: {
        message: looksLikeAuthError
          ? "Session invalide pour appeler l’Edge Function MAL (401). Vérifie que la requête envoie bien Authorization: Bearer <token> et apikey du même projet."
          : rawMessage ||
            `Fonction mal-official-bundle indisponible (HTTP ${response.status}).`,
      },
    };
  }

  const raw = (data ?? {}) as MalOfficialBundlePayload | MalOfficialBundleErrorPayload;
  if (raw && typeof raw === "object" && "ok" in raw && raw.ok === false) {
    return { ok: false, error: raw };
  }
  if (
    raw &&
    typeof raw === "object" &&
    "ok" in raw &&
    raw.ok === true &&
    "parts" in raw
  ) {
    return { ok: true, payload: raw as MalOfficialBundlePayload };
  }
  return {
    ok: false,
    error: { message: "Réponse mal-official-bundle inattendue." },
  };
}
