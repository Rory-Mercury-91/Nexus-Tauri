import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, Square, Play } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabaseClient";
import { notifyToast } from "@/lib/toastEvents";
import { useSyncProgress } from "@/contexts/SyncProgressContext";
import { tickSyncWorker } from "@/services/library/syncService";
import type { SyncMediaType, SyncRun, SyncProgressRow } from "@/services/library/syncService";
import "./SyncProgressSidebar.css";

const STALL_AFTER_MS = 120_000;
const FRESH_WINDOW_MS = 3 * 60 * 60 * 1000;

const STAGE_LABELS: Record<string, string> = {
  import: "Import",
  enrich: "Enrichissement",
  translate: "Traduction",
};

function percentage(processed: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((Math.min(Math.max(processed, 0), total) / total) * 100);
}

function stallAge(stages: SyncProgressRow[], activeRun: SyncRun | null): number | null {
  if (!activeRun || (activeRun.status !== "running" && activeRun.status !== "queued")) return null;
  const anyIncomplete = stages.some((s) => s.total > 0 && s.processed < s.total);
  if (!anyIncomplete) return null;
  const freshest = stages.reduce((max, s) => {
    const t = s.updated_at ? new Date(s.updated_at).getTime() : 0;
    return Math.max(max, t);
  }, 0);
  if (freshest === 0) return null;
  const age = Date.now() - freshest;
  return age > STALL_AFTER_MS ? age : null;
}

type Freshness = "running" | "fresh" | "stale" | "never";

function getFreshness(activeRun: SyncRun | null, recentRuns: SyncRun[]): Freshness {
  if (activeRun && (activeRun.status === "queued" || activeRun.status === "running")) return "running";
  // Les runs "failed" (enrich/translate partiels) comptent comme une sync récente
  const last = recentRuns.find((r) => r.status === "completed" || r.status === "failed");
  if (!last?.finished_at) return "never";
  const delta = Date.now() - new Date(last.finished_at).getTime();
  return delta <= FRESH_WINDOW_MS ? "fresh" : "stale";
}

function freshnessLabel(f: Freshness): string {
  if (f === "running") return "En cours";
  if (f === "fresh") return "À jour";
  if (f === "stale") return "En attente";
  return "Jamais synchronisé";
}

/**
 * ETA calculée côté client et décomptée chaque seconde.
 * Utilise le taux courant (rate_per_min backend ou taux local elapsed/processed)
 * et fait décompter le résultat entre chaque mise à jour backend.
 *
 * Pour le premier run : dès les premières entrées traitées on dispose d'un taux
 * local (processed / elapsed). Pour les runs suivants, le taux se stabilise vite.
 */
function useTickingEta(opts: {
  isActive: boolean;
  startedAt: string | null | undefined;
  processed: number;
  total: number;
  ratePerMin: number | null | undefined;
}): number | null {
  const { isActive, startedAt, processed, total, ratePerMin } = opts;

  // base = ETA recalculée à chaque nouveau datum, baseTime = quand on l'a calculée
  const baseEtaRef = useRef<number | null>(null);
  const baseTimeRef = useRef<number>(Date.now());
  const [, setTick] = useState(0);

  // Recalcule la base dès que processed / ratePerMin change
  useEffect(() => {
    if (!isActive || total <= 0 || processed <= 0) {
      baseEtaRef.current = null;
      return;
    }
    const remaining = Math.max(0, total - processed);

    let etaS: number | null = null;

    // 1er choix : taux fourni par le backend (rate_per_min mis à jour par Realtime)
    if (ratePerMin && ratePerMin > 0) {
      etaS = (remaining / ratePerMin) * 60;
    }

    // Fallback : taux local calculé à partir du temps écoulé depuis le début du run
    if ((etaS === null || etaS <= 0) && startedAt) {
      const elapsedS = (Date.now() - new Date(startedAt).getTime()) / 1000;
      if (elapsedS > 2 && processed > 0) {
        const localRate = processed / elapsedS; // items/s
        if (localRate > 0) etaS = remaining / localRate;
      }
    }

    if (etaS !== null && etaS > 0) {
      baseEtaRef.current = etaS;
      baseTimeRef.current = Date.now();
    }
  }, [isActive, processed, total, ratePerMin, startedAt]);

  // Tick chaque seconde pour décompter l'affichage
  useEffect(() => {
    if (!isActive) return;
    const id = window.setInterval(() => setTick((n) => n + 1), 1_000);
    return () => window.clearInterval(id);
  }, [isActive]);

  if (!isActive || baseEtaRef.current === null) return null;
  const elapsedSinceCalc = (Date.now() - baseTimeRef.current) / 1000;
  return Math.max(0, Math.round(baseEtaRef.current - elapsedSinceCalc));
}

/**
 * Retourne l'étape "courante" à afficher : l'étape en cours de traitement
 * (la plus récemment mise à jour avec des données réelles).
 * Avec l'exécution séquentielle, une seule étape est active à la fois.
 */
