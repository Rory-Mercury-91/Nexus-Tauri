import { useMemo, useState } from "react";
import { useSyncProgress } from "@/contexts/SyncProgressContext";
import type { SyncRun } from "@/services/library/syncService";

const DISMISSED_KEY = "sync:report:dismissed-runs";

function loadDismissed(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    const arr = raw ? (JSON.parse(raw) as string[]) : [];
    return new Set(arr);
  } catch {
    return new Set();
  }
}

function saveDismissed(ids: Set<string>) {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...ids]));
  } catch {
    /* ignore */
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type ReportRunProps = {
  run: SyncRun;
  dismissed: Set<string>;
  onDismiss: (id: string) => void;
  onRestore: (id: string) => void;
};

function ReportRun({ run, dismissed, onDismiss, onRestore }: ReportRunProps) {
  const [expanded, setExpanded] = useState(true);
  const isDismissed = dismissed.has(run.id);

  const lines = useMemo(() => {
    const report = run.import_report;
    if (!report) return [];
    const all: string[] = [];
    const source = run.source;

    const ns = run.media_type === "anime" ? report.anime : report.reading;
    if (!ns) return [];

    const c = ns.from_mal_created ?? 0;
    const u = ns.from_mal_updated ?? 0;
    if (c + u > 0) {
      all.push(`✅ Importés depuis MAL : ${c + u} (${c} créés, ${u} mis à jour)`);
    }
    if (source === "anilist") {
      const ac = ns.from_anilist_created ?? 0;
      const au = ns.from_anilist_updated ?? 0;
      if (ac + au > 0) {
        all.push(`✅ Importés depuis AniList : ${ac + au} (${ac} créés, ${au} mis à jour)`);
      } else {
        all.push(`ℹ AniList : 0 importés (entrées avec MAL ID ignorées — déjà couvertes par MAL)`);
      }
    }
    const skip = ns.anilist_skipped_has_mal_id ?? 0;
    if (skip > 0) {
      all.push(`↩ AniList ignorées (MAL ID présent — données MAL prioritaires) : ${skip}`);
    }
    const overlap = ns.mal_also_on_anilist ?? 0;
    if (overlap > 0) {
      all.push(`🔗 Présents à la fois sur MAL et AniList : ${overlap}`);
    }
    const noMal = ns.anilist_no_mal_id_count ?? 0;
    if (noMal > 0) {
      const titles = (ns.anilist_no_mal_id_titles ?? []).slice(0, 20);
      const suffix = titles.length > 0 ? ` — Exemples : ${titles.join(" · ")}` : "";
      all.push(`⚠ AniList sans MAL ID (non importés) : ${noMal}${suffix}`);
    }
    return all;
  }, [run]);

  if (lines.length === 0) return null;

  const statusColor =
    run.status === "completed" ? "var(--success)" :
    run.status === "failed" ? "var(--error)" : "var(--text-secondary)";

  return (
    <article className={`sync-report-run${isDismissed ? " is-dismissed" : ""}`}>
      <div className="sync-report-run-head">
        <div className="sync-report-run-meta">
          <span className="sync-report-run-dot" style={{ background: statusColor }} />
          <strong className="sync-report-run-title">
            {run.source.toUpperCase()} — {run.media_type === "anime" ? "Animés" : "Lectures"}
          </strong>
          <span className="sync-report-run-date">{formatDate(run.finished_at)}</span>
        </div>
        <div className="sync-report-run-actions">
          {isDismissed ? (
            <button type="button" className="sync-report-btn-ghost" onClick={() => onRestore(run.id)}>
              Restaurer
            </button>
          ) : (
            <button type="button" className="sync-report-btn-ghost" onClick={() => onDismiss(run.id)}>
              Masquer
            </button>
          )}
          <button
            type="button"
            className="sync-report-btn-ghost"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "▴" : "▾"}
          </button>
        </div>
      </div>

      {expanded && !isDismissed ? (
        <ul className="sync-report-run-lines">
          {lines.map((line, i) => (
            <li key={i} className="sync-report-run-line">
              {line}
            </li>
          ))}
        </ul>
      ) : null}

      {isDismissed ? (
        <p className="sync-report-dismissed-label">Rapport masqué — clique sur Restaurer pour le revoir.</p>
      ) : null}
    </article>
  );
}

export function SyncReportPanel() {
  const { animeRecentRuns, readingRecentRuns } = useSyncProgress();
  const [dismissed, setDismissed] = useState<Set<string>>(loadDismissed);

  const allRuns = useMemo(() => {
    const combined = [...animeRecentRuns, ...readingRecentRuns].filter(
      (r) => r.status === "completed" && r.import_report
    );
    combined.sort((a, b) => {
      const ta = a.finished_at ? new Date(a.finished_at).getTime() : 0;
      const tb = b.finished_at ? new Date(b.finished_at).getTime() : 0;
      return tb - ta;
    });
    // Déduplique par id
    const seen = new Set<string>();
    return combined.filter((r) => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    });
  }, [animeRecentRuns, readingRecentRuns]);

  function dismiss(id: string) {
    const next = new Set(dismissed);
    next.add(id);
    setDismissed(next);
    saveDismissed(next);
  }

  function restore(id: string) {
    const next = new Set(dismissed);
    next.delete(id);
    setDismissed(next);
    saveDismissed(next);
  }

  function clearAllDismissed() {
    setDismissed(new Set());
    saveDismissed(new Set());
  }

  const hasDismissed = dismissed.size > 0;

  if (allRuns.length === 0) {
    return (
      <section className="settings-block" aria-labelledby="sync-report-title">
        <h2 id="sync-report-title" className="settings-block-title">Rapports de synchronisation</h2>
        <p className="settings-block-lead">
          Aucun rapport disponible. Lance une synchronisation depuis la barre latérale pour obtenir un rapport détaillé.
        </p>
      </section>
    );
  }

  return (
    <section className="settings-block" aria-labelledby="sync-report-title">
      <div className="sync-report-header">
        <div>
          <h2 id="sync-report-title" className="settings-block-title">Rapports de synchronisation</h2>
          <p className="settings-block-lead">
            Historique des {allRuns.length} dernière(s) synchronisation(s) complétée(s).
            Les rapports sont conservés jusqu'à ce que tu les masques.
          </p>
        </div>
        {hasDismissed ? (
          <button type="button" className="sync-report-btn-secondary" onClick={clearAllDismissed}>
            Afficher tout ({dismissed.size} masqué{dismissed.size > 1 ? "s" : ""})
          </button>
        ) : null}
      </div>

      <div className="sync-report-list">
        {allRuns.map((run) => (
          <ReportRun
            key={run.id}
            run={run}
            dismissed={dismissed}
            onDismiss={dismiss}
            onRestore={restore}
          />
        ))}
      </div>
    </section>
  );
}
