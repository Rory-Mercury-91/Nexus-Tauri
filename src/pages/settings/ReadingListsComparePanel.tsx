import { useCallback, useMemo, useState } from "react";
import { ExternalLink as ExternalLinkIcon } from "lucide-react";
import { getAnilistMangaCatalogUrl, getMalMangaCatalogUrl } from "@/lib/readingCatalogLinks";
import { openExternalUrl } from "@/lib/tauriWindow";
import { getSupabaseClient } from "@/lib/supabaseClient";
import {
  type IntegrationConnectionStatus,
  type IntegrationProvider,
} from "@/services/integrations/integrationService";
import { removeReadingFromExternalList } from "@/services/library/externalReadingListDeleteService";
import {
  filterReadingEntryDiagnostics,
  type FullReadingDiagnosticsResult,
  type ReadingListCompareFilter,
  type ReadingEntryDiagnostic,
} from "@/services/library/readingListDiagnosticsService";

export type ReadingListsComparePanelProps = {
  integrationByProvider: Record<
    IntegrationProvider,
    { status: IntegrationConnectionStatus; error: string | null }
  >;
  readingDiagnostics: FullReadingDiagnosticsResult | null;
  readingDiagLoading: boolean;
  readingDiagError: string | null;
  diagnosticsCachedAt: number | null;
  onRunDiagnostics: (opts?: { withPageOverlay?: boolean }) => Promise<void>;
};

function ReadingCatalogLink({
  href,
  tooltip,
  ariaLabel,
}: {
  href: string;
  tooltip: string;
  ariaLabel: string;
}) {
  return (
    <a
      href={href}
      className="reading-lists-compare-catalog-link"
      target="_blank"
      rel="noreferrer noopener"
      title={tooltip}
      aria-label={ariaLabel}
      onClick={(e) => {
        e.preventDefault();
        void (async () => {
          const opened = await openExternalUrl(href);
          if (!opened) {
            window.open(href, "_blank", "noopener,noreferrer");
          }
        })();
      }}
    >
      <ExternalLinkIcon size={14} strokeWidth={2} aria-hidden />
    </a>
  );
}

const FILTER_OPTIONS: Array<{ value: ReadingListCompareFilter; label: string }> = [
  { value: "all", label: "Toutes les fiches" },
  { value: "nexus_no_mal_id", label: "Sans MAL id (Nexus)" },
  { value: "comparable_only", label: "Avec MAL id (comparables)" },
  { value: "both_remotes", label: "Présent MAL + AniList" },
  { value: "mal_only_remote", label: "Seulement mangalist MAL" },
  { value: "anilist_only_remote", label: "Seulement liste AniList" },
  { value: "mal_anilist_desync", label: "Désync (un seul des deux services)" },
  { value: "nexus_absent_both", label: "Nexus seul (absent MAL et AniList)" },
];

/**
 * Onglet Paramètres : comparaison library_reading ↔ MAL / AniList.
 * L’état de diagnostic est conservé au niveau de la page (cache session) pour survivre aux changements d’onglet.
 */
