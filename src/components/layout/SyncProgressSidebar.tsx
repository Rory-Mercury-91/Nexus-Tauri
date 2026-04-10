import { useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useSyncProgress } from "@/contexts/SyncProgressContext";
import { useReadingSyncProgress } from "@/contexts/ReadingSyncProgressContext";
import "./SyncProgressSidebar.css";

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
  const activeRun = reading.activeRun ?? anime.activeRun;
  const stages = reading.activeRun ? reading.stages : anime.stages;
  const loading = reading.loading || anime.loading;
  const error = reading.error ?? anime.error;
  const refresh = reading.activeRun ? reading.refresh : anime.refresh;
  const label = activeRun?.media_type === "reading" ? "Sync lectures" : "Sync animé";

  const stageBlocks = useMemo(
    () =>
      stages.map((stage) => ({
        ...stage,
        pct: percentage(stage.processed, stage.total),
      })),
    [stages]
  );

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
          <button type="button" className="sync-sidebar-mini-btn" onClick={() => setCollapsed((v) => !v)}>
            {collapsed ? "▾" : "▴"}
          </button>
          <button type="button" className="sync-sidebar-mini-btn" disabled={loading} onClick={() => void refresh()}>
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
                ? `Étape: ${activeRun.current_stage ?? "import"}`
                : activeRun.status === "completed"
                ? "Synchronisation terminée"
                : "Synchronisation en erreur"}
            </p>
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
