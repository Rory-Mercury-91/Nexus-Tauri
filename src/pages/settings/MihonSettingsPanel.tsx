import { type ChangeEvent, useCallback, useEffect, useRef, useState } from "react";
import { useDataFetchOverlay } from "@/contexts/DataFetchOverlayContext";
import {
  getMihonSourceIndexStats,
  MIHON_KEIYOUSHI_INDEX_URL,
  refreshMihonSourceIndex,
} from "@/services/library/mihonSourceIndexService";
import {
  importMihonBackupFile,
  type MihonImportProgress,
  type MihonImportResult,
} from "@/services/library/mihonBackupImportService";

export function MihonSettingsPanel() {
  const { beginPageDataLoad, endPageDataLoad } = useDataFetchOverlay();
  const [mihonIndexBusy, setMihonIndexBusy] = useState(false);
  const [mihonIndexInfo, setMihonIndexInfo] = useState<string | null>(null);
  const [mihonIndexError, setMihonIndexError] = useState<string | null>(null);
  const [mihonIndexStats, setMihonIndexStats] = useState<{
    total: number;
    lastFetchedAt: string | null;
  } | null>(null);
  const backupFileInputRef = useRef<HTMLInputElement | null>(null);
  const [mihonImportBusy, setMihonImportBusy] = useState(false);
  const [mihonImportProgress, setMihonImportProgress] = useState<MihonImportProgress | null>(null);
  const [mihonImportResult, setMihonImportResult] = useState<MihonImportResult | null>(null);
  const [mihonImportError, setMihonImportError] = useState<string | null>(null);

  const loadMihonIndexStats = useCallback(async () => {
    try {
      const stats = await getMihonSourceIndexStats();
      setMihonIndexStats(stats);
    } catch (error) {
      console.error("Erreur chargement stats index MIHON:", error);
      setMihonIndexStats(null);
    }
  }, []);

  useEffect(() => {
    void loadMihonIndexStats();
  }, [loadMihonIndexStats]);

  const handleRefreshMihonIndex = useCallback(async () => {
    setMihonIndexBusy(true);
    setMihonIndexInfo(null);
    setMihonIndexError(null);
    beginPageDataLoad();
    try {
      const result = await refreshMihonSourceIndex();
      await loadMihonIndexStats();
      setMihonIndexInfo(
        `Index MIHON mis à jour (${result.imported} source${result.imported > 1 ? "s" : ""} traitée${result.imported > 1 ? "s" : ""}).`
      );
    } catch (error) {
      console.error("Erreur mise à jour index MIHON:", error);
      setMihonIndexError(
        error instanceof Error
          ? error.message
          : "Impossible de mettre à jour l'index MIHON."
      );
    } finally {
      setMihonIndexBusy(false);
      endPageDataLoad();
    }
  }, [beginPageDataLoad, endPageDataLoad, loadMihonIndexStats]);

  const openMihonBackupPicker = useCallback(() => {
    backupFileInputRef.current?.click();
  }, []);

  const handleMihonBackupSelected = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) {
        return;
      }
      setMihonImportBusy(true);
      setMihonImportError(null);
      setMihonImportResult(null);
      setMihonImportProgress({
        total: 0,
        current: 0,
        created: 0,
        updated: 0,
        skipped: 0,
        errors: 0,
        item: "Initialisation...",
      });
      beginPageDataLoad();
      try {
        const result = await importMihonBackupFile(file, (progress) => {
          setMihonImportProgress(progress);
        });
        setMihonImportResult(result);
      } catch (error) {
        console.error("Erreur import backup MIHON:", error);
        setMihonImportError(
          error instanceof Error ? error.message : "Erreur pendant l'import backup MIHON."
        );
      } finally {
        setMihonImportBusy(false);
        endPageDataLoad();
      }
    },
    [beginPageDataLoad, endPageDataLoad]
  );

  return (
    <div className="integrations-settings">
      <section className="settings-block integrations-settings-block" aria-labelledby="mihon-index">
        <h2 id="mihon-index" className="settings-block-title">
          Index MIHON / Tachiyomi
        </h2>
        <p className="settings-block-lead">
          Met à jour la base locale des sources/extensions depuis Keiyoushi pour résoudre les URL de source.
        </p>
        <p className="settings-block-lead">
          Source catalogue:{" "}
          <a href={MIHON_KEIYOUSHI_INDEX_URL} target="_blank" rel="noreferrer">
            index.min.json
          </a>
        </p>
        {mihonIndexStats ? (
          <p className="settings-block-lead">
            {mihonIndexStats.total} source{mihonIndexStats.total > 1 ? "s" : ""} en base
            {mihonIndexStats.lastFetchedAt
              ? ` — dernière mise à jour: ${new Date(mihonIndexStats.lastFetchedAt).toLocaleString("fr-FR")}`
              : ""}
          </p>
        ) : null}
        {mihonIndexError ? <p className="settings-error">{mihonIndexError}</p> : null}
        {mihonIndexInfo ? <p className="settings-success">{mihonIndexInfo}</p> : null}
        <div className="integrations-actions">
          <button
            type="button"
            className="integrations-connect-btn"
            onClick={() => void handleRefreshMihonIndex()}
            disabled={mihonIndexBusy}
          >
            {mihonIndexBusy ? "Mise à jour…" : "Mettre à jour l'index"}
          </button>
        </div>
      </section>

      <section className="settings-block integrations-settings-block" aria-labelledby="mihon-backup">
        <h2 id="mihon-backup" className="settings-block-title">
          Import backup MIHON
        </h2>
        <p className="settings-block-lead">
          Importe les lectures depuis un fichier backup `.tachibk` (Mihon/Tachiyomi).
        </p>
        <div className="integrations-actions">
          <input
            ref={backupFileInputRef}
            type="file"
            accept=".tachibk,application/gzip"
            style={{ display: "none" }}
            onChange={(event) => void handleMihonBackupSelected(event)}
          />
          <button
            type="button"
            className="integrations-connect-btn"
            onClick={() => void openMihonBackupPicker()}
            disabled={mihonImportBusy}
          >
            {mihonImportBusy ? "Import en cours…" : "Sélectionner et importer"}
          </button>
        </div>
        {mihonImportProgress ? (
          <p className="settings-block-lead">
            {mihonImportProgress.current}/{mihonImportProgress.total} — créés:{" "}
            {mihonImportProgress.created}, mis à jour: {mihonImportProgress.updated}, erreurs:{" "}
            {mihonImportProgress.errors}
            {mihonImportProgress.item ? ` (${mihonImportProgress.item})` : ""}
          </p>
        ) : null}
        {mihonImportError ? <p className="settings-error">{mihonImportError}</p> : null}
        {mihonImportResult ? (
          <>
            <p className="settings-success">
              Import terminé: {mihonImportResult.created} créés, {mihonImportResult.updated} mis à
              jour, {mihonImportResult.errors} erreur(s), {mihonImportResult.withMalId} avec MAL
              ID.
            </p>
            {mihonImportResult.details.length > 0 ? (
              <details>
                <summary style={{ cursor: "pointer" }}>Voir le détail des erreurs</summary>
                <ul style={{ marginTop: "8px" }}>
                  {mihonImportResult.details.slice(0, 20).map((entry, idx) => (
                    <li key={`${entry.title}-${idx}`}>
                      {entry.title}: {entry.error}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </>
        ) : null}
      </section>

    </div>
  );
}
