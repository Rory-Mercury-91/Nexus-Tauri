import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabaseClient";
import {
  fetchMalOfficialBundle,
  type MalOfficialBundlePayload,
} from "@/services/mal/malOfficialBundleService";

export type UseMalOfficialBundleState =
  | { status: "idle" }
  | { status: "loading" }
  | {
      status: "error";
      code?: string;
      message: string;
    }
  | { status: "ready"; payload: MalOfficialBundlePayload };

/**
 * Charge le bundle de test API MAL officielle (Edge Function) pour un mal_id animé.
 */
export function useMalOfficialBundle(malId: number | null): UseMalOfficialBundleState {
  const [state, setState] = useState<UseMalOfficialBundleState>({ status: "idle" });

  useEffect(() => {
    if (malId === null || !Number.isFinite(malId) || malId <= 0) {
      setState({ status: "idle" });
      return;
    }

    let cancelled = false;
    setState({ status: "loading" });

    (async () => {
      const supabase = getSupabaseClient();
      const result = await fetchMalOfficialBundle(supabase, malId);
      if (cancelled) {
        return;
      }
      if (!result.ok) {
        const err = result.error;
        const message =
          "message" in err ? err.message : "Erreur inconnue.";
        const code = "code" in err ? err.code : undefined;
        setState({ status: "error", code, message });
        return;
      }
      setState({ status: "ready", payload: result.payload });
    })();

    return () => {
      cancelled = true;
    };
  }, [malId]);

  return state;
}