function getCurrentStage(stages: SyncProgressRow[]): SyncProgressRow | null {
  if (stages.length === 0) return null;
  // Étape en cours : processed > 0 et pas encore à 100 %
  const inProgress = stages.filter((s) => s.processed > 0 && s.processed < s.total);
  if (inProgress.length > 0) {
    // La plus récemment mise à jour
    return inProgress.reduce((latest, s) => {
      const t = s.updated_at ? new Date(s.updated_at).getTime() : 0;
      const lt = latest.updated_at ? new Date(latest.updated_at).getTime() : 0;
      return t > lt ? s : latest;
    });
  }
  // Toutes terminées ou pas encore démarrées → la plus récemment touchée
  return stages.reduce((latest, s) => {
    const t = s.updated_at ? new Date(s.updated_at).getTime() : 0;
    const lt = latest.updated_at ? new Date(latest.updated_at).getTime() : 0;
    return t > lt ? s : latest;
  });
}

type RunBlockProps = {
  label: string;
  activeRun: SyncRun | null;
  stages: SyncProgressRow[];
  recentRuns: SyncRun[];
  anyOtherActive: boolean;
  onSync: () => void;
  syncLoading: boolean;
};

function RunBlock({
  label,
  activeRun,
  stages,
  recentRuns,
  anyOtherActive,
  onSync,
  syncLoading,
}: RunBlockProps) {
  const stall = stallAge(stages, activeRun);
  const lastRun = recentRuns.find((r) => r.status === "completed" || r.status === "failed");
  const isActive = Boolean(
    activeRun && (activeRun.status === "queued" || activeRun.status === "running")
  );
  const freshness = getFreshness(activeRun, recentRuns);
  const hasNoStagesYet = isActive && stages.length === 0;
  const currentStage = useMemo(() => getCurrentStage(stages), [stages]);
  const currentStagePct = currentStage ? percentage(currentStage.processed, currentStage.total) : 0;

  const etaSeconds = useTickingEta({
    isActive,
    startedAt: activeRun?.started_at,
    processed: currentStage?.processed ?? 0,
    total: currentStage?.total ?? 0,
    ratePerMin: currentStage?.rate_per_min,
  });

  const canSync = !isActive && !anyOtherActive && !syncLoading;

  return (
    <div className={`sync-sidebar-run-block${isActive ? " is-active" : ""}`}>
      {/* En-tête de section */}
      <div className="sync-sidebar-run-header">
        <div className="sync-sidebar-run-header-left">
          <span className={`sync-sidebar-freshness-dot is-${freshness}`} aria-hidden />
          <span className="sync-sidebar-run-label">{label}</span>
          <span className={`sync-sidebar-freshness-pill is-${freshness}`}>
            {freshnessLabel(freshness)}
          </span>
        </div>
        <div className="sync-sidebar-run-header-right">
          {/* Temps restant calculé client-side, uniquement pendant un run */}
          {isActive && etaSeconds !== null && etaSeconds > 5 && (
            <span className="sync-sidebar-run-eta">
              ~{etaSeconds < 60
                ? `${etaSeconds}s`
                : `${Math.floor(etaSeconds / 60)}m${etaSeconds % 60 > 0 ? ` ${etaSeconds % 60}s` : ""}`}
            </span>
          )}
          {/* Bouton lancer — uniquement quand idle */}
          {!isActive && (
            <button
              type="button"
              className="sync-sidebar-play-btn"
              disabled={!canSync}
              title={anyOtherActive ? "Une autre sync est en cours" : `Synchroniser ${label}`}
              onClick={onSync}
            >
              <Play size={9} fill="currentColor" />
            </button>
          )}
        </div>
      </div>

      {/* Dernière sync (date seulement, sans la source) */}
      {!isActive && lastRun?.finished_at ? (
        <p className="sync-sidebar-last-sync">
          Dernière sync :{" "}
          {new Date(lastRun.finished_at).toLocaleString("fr-FR", {
            day: "2-digit",
            month: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
      ) : null}

      {/* Spinner de démarrage (avant la 1re progress row) */}
      {hasNoStagesYet ? (
        <div className="sync-sidebar-starting">
          <span className="sync-sidebar-starting-spinner" aria-hidden />
          <span>Démarrage…</span>
        </div>
      ) : null}

      {/* Alerte blocage */}
      {stall !== null ? (
        <p className="sync-sidebar-stall-hint">
          ⚠ Aucune activité depuis {Math.max(1, Math.round(stall / 60_000))} min
        </p>
      ) : null}

      {/* Étape courante — une seule barre (exécution séquentielle) */}
      {isActive && currentStage ? (() => {
        const s = currentStage;
        const isPrefetching = s.stage === "import" && s.total === 0 && Boolean(s.current_item_label);
        const displayProcessed = Math.min(s.processed, s.total);
        const stageLabel = STAGE_LABELS[s.stage] ?? s.stage;
        return (
          <article className="sync-sidebar-stage">
            <div className="sync-sidebar-stage-head">
              <span className="sync-sidebar-stage-name">{stageLabel}</span>
              {isPrefetching ? (
                <span className="sync-sidebar-prefetch-label">décompte…</span>
              ) : (
                <span>
                  {displayProcessed}/{s.total} ({currentStagePct}%)
                </span>
              )}
            </div>
            {!isPrefetching && (
              <div className="sync-sidebar-bar">
                <div style={{ width: `${currentStagePct}%` }} />
              </div>
            )}
            {s.current_item_label && !isPrefetching ? (
              <small className="sync-sidebar-item-label" title={s.current_item_label}>
                {s.current_item_label}
              </small>
            ) : null}
          </article>
        );
      })() : null}
    </div>
  );
}

export function SyncProgressSidebar() {
  const {
    animeActiveRun,
    animeStages,
    animeRecentRuns,
    readingActiveRun,
    readingStages,
    readingRecentRuns,
    loading,
    error,
    startFullSync,
    refresh,
    cancelRun,
  } = useSyncProgress();

  const [collapsed, setCollapsed] = useState(false);
  const [pokingWorker, setPokingWorker] = useState(false);
  const [syncingAnime, setSyncingAnime] = useState(false);
  const [syncingReading, setSyncingReading] = useState(false);

  const animeActive = Boolean(
    animeActiveRun && (animeActiveRun.status === "queued" || animeActiveRun.status === "running")
  );
  const readingActive = Boolean(
    readingActiveRun && (readingActiveRun.status === "queued" || readingActiveRun.status === "running")
  );
  const anyActive = animeActive || readingActive;

  const pokeWorker = useCallback(async () => {
    setPokingWorker(true);
    try {
      const supabase = getSupabaseClient();
      await tickSyncWorker(supabase).catch(() => undefined);
      await refresh();
    } finally {
      setPokingWorker(false);
    }
  }, [refresh]);

  async function handleStop() {
    try {
      if (animeActive) await cancelRun("anime");
      else if (readingActive) await cancelRun("reading");
      notifyToast({ kind: "success", message: "Synchronisation annulée." });
    } catch (e) {
      notifyToast({
        kind: "error",
        message: e instanceof Error ? e.message : "Annulation impossible.",
      });
    }
  }

  async function handleSync(mediaType: SyncMediaType) {
    const setFlag = mediaType === "anime" ? setSyncingAnime : setSyncingReading;
    setFlag(true);
    try {
      await startFullSync(mediaType);
    } catch (e) {
      notifyToast({
        kind: "error",
        message: e instanceof Error ? e.message : "Impossible de lancer la synchronisation.",
      });
    } finally {
      setFlag(false);
    }
  }

  return (
    <section className="sync-sidebar">
      <header className="sync-sidebar-head">
        <strong className="sync-sidebar-title">Synchronisation</strong>
        <div className="sync-sidebar-head-actions">
          {/* Arrêt global — uniquement quand un run est actif */}
          {anyActive && (
            <button
              type="button"
              className="sync-sidebar-mini-btn is-stop"
              title="Arrêter la synchronisation"
              onClick={() => void handleStop()}
            >
              <Square size={9} fill="currentColor" />
            </button>
          )}
          {/* Forcer le worker — uniquement quand actif */}
          {anyActive && (
            <button
              type="button"
              className={`sync-sidebar-mini-btn${pokingWorker ? " is-poking" : ""}`}
              disabled={pokingWorker || loading}
              title="Forcer le worker"
              onClick={() => void pokeWorker()}
            >
              <RefreshCw size={11} className={pokingWorker ? "spin" : ""} />
            </button>
          )}
          {/* Replier / déplier — toujours visible */}
          <button
            type="button"
            className="sync-sidebar-mini-btn"
            onClick={() => setCollapsed((v) => !v)}
            title={collapsed ? "Déplier" : "Replier"}
          >
            {collapsed ? "▾" : "▴"}
          </button>
        </div>
      </header>

      {collapsed ? null : (
        <div className="sync-sidebar-body">
          {error ? <p className="sync-sidebar-error">{error}</p> : null}

          <RunBlock
            label="Animés"
            activeRun={animeActiveRun}
            stages={animeStages}
            recentRuns={animeRecentRuns}
            anyOtherActive={readingActive}
            onSync={() => void handleSync("anime")}
            syncLoading={syncingAnime || loading}
          />
          <RunBlock
            label="Lectures"
            activeRun={readingActiveRun}
            stages={readingStages}
            recentRuns={readingRecentRuns}
            anyOtherActive={animeActive}
            onSync={() => void handleSync("reading")}
            syncLoading={syncingReading || loading}
          />
        </div>
      )}
    </section>
  );
}