export function ReadingListsComparePanel({
  integrationByProvider,
  readingDiagnostics: readingDiagData,
  readingDiagLoading,
  readingDiagError,
  diagnosticsCachedAt,
  onRunDiagnostics: runReadingDiagnostics,
}: ReadingListsComparePanelProps) {
  const [globalInfo, setGlobalInfo] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [readingListDeleteBusyKey, setReadingListDeleteBusyKey] = useState<string | null>(null);
  const [rowFilter, setRowFilter] = useState<ReadingListCompareFilter>("all");

  const handleRemoveFromExternalList = useCallback(
    async (
      provider: IntegrationProvider,
      row: { rowId: string; title: string; mal_manga_id: number }
    ) => {
      const label = provider === "mal" ? "MyAnimeList" : "AniList";
      if (!window.confirm(`Retirer « ${row.title} » de ta liste ${label} ?`)) {
        return;
      }
      const busyKey = `${provider}:${row.rowId}`;
      setActionError(null);
      setReadingListDeleteBusyKey(busyKey);
      try {
        const supabase = getSupabaseClient();
        const result = await removeReadingFromExternalList(supabase, {
          provider,
          malMangaId: row.mal_manga_id,
        });
        if (!result.ok) {
          setActionError(result.error);
          return;
        }
        setGlobalInfo(`Entrée retirée de ${label}.`);
        await runReadingDiagnostics({ withPageOverlay: false });
      } finally {
        setReadingListDeleteBusyKey(null);
      }
    },
    [runReadingDiagnostics]
  );

  const filteredEntries = useMemo(() => {
    if (!readingDiagData) {
      return [];
    }
    return filterReadingEntryDiagnostics(readingDiagData.entries, rowFilter);
  }, [readingDiagData, rowFilter]);

  const counts = useMemo(() => {
    if (!readingDiagData) {
      return null;
    }
    const e = readingDiagData.entries;
    return {
      total: e.length,
      noMalId: e.filter((r) => r.mal_manga_id <= 0).length,
      comparable: e.filter((r) => r.mal_manga_id > 0).length,
      desync: e.filter((r) => r.mal_manga_id > 0 && r.inMalList !== r.inAnilistList).length,
    };
  }, [readingDiagData]);

  const fetchError = readingDiagError ?? actionError;

  return (
    <div className="reading-lists-compare">
      {globalInfo ? <p className="settings-success">{globalInfo}</p> : null}

      <section className="settings-block reading-lists-compare-block" aria-labelledby="reading-lists-oauth-ro">
        <h2 id="reading-lists-oauth-ro" className="settings-block-title">
          Connexions MAL & AniList
        </h2>
        <p className="settings-block-lead">
          Les comparaisons utilisent tes jetons OAuth. Connecte ou déconnecte les comptes depuis l’onglet{" "}
          <strong>Intégrations</strong> — cet écran affiche seulement l’état courant.
        </p>
        <div className="reading-lists-compare-oauth-grid">
          {(["mal", "anilist"] as const).map((provider) => {
            const st = integrationByProvider[provider];
            const title = provider === "mal" ? "MyAnimeList" : "AniList";
            return (
              <div key={provider} className="reading-lists-compare-oauth-card">
                <h3 className="reading-lists-compare-oauth-title">{title}</h3>
                <p
                  className={
                    st.status.connected
                      ? "integrations-status integrations-status-connected"
                      : "integrations-status integrations-status-disconnected"
                  }
                >
                  {st.status.connected
                    ? `Connecté${st.status.accountLabel ? ` : ${st.status.accountLabel}` : ""}`
                    : "Non connecté"}
                </p>
                {st.error ? <p className="settings-error">{st.error}</p> : null}
              </div>
            );
          })}
        </div>
      </section>

      <section className="settings-block reading-lists-compare-block" aria-labelledby="reading-lists-analysis">
        <h2 id="reading-lists-analysis" className="settings-block-title">
          Analyse Nexus ↔ listes distantes
        </h2>
        <p className="settings-block-lead">
          Croise <strong>library_reading</strong> avec ta mangalist <strong>MAL</strong> et ta liste manga{" "}
          <strong>AniList</strong> (liaison AniList via <code>idMal</code> = <code>mal_manga_id</code> dans Nexus).
        </p>
        <p className="reading-lists-compare-catalog-hint settings-block-lead">
          Icône{" "}
          <ExternalLinkIcon size={14} className="reading-lists-compare-catalog-hint-icon" aria-hidden /> : ouvre la fiche
          publique sur le site (aperçu de l’œuvre).
        </p>

        <div className="reading-lists-compare-toolbar">
          <button
            type="button"
            className="integrations-connect-btn"
            disabled={readingDiagLoading}
            onClick={() => void runReadingDiagnostics()}
          >
            {readingDiagLoading ? "Analyse…" : "Lancer l’analyse MAL / AniList"}
          </button>
          {diagnosticsCachedAt ? (
            <span className="reading-lists-compare-cached-hint">
              Dernière analyse : {new Date(diagnosticsCachedAt).toLocaleString("fr-FR")}
            </span>
          ) : null}
          {counts ? (
            <div className="reading-lists-compare-stats" aria-label="Synthèse Nexus">
              <span>
                Fiches Nexus : <strong>{counts.total}</strong>
              </span>
              <span>
                Sans MAL id : <strong>{counts.noMalId}</strong>
              </span>
              <span>
                Comparables : <strong>{counts.comparable}</strong>
              </span>
              <span>
                Désync MAL/AniList : <strong>{counts.desync}</strong>
              </span>
            </div>
          ) : null}
        </div>

        <div className="reading-lists-compare-filter-row">
          <label htmlFor="reading-lists-filter" className="reading-lists-compare-filter-label">
            Afficher
          </label>
          <select
            id="reading-lists-filter"
            className="family-settings-input reading-lists-compare-filter-select"
            value={rowFilter}
            onChange={(ev) => setRowFilter(ev.target.value as ReadingListCompareFilter)}
          >
            {FILTER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <span className="reading-lists-compare-filter-hint">
            {filteredEntries.length} ligne(s) · filtre par rapport aux colonnes MAL / AniList
          </span>
        </div>

        {fetchError ? <p className="settings-error">{fetchError}</p> : null}

        {readingDiagData ? (
          <div className="integrations-reading-diagnostics">
            {(readingDiagData.external.errors.mal || readingDiagData.external.errors.anilist) && (
              <p className="integrations-diagnostics-api-errors">
                {readingDiagData.external.errors.mal ? (
                  <span>MAL : {readingDiagData.external.errors.mal} </span>
                ) : null}
                {readingDiagData.external.errors.anilist ? (
                  <span>AniList : {readingDiagData.external.errors.anilist}</span>
                ) : null}
              </p>
            )}
            <p className="integrations-diagnostics-summary">
              MAL : {readingDiagData.external.mal_manga_ids.length} entrée(s) dans la liste · AniList (liées MAL) :{" "}
              {Object.keys(readingDiagData.external.anilist_by_mal_id).length} · AniList sans{" "}
              <code>idMal</code> : {readingDiagData.external.anilist_entries_without_mal.length}
            </p>
            {readingDiagData.external.anilist_entries_without_mal.length > 0 ? (
              <details className="integrations-diagnostics-orphans">
                <summary>
                  Entrées AniList sans lien MAL ({readingDiagData.external.anilist_entries_without_mal.length})
                </summary>
                <ul>
                  {readingDiagData.external.anilist_entries_without_mal.slice(0, 80).map((o) => {
                    const aniUrl = getAnilistMangaCatalogUrl(o.anilist_media_id);
                    return (
                      <li key={o.anilist_media_id} className="reading-lists-compare-orphan-li">
                        #{o.anilist_media_id} — {o.title}
                        {aniUrl ? (
                          <>
                            {" "}
                            <ReadingCatalogLink
                              href={aniUrl}
                              tooltip={`Fiche AniList : ${o.title}`}
                              ariaLabel={`Ouvrir ${o.title} sur AniList`}
                            />
                          </>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </details>
            ) : null}
            <div className="integrations-diagnostics-table-wrap reading-lists-diagnostics-table-wrap">
              <table className="integrations-diagnostics-table reading-lists-diagnostics-table">
                <colgroup>
                  <col className="reading-lists-col-title" />
                  <col className="reading-lists-col-malid" />
                  <col className="reading-lists-col-mal" />
                  <col className="reading-lists-col-anilist" />
                  <col className="reading-lists-col-nexus" />
                  <col className="reading-lists-col-sync" />
                  <col className="reading-lists-col-actions" />
                </colgroup>
                <thead>
                  <tr>
                    <th scope="col">Titre</th>
                    <th scope="col" className="reading-lists-diagnostics-th-num">
                      MAL id
                    </th>
                    <th scope="col" className="reading-lists-diagnostics-th-center">
                      MAL
                    </th>
                    <th scope="col" className="reading-lists-diagnostics-th-center">
                      AniList
                    </th>
                    <th scope="col" className="reading-lists-diagnostics-th-center">
                      Nexus seul
                    </th>
                    <th scope="col" className="reading-lists-diagnostics-th-center">
                      Sync
                    </th>
                    <th scope="col" className="reading-lists-diagnostics-th-actions">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEntries.map((row) => (
                    <ReadingListCompareRow
                      key={row.rowId}
                      row={row}
                      integrationByProvider={integrationByProvider}
                      readingListDeleteBusyKey={readingListDeleteBusyKey}
                      onRemove={handleRemoveFromExternalList}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function ReadingListCompareRow({
  row,
  integrationByProvider,
  readingListDeleteBusyKey,
  onRemove,
}: {
  row: ReadingEntryDiagnostic;
  integrationByProvider: Record<
    IntegrationProvider,
    { status: IntegrationConnectionStatus; error: string | null }
  >;
  readingListDeleteBusyKey: string | null;
  onRemove: (
    provider: IntegrationProvider,
    row: { rowId: string; title: string; mal_manga_id: number }
  ) => void;
}) {
  const malUrl = getMalMangaCatalogUrl(row.mal_manga_id);
  const aniUrl = getAnilistMangaCatalogUrl(row.anilistMediaId);
  const malLinked = row.mal_manga_id > 0;
  const malOnList = malLinked && row.inMalList;
  const aniOnList = row.inAnilistList;

  return (
    <tr>
      <td className="reading-lists-diagnostics-title-cell">
        <span className="reading-lists-diagnostics-title-text" title={row.title}>
          {row.title}
        </span>
      </td>
      <td className="reading-lists-diagnostics-malid-cell">{row.mal_manga_id > 0 ? row.mal_manga_id : "—"}</td>
      <td className="reading-lists-diagnostics-center-cell">
        <div className="reading-lists-diagnostics-link-cell">
          <span
            className={`reading-lists-diagnostics-badge${malOnList ? " is-on" : " is-off"}`}
            title={malOnList ? "Présent sur la mangalist MAL" : malLinked ? "Absent de la mangalist MAL" : "Pas de lien MAL"}
          >
            {malOnList ? "✓" : "—"}
          </span>
          {malUrl ? (
            <ReadingCatalogLink
              href={malUrl}
              tooltip={`Fiche MAL : ${row.title}`}
              ariaLabel={`Ouvrir ${row.title} sur MyAnimeList`}
            />
          ) : null}
        </div>
      </td>
      <td className="reading-lists-diagnostics-center-cell">
        <div className="reading-lists-diagnostics-anilist-cell">
          <span
            className={`reading-lists-diagnostics-badge${aniOnList ? " is-on" : " is-off"}`}
            title={aniOnList ? "Sur la liste AniList (idMal)" : "Pas sur AniList via ce lien"}
          >
            {aniOnList ? "✓" : "—"}
          </span>
          {row.anilistMediaId ? (
            <span className="reading-lists-diagnostics-anilist-id">#{row.anilistMediaId}</span>
          ) : null}
          {aniUrl ? (
            <ReadingCatalogLink
              href={aniUrl}
              tooltip={`Fiche AniList : ${row.title}`}
              ariaLabel={`Ouvrir ${row.title} sur AniList`}
            />
          ) : null}
        </div>
      </td>
      <td className="reading-lists-diagnostics-center-cell">
        <span className={`reading-lists-diagnostics-badge${row.nexusOnlyInExternalLists ? " is-warn" : " is-off"}`}>
          {row.nexusOnlyInExternalLists ? "Oui" : "—"}
        </span>
      </td>
      <td className="reading-lists-diagnostics-sync-cell">
        <span className="reading-lists-diagnostics-sync">{row.snapshotSource ?? "—"}</span>
      </td>
      <td className="reading-lists-diagnostics-actions-cell">
        <div className="reading-lists-diagnostics-actions">
          <button
            type="button"
            className="family-settings-btn-secondary integrations-diagnostics-external-btn"
            disabled={
              readingListDeleteBusyKey !== null ||
              !integrationByProvider.mal.status.connected ||
              !row.inMalList ||
              row.mal_manga_id <= 0
            }
            title={
              !integrationByProvider.mal.status.connected
                ? "Connecte MyAnimeList (onglet Intégrations)."
                : !row.inMalList
                  ? "Pas dans la mangalist MAL."
                  : "Retirer de MAL"
            }
            onClick={() =>
              void onRemove("mal", {
                rowId: row.rowId,
                title: row.title,
                mal_manga_id: row.mal_manga_id,
              })
            }
          >
            {readingListDeleteBusyKey === `mal:${row.rowId}` ? "…" : "Retirer MAL"}
          </button>
          <button
            type="button"
            className="family-settings-btn-secondary integrations-diagnostics-external-btn"
            disabled={
              readingListDeleteBusyKey !== null ||
              !integrationByProvider.anilist.status.connected ||
              !row.inAnilistList ||
              row.mal_manga_id <= 0
            }
            title={
              !integrationByProvider.anilist.status.connected
                ? "Connecte AniList (onglet Intégrations)."
                : !row.inAnilistList
                  ? "Pas sur AniList (idMal)."
                  : "Retirer d’AniList"
            }
            onClick={() =>
              void onRemove("anilist", {
                rowId: row.rowId,
                title: row.title,
                mal_manga_id: row.mal_manga_id,
              })
            }
          >
            {readingListDeleteBusyKey === `anilist:${row.rowId}` ? "…" : "Retirer AniList"}
          </button>
        </div>
      </td>
    </tr>
  );
}
