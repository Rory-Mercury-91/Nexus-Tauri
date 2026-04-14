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
import { deleteReadingEntry } from "@/services/library/readingCollectionService";
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
    <button
      type="button"
      className="reading-lists-compare-catalog-link"
      title={tooltip}
      aria-label={ariaLabel}
      onClick={() => {
        void (async () => {
          const opened = await openExternalUrl(href);
          if (!opened) window.open(href, "_blank", "noopener,noreferrer");
        })();
      }}
    >
      <ExternalLinkIcon size={14} strokeWidth={2} aria-hidden />
    </button>
  );
}

const FILTER_OPTIONS: Array<{ value: ReadingListCompareFilter; label: string; group?: string }> = [
  { value: "all",                  label: "Toutes les fiches" },
  // — Présence listes distantes —
  { value: "comparable_only",      label: "Avec MAL id (comparables)",       group: "Listes distantes" },
  { value: "both_remotes",         label: "✓ MAL + AniList",                 group: "Listes distantes" },
  { value: "mal_only_remote",      label: "Seulement mangalist MAL",         group: "Listes distantes" },
  { value: "anilist_only_remote",  label: "Seulement liste AniList",         group: "Listes distantes" },
  { value: "mal_anilist_desync",   label: "Désync (un seul des deux)",       group: "Listes distantes" },
  { value: "nexus_absent_both",    label: "Nexus seul — absent MAL + AniList", group: "Listes distantes" },
  // — Présence sources locales —
  { value: "nexus_no_mal_id",      label: "Sans MAL id (AniList orphelin)",  group: "Sources" },
  { value: "has_mihon",            label: "Source Mihon",                    group: "Sources" },
  { value: "has_nautiljon",        label: "Source Nautiljon",                group: "Sources" },
  { value: "mihon_only_source",    label: "Mihon seulement (hors MAL/AL)",   group: "Sources" },
  { value: "nautiljon_only_source",label: "Nautiljon seulement (hors MAL/AL)", group: "Sources" },
  { value: "no_source",            label: "Aucune source externe connue",    group: "Sources" },
  // — Qualité des données —
  { value: "duplicate_malid",      label: "⚠ Doublons MAL id (Nexus)",      group: "Qualité" },
];

