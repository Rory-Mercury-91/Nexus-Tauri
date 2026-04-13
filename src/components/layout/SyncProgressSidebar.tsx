import { useCallback, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabaseClient";
import { notifyToast } from "@/lib/toastEvents";
import { useSyncProgress } from "@/contexts/SyncProgressContext";
import { useReadingSyncProgress } from "@/contexts/ReadingSyncProgressContext";
import {
  cancelActiveSyncRun,
  tickAnimeSyncWorker,
  tickReadingSyncWorker,
} from "@/services/library/syncService";
import "./SyncProgressSidebar.css";

/** Aucune étape (sync_progress) n’a bougé depuis ce délai → alerte (aligné ~reprise worker côté serveur). */
const STALL_AFTER_MS = 180_000;

function percentage(processed: number, total: number): number {
  if (total <= 0) {
    return 0;
  }
  const safeProcessed = Math.min(Math.max(processed, 0), total);
  return Math.round((safeProcessed / total) * 100);
}

export function SyncProgressSidebar() {
  const anime = useSyncProgress();
  const reading = useReadingSyncProgress();
  const [collapsed, setCollapsed] = useState(false);
  const [pokingWorker, setPokingWorker] = useState(false);
  const [cancellingSync, setCancellingSync] = useState(false);
  const activeRun = reading.activeRun ?? anime.activeRun;
  const stages = reading.activeRun ? reading.stages : anime.stages;
  const loading = reading.loading || anime.loading;
  const error = reading.error ?? anime.error;
  const refreshAll = useCallback(async () => {
    await reading.refresh();
    await anime.refresh();
  }, [reading.refresh, anime.refresh]);
  const label = activeRun?.media_type === "reading" ? "Sync lectures" : "Sync animé";

  const stageBlocks = useMemo(
    () =>
      stages.map((stage) => ({
        ...stage,
        pct: percentage(stage.processed, stage.total),
      })),
    [stages]
  );

  /** Blocage réel = aucune étape n’a bougé depuis STALL_AFTER_MS (évite le faux positif « import » figé pendant enrich). */
  const stallInfo = useMemo(() => {
    if (!activeRun || (activeRun.status !== "running" && activeRun.status !== "queued")) {
      return null;
    }
    const anyIncomplete = stages.some((s) => s.total > 0 && s.processed < s.total);
    if (!anyIncomplete) {
      return null;
    }
    const now = Date.now();
    let freshest = 0;
    for (const s of stages) {
      if (s.updated_at) {
        freshest = Math.max(freshest, new Date(s.updated_at).getTime());
      }
    }
    if (freshest === 0) {
      return null;
    }
    const ageMs = now - freshest;
    if (ageMs <= STALL_AFTER_MS) {
      return null;
    }
    return { ageMs };
  }, [activeRun, stages]);

  const pokeWorker = useCallback(async () => {
    setPokingWorker(true);
    try {
      const supabase = getSupabaseClient();
      await Promise.all([
        tickReadingSyncWorker(supabase).catch(() => undefined),
        tickAnimeSyncWorker(supabase).catch(() => undefined),
      ]);
      await refreshAll();
    } finally {
      setPokingWorker(false);
    }
  }, [refreshAll]);

  const cancelActiveSync = useCallback(async () => {
    if (!activeRun?.media_type) {
      return;
    }
    setCancellingSync(true);
    try {
      const supabase = getSupabaseClient();
      const result = await cancelActiveSyncRun(supabase, activeRun.media_type);
      await refreshAll();
      if (result.cancelled) {
        notifyToast({ kind: "success", message: "Synchronisation annulée. Tu peux relancer quand tu veux." });
      } else {
        notifyToast({ kind: "info", message: result.message ?? "Aucune synchronisation active à annuler." });
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Annulation impossible.";
      notifyToast({ kind: "error", message });
    } finally {
      setCancellingSync(false);
    }
  }, [activeRun?.media_type, refreshAll]);

  if (!activeRun && !error) {
    return null;
  }

  return (
    <section className="sync-sidebar">
      <header className="sync-sidebar-head">
        <strong>
          {label} {activeRun ? `(${activeRun.source.toUpperCase()})` : ""}
        </strong>
        <div className="sync-sidebar-head-actions">
          {activeRun && (activeRun.status === "running" || activeRun.status === "queued") ? (
            <button
              type="button"
              className="sync-sidebar-cancel-btn"
              disabled={cancellingSync || loading}
              title="Annule la file (import / enrich / trad) pour ce type de média"
              onClick={() => void cancelActiveSync()}
            >
              {cancellingSync ? "…" : "Arrêter"}
            </button>
          ) : null}
          <button type="button" className="sync-sidebar-mini-btn" onClick={() => setCollapsed((v) => !v)}>
            {collapsed ? "▾" : "▴"}
          </button>
          <button
            type="button"
            className="sync-sidebar-mini-btn"
            disabled={loading}
            title="Rafraîchir l’état"
            onClick={() => void refreshAll()}
          >
            <RefreshCw size={12} />
          </button>
        </div>
      </header>

      {collapsed ? null : (
        <div className="sync-sidebar-body">
          {error ? <p className="sync-sidebar-error">{error}</p> : null}
          {activeRun ? (
            <p className={`sync-sidebar-run sync-sidebar-run-${activeRun.status}`}>
              {activeRun.status === "running" || activeRun.status === "queued"
                ? `Dernier job côté serveur : ${activeRun.current_stage ?? "import"} (la file peut être sur une autre étape)`
                : activeRun.status === "completed"
                ? "Synchronisation terminée"
                : "Synchronisation en erreur"}
            </p>
          ) : null}

          {activeRun && (activeRun.status === "running" || activeRun.status === "queued") ? (
            <p className="sync-sidebar-hint">
              Les lots d’import de liste passent en premier ; enrichissement Jikan et traduction démarrent après la fin de
              l’import (plus d’entremêlement).
            </p>
          ) : null}

          {stallInfo ? (
            <div className="sync-sidebar-stall">
              <p>
                Aucune mise à jour sur aucune étape depuis {Math.max(1, Math.round(stallInfo.ageMs / 60_000))} min. Le
                worker peut reprendre après un timeout ; tu peux forcer un passage.
              </p>
              <button type="button" className="sync-sidebar-stall-btn" disabled={pokingWorker} onClick={() => void pokeWorker()}>
                {pokingWorker ? "Relance…" : "Relancer le worker"}
              </button>
            </div>
          ) : null}

          {stageBlocks.map((stage) => (
            <article key={stage.stage} className="sync-sidebar-stage">
              <div className="sync-sidebar-stage-head">
                <span>{stage.stage}</span>
                <span>
                  {stage.processed}/{stage.total} ({stage.pct}%)
                </span>
              </div>
              <div className="sync-sidebar-bar">
                <div style={{ width: `${stage.pct}%` }} />
              </div>
              {stage.current_item_label ? (
                <small title={stage.current_item_label}>{stage.current_item_label}</small>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
