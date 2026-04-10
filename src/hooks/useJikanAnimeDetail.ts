import { useEffect, useState } from "react";
import {
  fetchAnimeCompleteReport,
  type AnimeJikanCompleteReport,
} from "@/services/jikan/animeJikanService";

export type UseJikanAnimeDetailState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string; statusCode?: number }
  | { status: "ready"; report: AnimeJikanCompleteReport };

/**
 * Charge l’agrégat Jikan pour une fiche animé (MAL id).
 */
export function useJikanAnimeDetail(malId: number | null): UseJikanAnimeDetailState {
  const [state, setState] = useState<UseJikanAnimeDetailState>({ status: "idle" });

  useEffect(() => {
    if (malId === null || !Number.isFinite(malId) || malId <= 0) {
      setState({ status: "error", message: "Identifiant animé invalide." });
      return;
    }

    let cancelled = false;
    setState({ status: "loading" });

    (async () => {
      const result = await fetchAnimeCompleteReport(malId);
      if (cancelled) {
        return;
      }
      if (!result.ok) {
        setState({
          status: "error",
          message: result.error,
          statusCode: result.status,
        });
        return;
      }
      setState({ status: "ready", report: result.report });
    })();

    return () => {
      cancelled = true;
    };
  }, [malId]);

  return state;
}