/** Badge compact : présence dans une source */
function PresenceBadge({ on, label }: { on: boolean; label?: string }) {
  return (
    <span
      className={`reading-lists-diagnostics-badge${on ? " is-on" : " is-off"}`}
      title={on ? (label ? `Présent : ${label}` : "Présent") : "Absent / non lié"}
    >
      {on ? "✓" : "—"}
    </span>
  );
}

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
  const [nexusDeleteBusyKey, setNexusDeleteBusyKey] = useState<string | null>(null);
  const [rowFilter, setRowFilter] = useState<ReadingListCompareFilter>("all");

  const handleRemoveFromExternalList = useCallback(
    async (
      provider: IntegrationProvider,
      row: { rowId: string; title: string; mal_manga_id: number }
    ) => {
      const label = provider === "mal" ? "MyAnimeList" : "AniList";
      if (!window.confirm(`Retirer « ${row.title} » de ta liste ${label} ?`)) return;
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

  const handleDeleteFromNexus = useCallback(
    async (row: ReadingEntryDiagnostic) => {
      const hasExternalSources = row.inMalList || row.inAnilistList;
      const warning = hasExternalSources
        ? `⚠ « ${row.title} » est encore présent(e) sur MAL ou AniList.\n\nSupprime-la d'abord des listes distantes, puis relance l'analyse.\n\nConfirmer quand même la suppression de Nexus ?`
        : `Supprimer définitivement « ${row.title} » de Nexus ?\n\nCette action est irréversible.`;
      if (!window.confirm(warning)) return;
      setActionError(null);
      setNexusDeleteBusyKey(row.rowId);
      try {
        const supabase = getSupabaseClient();
        await deleteReadingEntry(supabase, row.rowId);
        setGlobalInfo(`« ${row.title} » supprimé de Nexus.`);
        await runReadingDiagnostics({ withPageOverlay: false });
      } catch (e) {
        setActionError(e instanceof Error ? e.message : "Erreur suppression Nexus.");
      } finally {
        setNexusDeleteBusyKey(null);
      }
    },
    [runReadingDiagnostics]
  );

  const filteredEntries = useMemo(() => {
    if (!readingDiagData) return [];
    return filterReadingEntryDiagnostics(readingDiagData.entries, rowFilter);
  }, [readingDiagData, rowFilter]);

  const counts = useMemo(() => {
    if (!readingDiagData) return null;
    const e = readingDiagData.entries;
    return {
      total:        e.length,
      noMalId:      e.filter((r) => r.mal_manga_id <= 0).length,
      comparable:   e.filter((r) => r.mal_manga_id > 0).length,
      desync:       e.filter((r) => r.mal_manga_id > 0 && r.inMalList !== r.inAnilistList).length,
      withMihon:    e.filter((r) => r.hasMihon).length,
      withNautiljon:e.filter((r) => r.hasNautiljon).length,
      duplicates:   e.filter((r) => r.isDuplicateMalId).length,
      noSource:     e.filter((r) => !r.inMalList && !r.inAnilistList && !r.hasMihon && !r.hasNautiljon).length,
    };
  }, [readingDiagData]);

  const fetchError = readingDiagError ?? actionError;

  return (
    <div className="reading-lists-compare">
      {globalInfo ? <p className="settings-success">{globalInfo}</p> : null}

      {/* ─── Connexions OAuth ─── */}
      <section className="settings-block reading-lists-compare-block" aria-labelledby="reading-lists-oauth-ro">
        <h2 id="reading-lists-oauth-ro" className="settings-block-title">
          Connexions MAL & AniList
        </h2>
        <p className="settings-block-lead">
          Les comparaisons utilisent tes jetons OAuth. Connecte ou déconnecte les comptes depuis l'onglet{" "}
          <strong>Intégrations</strong> — cet écran affiche seulement l'état courant.
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

      {/* ─── Analyse ─── */}
      <section className="settings-block reading-lists-compare-block" aria-labelledby="reading-lists-analysis">
        <h2 id="reading-lists-analysis" className="settings-block-title">
          Analyse Nexus ↔ listes distantes
        </h2>
        <p className="settings-block-lead">
          Croise <strong>library_reading</strong> avec ta mangalist <strong>MAL</strong>, ta liste{" "}
          <strong>AniList</strong>, et détecte les fiches ayant des données <strong>Mihon</strong> ou{" "}
          <strong>Nautiljon</strong>. Utile pour nettoyer les doublons et vérifier la couverture sources.
        </p>
        <p className="reading-lists-compare-catalog-hint settings-block-lead">
          Icône{" "}
          <ExternalLinkIcon size={14} className="reading-lists-compare-catalog-hint-icon" aria-hidden /> : ouvre la fiche
          publique sur le site.
        </p>

        {/* Toolbar */}
        <div className="reading-lists-compare-toolbar">
          <button
            type="button"
            className="integrations-connect-btn"
            disabled={readingDiagLoading}
            onClick={() => void runReadingDiagnostics()}
          >
            {readingDiagLoading ? "Analyse…" : "Lancer l'analyse MAL / AniList"}
          </button>
          {diagnosticsCachedAt ? (
            <span className="reading-lists-compare-cached-hint">
              Dernière analyse : {new Date(diagnosticsCachedAt).toLocaleString("fr-FR")}
            </span>
          ) : null}

          {/* Stats */}
          {counts ? (
            <div className="reading-lists-compare-stats" aria-label="Synthèse Nexus">
              <span>Fiches Nexus : <strong>{counts.total}</strong></span>
              <span>Sans MAL id : <strong>{counts.noMalId}</strong></span>
              <span>Désync MAL/AniList : <strong>{counts.desync}</strong></span>
              <span>Mihon : <strong>{counts.withMihon}</strong></span>
              <span>Nautiljon : <strong>{counts.withNautiljon}</strong></span>
              {counts.duplicates > 0 ? (
                <span className="reading-lists-compare-stat-warn">
                  ⚠ Doublons MAL id : <strong>{counts.duplicates}</strong>
                </span>
              ) : null}
              {counts.noSource > 0 ? (
                <span className="reading-lists-compare-stat-warn">
                  Sans source : <strong>{counts.noSource}</strong>
                </span>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* Filtre */}
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
            {(() => {
              const groups: string[] = [];
              const seen = new Set<string>();
              for (const opt of FILTER_OPTIONS) {
                const g = opt.group ?? "";
                if (g && !seen.has(g)) { groups.push(g); seen.add(g); }
              }
              const ungrouped = FILTER_OPTIONS.filter((o) => !o.group);
              return (
                <>
                  {ungrouped.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                  {groups.map((g) => (
                    <optgroup key={g} label={`— ${g} —`}>
                      {FILTER_OPTIONS.filter((o) => o.group === g).map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </optgroup>
                  ))}
                </>
              );
            })()}
          </select>
          <span className="reading-lists-compare-filter-hint">
            {filteredEntries.length} ligne(s)
          </span>
        </div>

        {fetchError ? <p className="settings-error">{fetchError}</p> : null}

        {readingDiagData ? (
          <div className="integrations-reading-diagnostics">
            {/* Erreurs API */}
            {(readingDiagData.external.errors.mal || readingDiagData.external.errors.anilist) && (
              <p className="integrations-diagnostics-api-errors">
                {readingDiagData.external.errors.mal ? <span>MAL : {readingDiagData.external.errors.mal} </span> : null}
                {readingDiagData.external.errors.anilist ? <span>AniList : {readingDiagData.external.errors.anilist}</span> : null}
              </p>
            )}

            {/* Résumé API */}
            <p className="integrations-diagnostics-summary">
              MAL : {readingDiagData.external.mal_manga_ids.length} entrée(s) ·{" "}
              AniList (liées MAL) : {Object.keys(readingDiagData.external.anilist_by_mal_id).length} ·{" "}
              AniList sans <code>idMal</code> : {readingDiagData.external.anilist_entries_without_mal.length}
            </p>

            {/* AniList orphelins */}
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

            {/* Tableau */}
            <div className="integrations-diagnostics-table-wrap reading-lists-diagnostics-table-wrap">
              <table className="integrations-diagnostics-table reading-lists-diagnostics-table">
                <colgroup>
                  <col className="reading-lists-col-title" />
                  <col className="reading-lists-col-malid" />
                  <col className="reading-lists-col-badge" />
                  <col className="reading-lists-col-badge" />
                  <col className="reading-lists-col-badge" />
                  <col className="reading-lists-col-badge" />
                  <col className="reading-lists-col-sync" />
                  <col className="reading-lists-col-actions" />
                </colgroup>
                <thead>
                  <tr>
                    <th scope="col">Titre</th>
                    <th scope="col" className="reading-lists-diagnostics-th-num">MAL id</th>
                    <th scope="col" className="reading-lists-diagnostics-th-center" title="Présent dans ta mangalist MyAnimeList">MAL</th>
                    <th scope="col" className="reading-lists-diagnostics-th-center" title="Présent dans ta liste AniList (via idMal)">AniList</th>
                    <th scope="col" className="reading-lists-diagnostics-th-center" title="Données issues de Mihon/Tachiyomi">Mihon</th>
                    <th scope="col" className="reading-lists-diagnostics-th-center" title="Import Nautiljon associé">Nautiljon</th>
                    <th scope="col" className="reading-lists-diagnostics-th-center">Sync</th>
                    <th scope="col" className="reading-lists-diagnostics-th-actions">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEntries.map((row) => (
                    <ReadingListCompareRow
                      key={row.rowId}
                      row={row}
                      integrationByProvider={integrationByProvider}
                      readingListDeleteBusyKey={readingListDeleteBusyKey}
                      nexusDeleteBusyKey={nexusDeleteBusyKey}
                      onRemove={handleRemoveFromExternalList}
                      onDeleteFromNexus={handleDeleteFromNexus}
                    />
                  ))}
                  {filteredEntries.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="reading-lists-diagnostics-empty">
                        Aucune fiche ne correspond à ce filtre.
                      </td>
                    </tr>
                  ) : null}
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
  nexusDeleteBusyKey,
  onRemove,
  onDeleteFromNexus,
}: {
  row: ReadingEntryDiagnostic;
  integrationByProvider: Record<
    IntegrationProvider,
    { status: IntegrationConnectionStatus; error: string | null }
  >;
  readingListDeleteBusyKey: string | null;
  nexusDeleteBusyKey: string | null;
  onRemove: (
    provider: IntegrationProvider,
    row: { rowId: string; title: string; mal_manga_id: number }
  ) => void;
  onDeleteFromNexus: (row: ReadingEntryDiagnostic) => void;
}) {
  const malUrl = getMalMangaCatalogUrl(row.mal_manga_id);
  const aniUrl = getAnilistMangaCatalogUrl(row.anilistMediaId);
  const malLinked = row.mal_manga_id > 0;

  return (
    <tr className={row.isDuplicateMalId ? "reading-lists-diagnostics-row-warn" : undefined}>
      <td className="reading-lists-diagnostics-title-cell">
        <span className="reading-lists-diagnostics-title-text" title={row.title}>
          {row.title}
        </span>
        {row.isDuplicateMalId ? (
          <span className="reading-lists-diagnostics-dup-badge" title="Doublon : même MAL id dans Nexus">
            ⚠ doublon
          </span>
        ) : null}
      </td>
      <td className="reading-lists-diagnostics-malid-cell">
        <div className="reading-lists-diagnostics-link-cell">
          {row.mal_manga_id > 0 ? row.mal_manga_id : "—"}
          {malUrl ? (
            <ReadingCatalogLink
              href={malUrl}
              tooltip={`Fiche MAL : ${row.title}`}
              ariaLabel={`Ouvrir ${row.title} sur MyAnimeList`}
            />
          ) : null}
        </div>
      </td>
      {/* MAL */}
      <td className="reading-lists-diagnostics-center-cell">
        <PresenceBadge
          on={malLinked && row.inMalList}
          label={malLinked ? "mangalist MAL" : "sans lien MAL"}
        />
      </td>
      {/* AniList */}
      <td className="reading-lists-diagnostics-center-cell">
        <div className="reading-lists-diagnostics-anilist-cell">
          <PresenceBadge on={row.inAnilistList} label="liste AniList (idMal)" />
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
      {/* Mihon */}
      <td className="reading-lists-diagnostics-center-cell">
        <PresenceBadge on={row.hasMihon} label="Mihon/Tachiyomi" />
      </td>
      {/* Nautiljon */}
      <td className="reading-lists-diagnostics-center-cell">
        <PresenceBadge on={row.hasNautiljon} label="import Nautiljon" />
      </td>
      {/* Sync source */}
      <td className="reading-lists-diagnostics-sync-cell">
        <span className="reading-lists-diagnostics-sync">{row.snapshotSource ?? "—"}</span>
      </td>
      {/* Actions */}
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
              void onRemove("mal", { rowId: row.rowId, title: row.title, mal_manga_id: row.mal_manga_id })
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
                  : "Retirer d'AniList"
            }
            onClick={() =>
              void onRemove("anilist", { rowId: row.rowId, title: row.title, mal_manga_id: row.mal_manga_id })
            }
          >
            {readingListDeleteBusyKey === `anilist:${row.rowId}` ? "…" : "Retirer AniList"}
          </button>
          <button
            type="button"
            className={`family-settings-btn-secondary integrations-diagnostics-external-btn integrations-diagnostics-nexus-delete-btn${row.nexusOnlyInExternalLists || (!row.inMalList && !row.inAnilistList) ? " is-nexus-only" : ""}`}
            disabled={nexusDeleteBusyKey !== null}
            title={
              row.inMalList || row.inAnilistList
                ? "Entrée encore sur MAL ou AniList — retire-la d'abord des listes distantes"
                : "Supprimer définitivement de Nexus"
            }
            onClick={() => onDeleteFromNexus(row)}
          >
            {nexusDeleteBusyKey === row.rowId ? "…" : "Supprimer Nexus"}
          </button>
        </div>
      </td>
    </tr>
  );
}
