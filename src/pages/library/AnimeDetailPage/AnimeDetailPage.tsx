import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { useAnimeDetailFromDb, type FranchiseDetailEntry } from "@/hooks/useAnimeDetailFromDb";
import { getSupabaseClient } from "@/lib/supabaseClient";
import { buildAnimeDetailResolvedFields } from "@/services/library/animeDetailViewModel";
import { updateAnimeWatchStatus } from "@/services/library/animeCollectionService";
import { readingEntryDetailPath } from "@/services/library/readingCollectionService";
import { deleteAnimeEntry } from "@/services/library/animeCollectionService";
import { removeFromExternalList } from "@/services/library/externalReadingListDeleteService";
import { fetchIntegrationStatus } from "@/services/integrations/integrationService";
import { DeleteLibraryEntryConfirmModal } from "@/features/library/DeleteLibraryEntryConfirmModal/DeleteLibraryEntryConfirmModal";
import { isMalSyntheticId } from "@/lib/malSyntheticIds";
import { translateLibraryTerm } from "@/services/library/termTranslations";
import { type SyncSource } from "@/services/library/syncService";
import { buildAnimeSyncDiffFields } from "@/services/library/syncDiffService";
import { fetchAnimeFull } from "@/services/jikan/animeJikanService";
import type { JikanAnimeFull } from "@/services/jikan/jikanTypes";
import { useSyncProgress } from "@/contexts/SyncProgressContext";
import { notifyToast } from "@/lib/toastEvents";
import { downloadImageToDownloads } from "@/lib/imageDownload";
import { downloadJsonFile, isDebugModeEnabled } from "@/lib/debugTools";
import { LibraryMediaGallery } from "@/components/library/LibraryMediaGallery";
import { LibraryMediaPreviewModal } from "@/components/library/LibraryMediaPreviewModal";
import { LibraryFranchiseSection } from "@/components/library/LibraryFranchiseSection";
import { LibraryPersonalProgressSection } from "@/components/library/LibraryPersonalProgressSection";
import { LibraryReferenceLinksSection } from "@/components/library/LibraryReferenceLinksSection";
import { LibrarySynopsisSection } from "@/components/library/LibrarySynopsisSection";
import { LibraryBadgeGroup } from "@/components/library/LibraryBadgeGroup";
import { LibraryMainMetaHeader } from "@/components/library/LibraryMainMetaHeader";
import { LibraryGeneralInfoGrid } from "@/components/library/LibraryGeneralInfoGrid";
import { LibrarySyncDiffModal } from "@/components/modals/LibrarySyncDiffModal/LibrarySyncDiffModal";
import { LibraryEditEntryModal, type LibraryEditField } from "@/components/modals/LibraryEditEntryModal/LibraryEditEntryModal";
import { LibraryDetailStickyHeader } from "@/pages/library/LibraryDetailStickyHeader";
import { scrollMainToTop } from "@/lib/collectionScroll";
import "../LibraryPages.css";
import "./AnimeDetailPage.css";

function pickPosterUrl(anime: JikanAnimeFull): string | null {
  return (
    anime.images.webp.large_image_url ||
    anime.images.jpg.large_image_url ||
    anime.images.jpg.image_url
  );
}

