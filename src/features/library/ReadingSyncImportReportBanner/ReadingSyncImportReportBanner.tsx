import { useCallback } from "react";
import type { SyncImportReportBundle, SyncSource } from "@/services/library/syncService";
import { formatReadingSyncImportReportLines } from "@/services/library/readingSyncImportReport";
import "./ReadingSyncImportReportBanner.css";

type Props = {
  runId: string;
  source: SyncSource;
  report: SyncImportReportBundle;
  onDismiss: () => void;
};

export function ReadingSyncImportReportBanner({ runId, source, report, onDismiss }: Props) {
  const reading = report.reading;
  const lines = reading ? formatReadingSyncImportReportLines(reading, source) : [];

  const dismiss = useCallback(() => {
    try {
      sessionStorage.setItem(`reading:sync-report-dismissed:${runId}`, "1");
    } catch {
      /* ignore */
    }
    onDismiss();
  }, [onDismiss, runId]);

  if (lines.length === 0) {
    return null;
  }

  return (
    <aside className="reading-sync-import-report" role="status">
      <div className="reading-sync-import-report-inner">
        <strong className="reading-sync-import-report-title">Rapport de synchronisation (liste manga)</strong>
        <ul className="reading-sync-import-report-list">
          {lines.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
        <button type="button" className="reading-sync-import-report-ok" onClick={dismiss}>
          OK
        </button>
      </div>
    </aside>
  );
}