function normalizeKey(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function chipToneByValue(value: string): string {
  const key = normalizeKey(value);
  if (
    key.includes("termine") ||
    key.includes("finished") ||
    key.includes("complete")
  ) {
    return "success";
  }
  if (
    key.includes("cours") ||
    key.includes("watching") ||
    key.includes("airing")
  ) {
    return "info";
  }
  if (key.includes("venir") || key.includes("upcoming")) {
    return "warning";
  }
  if (key.includes("drop") || key.includes("abandon")) {
    return "danger";
  }
  if (key === "tv" || key.includes("film") || key.includes("movie")) {
    return "violet";
  }
  if (
    key.includes("shonen") ||
    key.includes("seinen") ||
    key.includes("shojo") ||
    key.includes("josei")
  ) {
    return "pink";
  }
  if (
    key.includes("action") ||
    key.includes("fantasy") ||
    key.includes("isekai") ||
    key.includes("reincarnation")
  ) {
    return "teal";
  }
  if (key.includes("pg") || key.includes("r-") || key.includes("tout-public")) {
    return "amber";
  }
  return "neutral";
}

function getWatchedEpisodesFromMalSnapshot(malSnapshot: Record<string, unknown> | null): number {
  if (!malSnapshot) {
    return 0;
  }
  const listEntry = (malSnapshot.list_entry as Record<string, unknown> | undefined) ?? {};
  const listStatus = (listEntry.list_status as Record<string, unknown> | undefined) ?? {};
  const myListStatus = (malSnapshot.my_list_status as Record<string, unknown> | undefined) ?? {};
  const raw =
    listStatus.num_episodes_watched ??
    myListStatus.num_episodes_watched ??
    malSnapshot.num_episodes_watched ??
    0;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.floor(value);
}

function mapWatchStatusToFr(raw: string | null): string {
  const key = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_")
    .replace(/\s+/g, "_");
  switch (key) {
    case "watching":
      return "En cours";
    case "completed":
      return "Terminé";
    case "on_hold":
    case "onhold":
      return "En pause";
    case "dropped":
      return "Abandonné";
    case "plan_to_watch":
    default:
      return "Planifié";
  }
}

function mapWatchStatusToDb(raw: string): string {
  switch (raw) {
    case "En cours":
      return "watching";
    case "Terminé":
      return "completed";
    case "En pause":
      return "on_hold";
    case "Abandonné":
      return "dropped";
    default:
      return "plan_to_watch";
  }
}

function getLockedFieldIdsFromSnapshot(snapshot: Record<string, unknown> | null): string[] {
  const manualOverrides = ((snapshot?.manual_overrides as Record<string, unknown> | undefined) ?? {});
  const raw = manualOverrides.locked_field_ids;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function getManualOverrides(snapshot: Record<string, unknown> | null): Record<string, unknown> {
  return ((snapshot?.manual_overrides as Record<string, unknown> | undefined) ?? {});
}

export function AnimeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const detailState = (location.state as {
    fromCollection?: "anime";
    collectionScrollY?: number;
    collectionViewMode?: "grid" | "list";
  } | null) ?? null;
  const backState =
    detailState?.fromCollection === "anime" &&
    Number.isFinite(detailState.collectionScrollY ?? NaN)
      ? {
          fromDetailCollection: "anime" as const,
          restoreScrollY: Number(detailState.collectionScrollY),
          collectionViewMode: detailState.collectionViewMode,
        }
      : undefined;
  const malId = useMemo(() => {
    const n = Number(id);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [id]);

  useLayoutEffect(() => {
    scrollMainToTop();
    const rafId = requestAnimationFrame(() => {
      scrollMainToTop();
    });
    const t = window.setTimeout(scrollMainToTop, 150);
    return () => {
      cancelAnimationFrame(rafId);
      window.clearTimeout(t);
    };
  }, [id]);

  const state = useAnimeDetailFromDb(malId);

  return (
    <div className="library-page anime-detail-page">
      {malId === null ? (
        <p className="library-page-lead">Identifiant d’URL invalide (attendu : MAL id numérique).</p>
      ) : null}

      {state.status === "loading" ? (
        <div className="anime-detail-loading" role="status">
          Chargement des données depuis la base…
        </div>
      ) : null}

      {state.status === "error" ? (
        <p className="library-page-lead" role="alert">
          {state.message}
        </p>
      ) : null}

      {state.status === "ready" ? (
        <AnimeDetailBody
          backState={backState}
          onDeleted={() => navigate("/anime", { state: backState })}
          onNavigateToMalId={(nextMalId) => navigate(`/anime/${nextMalId}`)}
          rowId={state.rowId}
          report={state.report}
          anime={state.report.full}
          malSnapshot={state.malSnapshot}
          watchStatus={state.watchStatus}
          isFavorite={state.isFavorite}
          franchiseEntries={state.franchiseEntries}
        />
      ) : null}
    </div>
  );
}

function AnimeDetailBody({
  backState,
  onDeleted,
  onNavigateToMalId,
  rowId,
  report,
  anime,
  malSnapshot,
  watchStatus,
  isFavorite,
  franchiseEntries,
}: {
  backState?:
    | {
        fromDetailCollection: "anime";
        restoreScrollY: number;
        collectionViewMode?: "grid" | "list";
      }
    | undefined;
  rowId: string;
  onDeleted: () => void;
  onNavigateToMalId: (nextMalId: number) => void;
  report: {
    full: JikanAnimeFull;
    pictures: { ok: boolean; data?: { data: Array<{ jpg: { image_url?: string; large_image_url?: string } }> } };
    episodes: { ok: boolean; data?: { data: Array<{ mal_id: number; title: string; filler?: boolean; recap?: boolean }> } };
  };
  anime: JikanAnimeFull;
  malSnapshot: Record<string, unknown> | null;
  watchStatus: string | null;
  isFavorite: boolean;
  franchiseEntries: FranchiseDetailEntry[];
}) {
  type PersonalStatus = "Planifié" | "En cours" | "En pause" | "Terminé" | "Abandonné";
  const resolved = buildAnimeDetailResolvedFields(anime, null);
  const poster = resolved.posterUrl ?? pickPosterUrl(anime);
  const manualOverrides = getManualOverrides(malSnapshot);
  const manualLinks = ((manualOverrides.links as Record<string, unknown> | undefined) ?? {});
  const manualTitleFr = String(manualOverrides.title_fr ?? "").trim();
  const manualSynopsisFr = String(manualOverrides.synopsis_fr ?? "").trim();
  const manualLinkNautiljon = String(manualLinks.nautiljon ?? "").trim();
  const manualLinkAnilist = String(manualLinks.anilist ?? "").trim();
  const manualStreamCrunchyroll = String(manualLinks.crunchyroll ?? "").trim();
  const manualStreamPrime = String(manualLinks.prime_video ?? "").trim();
  const manualStreamDisney = String(manualLinks.disney_plus ?? "").trim();
  const manualStreamAdn = String(manualLinks.adn ?? "").trim();
  const manualStreamAnimeSama = String(manualLinks.anime_sama ?? "").trim();
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [translatingSynopsis, setTranslatingSynopsis] = useState(false);
  const [seenEpisodeIds, setSeenEpisodeIds] = useState<number[]>([]);
  const [previewImages, setPreviewImages] = useState<string[]>([]);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);
  const [selectedDiffFieldIds, setSelectedDiffFieldIds] = useState<string[]>([]);
  const [syncLaunching, setSyncLaunching] = useState(false);
  const [syncPreparing, setSyncPreparing] = useState(false);
  const [liveSyncFull, setLiveSyncFull] = useState<Record<string, unknown> | null>(null);
  const { startSync: startAnimeSync } = useSyncProgress();
  const syncDiffFields = useMemo(
    () => buildAnimeSyncDiffFields({ malSnapshot, liveFull: liveSyncFull ?? (report.full as unknown as Record<string, unknown>) }),
    [malSnapshot, liveSyncFull, report.full]
  );
  const galleryImageSources = useMemo(() => {
    if (!report.pictures.ok) {
      return [];
    }
    return (report.pictures.data?.data ?? [])
      .map((pic) => pic.jpg.large_image_url || pic.jpg.image_url || "")
      .filter((src) => src.length > 0);
  }, [report.pictures]);

  function openPreview(images: string[], index: number) {
    if (images.length === 0) {
      return;
    }
    const safeIndex = Math.min(Math.max(0, index), images.length - 1);
    setPreviewImages(images);
    setPreviewIndex(safeIndex);
  }

  async function openSyncDiffModal() {
    const animeMalId = Number(anime.mal_id);
    if (Number.isFinite(animeMalId) && animeMalId > 0) {
      setSyncPreparing(true);
      try {
        const live = await fetchAnimeFull(animeMalId);
        if (live.ok) {
          setLiveSyncFull((live.data?.data ?? null) as Record<string, unknown> | null);
        }
      } finally {
        setSyncPreparing(false);
      }
    }
    const locked = new Set(getLockedFieldIdsFromSnapshot(malSnapshot));
    const defaultSelected = syncDiffFields
      .map((field) => field.id)
      .filter((id) => !locked.has(id));
    setSelectedDiffFieldIds(defaultSelected);
    setIsSyncModalOpen(true);
  }

  function toggleDiffField(fieldId: string, checked: boolean) {
    setSelectedDiffFieldIds((prev) => {
      if (checked) {
        return prev.includes(fieldId) ? prev : [...prev, fieldId];
      }
      return prev.filter((id) => id !== fieldId);
    });
  }

  async function launchAnimeSync(source: SyncSource) {
    setSyncLaunching(true);
    try {
      const allFieldIds = syncDiffFields.map((field) => field.id);
      const selectedIds = selectedDiffFieldIds;
      const lockedIds = allFieldIds.filter((id) => !selectedIds.includes(id));
      const supabase = getSupabaseClient();
      const nextMalSnapshot = {
        ...(malSnapshot ?? {}),
        manual_overrides: {
          ...((malSnapshot?.manual_overrides as Record<string, unknown> | undefined) ?? {}),
          locked_field_ids: lockedIds,
        },
      };
      await supabase
        .from("library_anime")
        .update({
          mal_official_snapshot: nextMalSnapshot,
          updated_at: new Date().toISOString(),
        })
        .eq("id", rowId);
      const targetMalId = Number(String(draft.malId ?? "").trim());
      await startAnimeSync(source, {
        selectedFieldIds: selectedDiffFieldIds,
        targetMalId: Number.isFinite(targetMalId) && targetMalId > 0 ? targetMalId : Number(anime.mal_id),
      });
      setIsSyncModalOpen(false);
      window.location.reload();
    } finally {
      setSyncLaunching(false);
    }
  }

  const [draft, setDraft] = useState(() => ({
    malId: String(anime.mal_id ?? ""),
    titleFr: manualTitleFr,
    titleRomanized: resolved.titleEnglish ?? "",
    titleOriginal: resolved.titleJapanese ?? "",
    titleAlternatives: resolved.titleAlternatives.join(" | "),
    mediaType: resolved.mediaType,
    status: resolved.status,
    rating: resolved.rating,
    source: resolved.source,
    seasonLabel: resolved.seasonLabel,
    episodes: resolved.episodes ? String(resolved.episodes) : "",
    duration: resolved.duration,
    synopsisOriginal: resolved.synopsis ?? "",
    synopsisFr: manualSynopsisFr,
    linkMal: anime.url,
    linkNautiljon: manualLinkNautiljon,
    linkAnilist: manualLinkAnilist,
    streamCrunchyroll: manualStreamCrunchyroll,
    streamPrimeVideo: manualStreamPrime,
    streamDisneyPlus: manualStreamDisney,
    streamAdn: manualStreamAdn,
    streamAnimeSama: manualStreamAnimeSama,
    trailerUrl: anime.trailer.embed_url ?? "",
    userStatus: mapWatchStatusToFr(watchStatus),
    isFavorite,
  }));
  const [favoriteSaving, setFavoriteSaving] = useState(false);
  const [statusSaving, setStatusSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [integrationConnected, setIntegrationConnected] = useState({ mal: false, anilist: false });
  const [exportingDebugJson, setExportingDebugJson] = useState(false);
  useEffect(() => {
    setDraft((prev) => ({
      ...prev,
      malId: String(anime.mal_id ?? ""),
      titleRomanized: resolved.titleEnglish ?? "",
      titleOriginal: resolved.titleJapanese ?? "",
      titleAlternatives: resolved.titleAlternatives.join(" | "),
      mediaType: resolved.mediaType,
      status: resolved.status,
      rating: resolved.rating,
      source: resolved.source,
      seasonLabel: resolved.seasonLabel,
      episodes: resolved.episodes ? String(resolved.episodes) : "",
      duration: resolved.duration,
      synopsisOriginal: resolved.synopsis ?? "",
      titleFr: manualTitleFr,
      synopsisFr: manualSynopsisFr,
      linkMal: anime.url,
      linkNautiljon: manualLinkNautiljon,
      linkAnilist: manualLinkAnilist,
      streamCrunchyroll: manualStreamCrunchyroll,
      streamPrimeVideo: manualStreamPrime,
      streamDisneyPlus: manualStreamDisney,
      streamAdn: manualStreamAdn,
      streamAnimeSama: manualStreamAnimeSama,
      trailerUrl: anime.trailer.embed_url ?? "",
      userStatus: mapWatchStatusToFr(watchStatus),
      isFavorite,
    }));
  }, [
    anime.mal_id,
    anime.url,
    anime.trailer.embed_url,
    resolved.duration,
    resolved.episodes,
    resolved.mediaType,
    resolved.rating,
    resolved.seasonLabel,
    resolved.source,
    resolved.status,
    resolved.synopsis,
    resolved.title,
    resolved.titleAlternatives,
    resolved.titleEnglish,
    resolved.titleJapanese,
    manualTitleFr,
    manualSynopsisFr,
    manualLinkNautiljon,
    manualLinkAnilist,
    manualStreamCrunchyroll,
    manualStreamPrime,
    manualStreamDisney,
    manualStreamAdn,
    manualStreamAnimeSama,
    watchStatus,
    isFavorite,
  ]);

  const malIdForRemote = useMemo(() => {
    const parsed = Number(String(draft.malId ?? "").trim());
    const n = Number.isFinite(parsed) && parsed > 0 ? parsed : Number(anime.mal_id);
    if (!Number.isFinite(n) || n <= 0) {
      return null;
    }
    if (isMalSyntheticId(n)) {
      return null;
    }
    return n;
  }, [draft.malId, anime.mal_id]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const supabase = getSupabaseClient();
        const [malStatus, aniStatus] = await Promise.all([
          fetchIntegrationStatus(supabase, "mal"),
          fetchIntegrationStatus(supabase, "anilist"),
        ]);
        if (cancelled) {
          return;
        }
        setIntegrationConnected({
          mal: malStatus.ok && malStatus.status.connected,
          anilist: aniStatus.ok && aniStatus.status.connected,
        });
      } catch {
        if (!cancelled) {
          setIntegrationConnected({ mal: false, anilist: false });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function updateDraft<K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  async function toggleFavorite() {
    if (favoriteSaving) {
      return;
    }
    const previous = draft.isFavorite;
    const next = !previous;
    setDraft((prev) => ({ ...prev, isFavorite: next }));
    setFavoriteSaving(true);
    try {
      const supabase = getSupabaseClient();
      const { error } = await supabase
        .from("library_anime")
        .update({
          is_favorite: next,
          updated_at: new Date().toISOString(),
        })
        .eq("id", rowId);
      if (error) {
        throw new Error(error.message);
      }
    } catch {
      setDraft((prev) => ({ ...prev, isFavorite: previous }));
    } finally {
      setFavoriteSaving(false);
    }
  }

  function toggleEpisodeSeen(id: number) {
    setSeenEpisodeIds((prev) =>
      prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]
    );
  }

  useEffect(() => {
    if (!report.episodes.ok) {
      setSeenEpisodeIds([]);
      return;
    }
    const watchedCount = getWatchedEpisodesFromMalSnapshot(malSnapshot);
    if (watchedCount <= 0) {
      setSeenEpisodeIds([]);
      return;
    }
    const ids = (report.episodes.data?.data ?? [])
      .slice(0, watchedCount)
      .map((ep) => ep.mal_id)
      .filter((id) => Number.isFinite(id));
    setSeenEpisodeIds(ids);
  }, [malSnapshot, report.episodes]);

  const episodesSeen = seenEpisodeIds.length;
  const episodesTotal = resolved.episodes ?? (report.episodes.ok ? report.episodes.data?.data.length ?? 0 : 0);
  const episodeProgress = episodesTotal > 0 ? Math.round((episodesSeen / Math.max(1, episodesTotal)) * 100) : 0;

  async function updateUserStatus(nextStatus: PersonalStatus) {
    const previous = draft.userStatus as PersonalStatus;
    setDraft((prev) => ({ ...prev, userStatus: nextStatus }));
    setStatusSaving(true);
    try {
      const supabase = getSupabaseClient();
      await updateAnimeWatchStatus(supabase, rowId, nextStatus);
    } catch {
      setDraft((prev) => ({ ...prev, userStatus: previous }));
    } finally {
      setStatusSaving(false);
    }
  }

  const referenceLinks = [
    { label: "MyAnimeList", href: draft.linkMal },
    { label: "Nautiljon", href: draft.linkNautiljon },
    { label: "AniList", href: draft.linkAnilist },
  ].filter((item) => item.href.trim().length > 0);

  const watchLinks = [
    { label: "Crunchyroll", href: draft.streamCrunchyroll },
    { label: "Prime Video", href: draft.streamPrimeVideo },
    { label: "Disney+", href: draft.streamDisneyPlus },
    { label: "ADN", href: draft.streamAdn },
    { label: "Anime-sama", href: draft.streamAnimeSama },
  ].filter((item) => item.href.trim().length > 0);
  // TODO: brancher la vraie règle métier (présence dans d'autres tables utilisateur).
  const generalInfoItems = [
    { key: "source", label: "Source", value: resolved.source || "—" },
    { key: "episodes", label: "Épisodes", value: resolved.episodes != null ? String(resolved.episodes) : "—" },
    { key: "duration", label: "Durée", value: resolved.duration || "—" },
    { key: "aired", label: "Diffusion", value: resolved.aired || "—" },
    { key: "season", label: "Saison", value: resolved.seasonLabel || "—" },
    { key: "studios", label: "Studios", value: anime.studios.map((x) => x.name).join(", ") || "—" },
    {
      key: "producers",
      label: "Producteurs",
      value: anime.producers.map((x) => x.name).join(", ") || "—",
    },
    { key: "licenses", label: "Licences", value: anime.licensors.map((x) => x.name).join(", ") || "—" },
  ];

  const editFields: LibraryEditField[] = [
    { key: "titleFr", label: "Titre francisé", group: "Titres", type: "text", value: draft.titleFr },
    { key: "titleRomanized", label: "Titre romanisé", group: "Titres", type: "text", value: draft.titleRomanized },
    { key: "titleOriginal", label: "Titre original", group: "Titres", type: "text", value: draft.titleOriginal },
    { key: "titleAlternatives", label: "Titres alternatifs (séparateur |)", group: "Titres", type: "text", value: draft.titleAlternatives, span2: true },
    { key: "malId", label: "MAL ID (liaison)", group: "Titres", type: "text", value: draft.malId },
    { key: "mediaType", label: "Type", group: "Métadonnées", type: "text", value: draft.mediaType },
    {
      key: "status",
      label: "Statut oeuvre",
      group: "Métadonnées",
      type: "select",
      value: draft.status,
      options: [
        { value: "Currently Airing", label: "Currently Airing" },
        { value: "Finished Airing", label: "Finished Airing" },
        { value: "Not yet aired", label: "Not yet aired" },
      ],
    },
    { key: "rating", label: "Classification", group: "Métadonnées", type: "text", value: draft.rating },
    { key: "source", label: "Source", group: "Métadonnées", type: "text", value: draft.source },
    { key: "seasonLabel", label: "Saison", group: "Métadonnées", type: "text", value: draft.seasonLabel },
    { key: "episodes", label: "Épisodes", group: "Métadonnées", type: "number", value: Number(draft.episodes || 0), min: 0 },
    { key: "duration", label: "Durée", group: "Métadonnées", type: "text", value: draft.duration },
    {
      key: "userStatus",
      label: "Mon statut",
      group: "Suivi personnel",
      type: "select",
      value: draft.userStatus,
      options: ["Planifié", "En cours", "En pause", "Terminé", "Abandonné"].map((value) => ({ value, label: value })),
    },
    { key: "isFavorite", label: "Favori", group: "Suivi personnel", type: "toggle", value: draft.isFavorite },
    { key: "linkMal", label: "Lien MAL", group: "Liens", type: "text", value: draft.linkMal, span2: true },
    { key: "linkNautiljon", label: "Lien Nautiljon", group: "Liens", type: "text", value: draft.linkNautiljon },
    { key: "linkAnilist", label: "Lien AniList", group: "Liens", type: "text", value: draft.linkAnilist },
    { key: "streamCrunchyroll", label: "Crunchyroll", group: "Liens", type: "text", value: draft.streamCrunchyroll },
    { key: "streamPrimeVideo", label: "Prime Video", group: "Liens", type: "text", value: draft.streamPrimeVideo },
    { key: "streamDisneyPlus", label: "Disney+", group: "Liens", type: "text", value: draft.streamDisneyPlus },
    { key: "streamAdn", label: "ADN", group: "Liens", type: "text", value: draft.streamAdn },
    { key: "streamAnimeSama", label: "Anime-sama", group: "Liens", type: "text", value: draft.streamAnimeSama },
    { key: "trailerUrl", label: "Trailer", group: "Liens", type: "text", value: draft.trailerUrl, span2: true },
    { key: "synopsisOriginal", label: "Synopsis source", group: "Synopsis", type: "textarea", value: draft.synopsisOriginal, rows: 5, span2: true },
    { key: "synopsisFr", label: "Synopsis FR", group: "Synopsis", type: "textarea", value: draft.synopsisFr, rows: 5, span2: true },
  ];

  async function saveEditedAnimeEntry() {
    if (editSaving) {
      return;
    }
    setEditSaving(true);
    try {
      const supabase = getSupabaseClient();
      const parsedMalId = Number(String(draft.malId ?? "").trim());
      const nextMalId = Number.isFinite(parsedMalId) && parsedMalId > 0 ? Math.floor(parsedMalId) : Number(anime.mal_id);
      const nextFull = {
        ...(report.full as unknown as Record<string, unknown>),
        mal_id: nextMalId,
        title: resolved.title,
        title_english: draft.titleRomanized,
        title_japanese: draft.titleOriginal,
        title_synonyms: draft.titleAlternatives
          .split("|")
          .map((value) => value.trim())
          .filter(Boolean),
        type: draft.mediaType,
        status: draft.status,
        rating: draft.rating,
        source: draft.source,
        episodes: Number(draft.episodes || 0),
        duration: draft.duration,
        synopsis: draft.synopsisOriginal,
        trailer: {
          ...(((report.full as unknown as Record<string, unknown>).trailer ?? {}) as Record<string, unknown>),
          embed_url: draft.trailerUrl,
        },
      };
      const nextMalSnapshot = {
        ...(malSnapshot ?? {}),
        list_entry: {
          ...(((malSnapshot?.list_entry as Record<string, unknown> | undefined) ?? {})),
          list_status: {
            ...((((malSnapshot?.list_entry as Record<string, unknown> | undefined)?.list_status as Record<string, unknown> | undefined) ?? {})),
            status: mapWatchStatusToDb(draft.userStatus),
            is_favorite: draft.isFavorite,
          },
        },
        manual_overrides: {
          title_fr: draft.titleFr,
          synopsis_fr: draft.synopsisFr,
          locked_field_ids: ["title", "status", "score", "episodes", "synopsis"],
          links: {
            mal: draft.linkMal,
            nautiljon: draft.linkNautiljon,
            anilist: draft.linkAnilist,
            crunchyroll: draft.streamCrunchyroll,
            prime_video: draft.streamPrimeVideo,
            disney_plus: draft.streamDisneyPlus,
            adn: draft.streamAdn,
            anime_sama: draft.streamAnimeSama,
          },
        },
      };
      const { error } = await supabase
        .from("library_anime")
        .update({
          mal_id: nextMalId,
          title: resolved.title,
          title_english: draft.titleRomanized,
          watch_status: mapWatchStatusToDb(draft.userStatus),
          is_favorite: draft.isFavorite,
          mal_official_snapshot: nextMalSnapshot,
          jikan_snapshot: {
            full: nextFull,
            pictures: report.pictures.data?.data ?? [],
            episodes: report.episodes.data?.data ?? [],
          },
          updated_at: new Date().toISOString(),
        })
        .eq("id", rowId);
      if (error) {
        throw new Error(error.message);
      }
      notifyToast({ kind: "success", message: "Fiche animé enregistrée en base." });
      setIsEditModalOpen(false);
      if (nextMalId !== Number(anime.mal_id)) {
        onNavigateToMalId(nextMalId);
      } else {
        window.location.reload();
      }
    } catch (error) {
      notifyToast({
        kind: "error",
        message: error instanceof Error ? error.message : "Impossible d'enregistrer la fiche animé.",
      });
    } finally {
      setEditSaving(false);
    }
  }

  async function translateSynopsisToFrench() {
    const sourceSynopsis = String(draft.synopsisOriginal ?? "").trim();
    if (!sourceSynopsis) {
      notifyToast({ kind: "info", message: "Aucun synopsis source à traduire." });
      return;
    }
    if (translatingSynopsis) {
      return;
    }
    setTranslatingSynopsis(true);
    try {
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=fr&dt=t&q=${encodeURIComponent(sourceSynopsis)}`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Traduction indisponible (HTTP ${response.status}).`);
      }
      const payload = (await response.json()) as unknown;
      const translated = Array.isArray(payload) && Array.isArray(payload[0])
        ? (payload[0] as Array<unknown>)
            .map((chunk) => (Array.isArray(chunk) ? String(chunk[0] ?? "") : ""))
            .join("")
            .trim()
        : "";
      if (!translated) {
        throw new Error("La traduction n'a renvoyé aucun texte.");
      }
      setDraft((prev) => ({ ...prev, synopsisFr: translated }));
      notifyToast({ kind: "success", message: "Synopsis traduit en français." });
    } catch (error) {
      notifyToast({
        kind: "error",
        message: error instanceof Error ? error.message : "Impossible de traduire le synopsis.",
      });
    } finally {
      setTranslatingSynopsis(false);
    }
  }

  async function downloadPoster() {
    if (!poster) {
      notifyToast({ kind: "info", message: "Aucune image à télécharger." });
      return;
    }
    const result = await downloadImageToDownloads(
      poster,
      `${(draft.titleFr || resolved.title || "anime").trim()}-poster`
    );
    if (result.ok) {
      notifyToast({ kind: "success", message: `Image téléchargée: ${result.path}` });
      return;
    }
    notifyToast({ kind: "error", message: result.error });
  }

  async function downloadGalleryImage(src: string, index: number) {
    const result = await downloadImageToDownloads(
      src,
      `${(draft.titleFr || resolved.title || "anime").trim()}-galerie-${index + 1}`
    );
    if (result.ok) {
      notifyToast({ kind: "success", message: `Image téléchargée: ${result.path}` });
      return;
    }
    notifyToast({ kind: "error", message: result.error });
  }

  function openDeleteAnimeModal() {
    if (deleting) {
      return;
    }
    setDeleteModalOpen(true);
  }

  async function confirmDeleteAnime(opts: { removeMal: boolean; removeAnilist: boolean }) {
    if (deleting) {
      return;
    }
    setDeleting(true);
    try {
      const supabase = getSupabaseClient();
      if (opts.removeMal && malIdForRemote) {
        const r = await removeFromExternalList(supabase, {
          provider: "mal",
          malMediaId: malIdForRemote,
          catalog: "anime",
        });
        if (!r.ok) {
          notifyToast({ kind: "error", message: r.error });
          return;
        }
      }
      if (opts.removeAnilist && malIdForRemote) {
        const r = await removeFromExternalList(supabase, {
          provider: "anilist",
          malMediaId: malIdForRemote,
          catalog: "anime",
        });
        if (!r.ok) {
          notifyToast({ kind: "error", message: r.error });
          return;
        }
      }
      await deleteAnimeEntry(supabase, rowId);
      notifyToast({ kind: "success", message: "Fiche supprimée." });
      setDeleteModalOpen(false);
      onDeleted();
    } catch (error) {
      notifyToast({
        kind: "error",
        message: error instanceof Error ? error.message : "Suppression impossible.",
      });
    } finally {
      setDeleting(false);
    }
  }

  async function exportDebugPayload() {
    if (exportingDebugJson) {
      return;
    }
    setExportingDebugJson(true);
    try {
      const supabase = getSupabaseClient();
      const { data: authData } = await supabase.auth.getUser();
      const userId = authData.user?.id ?? null;
      const animeMalId = Number(anime.mal_id);
      const [animeById, animeByMal, readingLinks] = await Promise.all([
        supabase.from("library_anime").select("*").eq("id", rowId).maybeSingle(),
        supabase.from("library_anime").select("*").eq("mal_id", animeMalId),
        supabase
          .from("library_reading")
          .select("id, mal_manga_id, title, read_status, updated_at, mal_official_snapshot, jikan_snapshot"),
      ]);

      const payload = {
        exported_at: new Date().toISOString(),
        app: "Nexus-Tauri",
        entity: {
          media: "anime",
          mal_id: animeMalId,
          anime_row_id: rowId,
        },
        context: {
          user_id: userId,
          url_path: window.location.pathname,
          debug_mode_enabled: isDebugModeEnabled(),
        },
        local_state: {
          report,
          resolved,
          draft,
          watch_status: watchStatus,
          is_favorite: isFavorite,
          franchise_entries: franchiseEntries,
          seen_episode_ids: seenEpisodeIds,
          live_sync_full: liveSyncFull,
        },
        supabase: {
          anime_by_id: animeById.data ?? null,
          anime_by_mal_all_rows: animeByMal.data ?? [],
          reading_rows_context: readingLinks.data ?? [],
          errors: {
            anime_by_id: animeById.error?.message ?? null,
            anime_by_mal: animeByMal.error?.message ?? null,
            reading_rows_context: readingLinks.error?.message ?? null,
          },
        },
      };

      const safeTitle = String(draft.titleFr || resolved.title || `anime-${animeMalId}`)
        .toLowerCase()
        .replace(/[^a-z0-9-_]+/g, "-")
        .slice(0, 60);
      downloadJsonFile(`debug-anime-${animeMalId}-${safeTitle}.json`, payload);
      notifyToast({ kind: "success", message: "Export JSON debug généré." });
    } catch (error) {
      notifyToast({
        kind: "error",
        message: error instanceof Error ? error.message : "Export debug impossible.",
      });
    } finally {
      setExportingDebugJson(false);
    }
  }

  return (
    <section className="anime-detail-body">
      <LibraryDetailStickyHeader
        backTo="/anime"
        backLabel="← Retour à la collection animés"
        backState={backState}
        onSync={() => void openSyncDiffModal()}
        onEdit={() => setIsEditModalOpen(true)}
        onRefresh={() => window.location.reload()}
        onExportJson={
          isDebugModeEnabled() ? () => void exportDebugPayload() : undefined
        }
        exportBusy={exportingDebugJson}
        onDelete={() => openDeleteAnimeModal()}
        deleting={deleting}
        editLabel="Modifier la fiche"
        syncTitle="Relancer la synchronisation MAL pour cette fiche"
        refreshTitle="Recharge les données Jikan/MAL pour cette fiche"
      />
      <LibraryEditEntryModal
        open={isEditModalOpen}
        title="Modifier la fiche animé"
        fields={editFields}
        saving={editSaving}
        translateLabel={translatingSynopsis ? "Traduction..." : "Traduire"}
        onTranslate={() => void translateSynopsisToFrench()}
        translateDisabled={translatingSynopsis}
        onChange={(key, value) => updateDraft(key as keyof typeof draft, value as never)}
        helpTitle="Aide au remplissage"
        helpLines={[
          "Statut oeuvre doit rester dans les valeurs MAL officielles.",
          "Liens: utiliser des URLs complètes (https://...).",
          "Synopsis source = texte brut d'origine ; Synopsis FR = adaptation/traduction.",
          "Champs numériques attendent une valeur entière positive ou 0.",
        ]}
        onClose={() => setIsEditModalOpen(false)}
        onSave={() => void saveEditedAnimeEntry()}
      />

      <section className="anime-detail-section anime-detail-main-structured">
        <div className="anime-detail-hero anime-detail-hero-legacy">
          <aside className="anime-detail-left-panel">
            {poster ? (
              <div className="library-downloadable-image is-main-cover">
                <button
                  type="button"
                  className="anime-detail-image-btn"
                  onClick={() => openPreview([poster], 0)}
                >
                  <img
                    className="anime-detail-poster anime-detail-poster-legacy"
                    src={poster}
                    alt=""
                    width={260}
                    height={390}
                  />
                </button>
                <button
                  type="button"
                  className="library-download-image-btn"
                  onClick={() => void downloadPoster()}
                  title="Télécharger l'image"
                >
                  💾
                </button>
              </div>
            ) : (
              <div className="anime-detail-poster anime-detail-poster-legacy" aria-hidden />
            )}

            <LibraryReferenceLinksSection
              links={referenceLinks.map((item) => ({ key: item.label, label: item.label, href: item.href }))}
            />

            <LibraryPersonalProgressSection
              status={draft.userStatus as PersonalStatus}
              onStatusChange={(next) => void updateUserStatus(next)}
              statusDisabled={statusSaving}
              favorite={draft.isFavorite}
              onToggleFavorite={() => void toggleFavorite()}
              favoriteDisabled={favoriteSaving}
              progressItems={[
                {
                  id: "episodes",
                  label: "Épisodes",
                  current: episodesSeen,
                  total: episodesTotal,
                  percent: episodeProgress,
                },
              ]}
            />
            <div className="anime-detail-subsection">
              <h3 className="anime-detail-subtitle-heading">Où regarder (personnalisé)</h3>
              {watchLinks.length === 0 ? (
                <p className="anime-detail-prose">Renseigner les plateformes en mode modification.</p>
              ) : (
                <div className="anime-detail-tag-row">
                  {watchLinks.map((item) => (
                    <a
                      key={item.label}
                      className="anime-detail-tag anime-detail-link-tag"
                      href={item.href}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {item.label}
                    </a>
                  ))}
                </div>
              )}
            </div>
          </aside>

          <div className="anime-detail-title-block anime-detail-main-panel">
            <LibraryMainMetaHeader
              title={draft.titleFr.trim() || draft.titleRomanized || draft.titleOriginal || resolved.title}
              titleTag="h1"
              subtitles={[
                draft.titleRomanized || "",
                draft.titleOriginal || resolved.titleJapanese || "",
                ...resolved.titleAlternatives,
              ]}
              chips={[
                ...(resolved.status !== "—"
                  ? [{ key: "status", label: resolved.status, toneClass: `anime-detail-chip-${chipToneByValue(resolved.status)}` }]
                  : []),
                ...(resolved.mediaType !== "—"
                  ? [{ key: "media-type", label: resolved.mediaType, toneClass: `anime-detail-chip-${chipToneByValue(resolved.mediaType)}` }]
                  : []),
                ...(anime.demographics[0]
                  ? [{
                      key: "demographic",
                      label: translateLibraryTerm("demographic", anime.demographics[0].name),
                      toneClass: `anime-detail-chip-${chipToneByValue(translateLibraryTerm("demographic", anime.demographics[0].name))}`,
                    }]
                  : []),
                ...(resolved.rating !== "—"
                  ? [{ key: "rating", label: resolved.rating, toneClass: `anime-detail-chip-${chipToneByValue(resolved.rating)}` }]
                  : []),
                ...(resolved.score != null
                  ? [{ key: "score", label: `★ ${resolved.score}`, toneClass: "anime-detail-chip-gold" }]
                  : []),
              ]}
            />
            <LibraryBadgeGroup
              small
              items={[
                ...anime.genres.map((g) => ({ ...g, name: translateLibraryTerm("genre", g.name) })),
                ...anime.themes.map((g) => ({ ...g, name: translateLibraryTerm("theme", g.name) })),
              ].map((g) => ({
                key: `chip-${g.mal_id}-${g.name}`,
                label: g.name,
                toneClass: `anime-detail-chip-${chipToneByValue(g.name)}`,
              }))}
            />
            <LibrarySynopsisSection synopsis={draft.synopsisFr || resolved.synopsis} fallback="" />
            <LibraryGeneralInfoGrid items={generalInfoItems} />
            <LibraryFranchiseSection
              items={franchiseEntries
                .filter((entry) => !(entry.media === "anime" && entry.malId === anime.mal_id))
                .map((entry) => {
                  const base = {
                    key: `${entry.media}-${entry.rowId}`,
                    title: entry.title,
                    meta: `${entry.statusLabel} • ${entry.progressLabel}`,
                    isCurrent: entry.media === "anime" && entry.malId === anime.mal_id,
                    isFavorite: entry.isFavorite,
                    imageUrl: entry.imageUrl,
                  };
                  if (entry.media === "anime") {
                    if (entry.malId > 0) {
                      return { ...base, to: `/anime/${entry.malId}` };
                    }
                    if (entry.anilistMediaId != null && entry.anilistMediaId > 0) {
                      return {
                        ...base,
                        href: `https://anilist.co/anime/${entry.anilistMediaId}`,
                      };
                    }
                    return { ...base, to: `/anime/${entry.rowId}` };
                  }
                  return {
                    ...base,
                    to: readingEntryDetailPath({
                      id: entry.rowId,
                      malId: entry.malId,
                      anilistMediaId: entry.anilistMediaId,
                    }),
                  };
                })}
            />
            <LibraryMediaGallery
              images={report.pictures.ok ? galleryImageSources.filter(Boolean) : []}
              emptyMessage="Galerie indisponible."
              onDownloadImage={(src, index) => void downloadGalleryImage(src, index)}
            />
          </div>
        </div>
      </section>

      <LibraryMediaPreviewModal
        open={previewIndex !== null}
        images={previewImages}
        startIndex={previewIndex ?? 0}
        onClose={() => setPreviewIndex(null)}
      />

      <DeleteLibraryEntryConfirmModal
        open={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        entryTitle={draft.titleFr || resolved.title || ""}
        kind="anime"
        malMediaId={malIdForRemote}
        oauthMalConnected={integrationConnected.mal}
        oauthAnilistConnected={integrationConnected.anilist}
        busy={deleting}
        onConfirm={(opts) => void confirmDeleteAnime(opts)}
      />

      <LibrarySyncDiffModal
        open={isSyncModalOpen}
        onClose={() => setIsSyncModalOpen(false)}
        fields={syncDiffFields}
        selectedFieldIds={selectedDiffFieldIds}
        onToggleField={toggleDiffField}
        onSelectAll={() => setSelectedDiffFieldIds(syncDiffFields.map((field) => field.id))}
        onSelectNone={() => setSelectedDiffFieldIds([])}
        onValidate={() => void launchAnimeSync("mal")}
        onSyncMal={() => void launchAnimeSync("mal")}
        onSyncAnilist={() => void launchAnimeSync("anilist")}
        syncing={syncLaunching || syncPreparing}
      />

      <section className="anime-detail-section">
        <h2>Épisodes</h2>
        {report.episodes.ok ? (
          <div className="anime-detail-episodes-grid">
            {(report.episodes.data?.data ?? []).map((ep) => {
              const seen = seenEpisodeIds.includes(ep.mal_id);
              return (
                <button
                  key={ep.mal_id}
                  type="button"
                  className={`anime-detail-episode-pill${seen ? " anime-detail-episode-pill-seen" : ""}`}
                  title={`${ep.title}${ep.filler ? " • filler" : ""}${ep.recap ? " • recap" : ""}`}
                  onClick={() => toggleEpisodeSeen(ep.mal_id)}
                >
                  <span>#{ep.mal_id}</span>
                  <small>{ep.title}</small>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="anime-detail-prose">Épisodes indisponibles.</p>
        )}
      </section>
    </section>
  );
}

