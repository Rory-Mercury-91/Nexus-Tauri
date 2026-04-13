import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { ImageOff } from "lucide-react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { Modal } from "@/components/common/Modal";
import { OwnerToggleList } from "@/components/common/OwnerToggleList";
import { ProfileAvatarImage } from "@/components/common/ProfileAvatarImage";
import { ToggleSwitch } from "@/components/common/ToggleSwitch";
import { LibraryMediaGallery } from "@/components/library/LibraryMediaGallery";
import { LibraryFranchiseSection } from "@/components/library/LibraryFranchiseSection";
import { LibraryPersonalProgressSection } from "@/components/library/LibraryPersonalProgressSection";
import { LibraryReferenceLinksSection } from "@/components/library/LibraryReferenceLinksSection";
import { LibrarySynopsisSection } from "@/components/library/LibrarySynopsisSection";
import { LibraryBadgeGroup } from "@/components/library/LibraryBadgeGroup";
import { LibraryMainMetaHeader } from "@/components/library/LibraryMainMetaHeader";
import { LibraryGeneralInfoGrid } from "@/components/library/LibraryGeneralInfoGrid";
import { LibrarySyncDiffModal } from "@/components/modals/LibrarySyncDiffModal/LibrarySyncDiffModal";
import { LibraryEditEntryModal, type LibraryEditField } from "@/components/modals/LibraryEditEntryModal/LibraryEditEntryModal";
import { useReadingSyncProgress } from "@/contexts/ReadingSyncProgressContext";
import { notifyToast } from "@/lib/toastEvents";
import { downloadImageToDownloads } from "@/lib/imageDownload";
import { downloadJsonFile, isDebugModeEnabled } from "@/lib/debugTools";
import { getSupabaseClient } from "@/lib/supabaseClient";
import { LibraryDetailStickyHeader } from "@/pages/library/LibraryDetailStickyHeader";
import { listFamilyMembersWithRole, listMyFamilies, type FamilyMemberWithRole } from "@/services/family/familyService";
import { fetchReadingFull, fetchReadingPictures } from "@/services/jikan/readingJikanService";
import {
  fetchReadingVolumes,
  normalizeOwnerUserId,
  upsertReadingVolume,
  type ReadingVolumeRow,
} from "@/services/library/readingVolumeService";
import { deleteReadingEntry } from "@/services/library/readingCollectionService";
import { removeFromExternalList } from "@/services/library/externalReadingListDeleteService";
import { fetchIntegrationStatus } from "@/services/integrations/integrationService";
import { DeleteLibraryEntryConfirmModal } from "@/features/library/DeleteLibraryEntryConfirmModal/DeleteLibraryEntryConfirmModal";
import { isMalSyntheticId } from "@/lib/malSyntheticIds";
import { buildReadingSyncDiffFields } from "@/services/library/syncDiffService";
import { translateLibraryTerm, translateLibraryTerms } from "@/services/library/termTranslations";
import { scrollMainToTop } from "@/lib/collectionScroll";
import { collectRelatedIdsFromSnapshots } from "@/lib/libraryRelationSnapshots";
import { proxyNautiljonImage } from "@/lib/imageProxy";
import { formatPeriodeFr } from "@/lib/dateUtils";
import "./LibraryPages.css";
import "./AnimeDetailPage/AnimeDetailPage.css";
import "./ReadingDetailPage.css";

type FranchiseDbEntry = {
  media: "reading" | "anime";
  rowId: string;
  malId: number;
  anilistMediaId: number | null;
  title: string;
  status: string;
  progressLabel: string;
  imageUrl: string;
};

type EditingVolumeState = {
  volumeNumber: number;
  volumeType: string;
  priceEuros: number;
  imageUrl: string;
  releaseDateVf: string;
  purchaseDate: string;
  ownerIds: string[];
};

type PropagateOwnersDraft = {
  sourceVolumeNumber: number;
  ownerIds: string[];
  volumesSnapshot: ReadingVolumeRow[];
};

function normalizeOwnerIdsKey(owners: ReadingVolumeRow["owners"]): string {
  return owners
    .map((o) => o.userId)
    .filter(Boolean)
    .sort()
    .join(",");
}

function normalizeUserIdsList(ids: string[]): string {
  return [...ids].filter(Boolean).sort().join(",");
}

function mapReadStatusToFr(raw: string | null): string {
  const key = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_")
    .replace(/\s+/g, "_");
  switch (key) {
    case "reading":
      return "En cours";
    case "completed":
      return "Terminé";
    case "on_hold":
    case "onhold":
      return "En pause";
    case "dropped":
      return "Abandonné";
    default:
      return "Planifié";
  }
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
    default:
      return "Planifié";
  }
}

function franchiseReadingDetailPath(entry: FranchiseDbEntry): string {
  if (entry.malId > 0) {
    return `/lectures/${entry.malId}`;
  }
  if (entry.anilistMediaId != null && entry.anilistMediaId > 0) {
    return `/lectures/anilist/${entry.anilistMediaId}`;
  }
  return `/lectures/${entry.rowId}`;
}

function franchiseAnimeLink(entry: FranchiseDbEntry): { to?: string; href?: string } {
  if (entry.malId > 0) {
    return { to: `/anime/${entry.malId}` };
  }
  if (entry.anilistMediaId != null && entry.anilistMediaId > 0) {
    return { href: `https://anilist.co/anime/${entry.anilistMediaId}` };
  }
  return { to: `/anime/${entry.rowId}` };
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

function mapReadStatusToDb(raw: string): string {
  switch (raw) {
    case "En cours":
      return "reading";
    case "Terminé":
      return "completed";
    case "En pause":
      return "on_hold";
    case "Abandonné":
      return "dropped";
    default:
      return "plan_to_read";
  }
}

export function ReadingDetailPage() {
  const { id, anilistId } = useParams<{ id?: string; anilistId?: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const detailState = (location.state as {
    fromCollection?: "lectures";
    collectionScrollY?: number;
    collectionViewMode?: "grid" | "list";
  } | null) ?? null;
  const backState =
    detailState?.fromCollection === "lectures" &&
    Number.isFinite(detailState.collectionScrollY ?? NaN)
      ? {
          fromDetailCollection: "lectures" as const,
          restoreScrollY: Number(detailState.collectionScrollY),
          collectionViewMode: detailState.collectionViewMode,
        }
      : undefined;
  const anilistMediaIdRoute = useMemo(() => {
    const n = Number(anilistId);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [anilistId]);

  const rowIdFromRoute = useMemo(() => {
    if (anilistId || !id) {
      return null;
    }
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return id;
    }
    return null;
  }, [id, anilistId]);

  const malId = useMemo(() => {
    if (anilistMediaIdRoute != null || rowIdFromRoute) {
      return null;
    }
    const n = Number(id);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [id, anilistMediaIdRoute, rowIdFromRoute]);

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

  const [chaptersRead, setChaptersRead] = useState(0);
  const [chaptersTotal, setChaptersTotal] = useState(0);
  const [volumesRead, setVolumesRead] = useState(0);
  const [userReadStatus, setUserReadStatus] = useState<string>("Planifié");
  const [userFavorite, setUserFavorite] = useState(false);
  const [statusSaving, setStatusSaving] = useState(false);
  const [progressSaving, setProgressSaving] = useState(false);
  const [readingRowId, setReadingRowId] = useState<string | null>(null);
  const [rawDbRow, setRawDbRow] = useState<Record<string, unknown> | null>(null);
  const [rawLiveJikan, setRawLiveJikan] = useState<Record<string, unknown> | null>(null);
  const [franchiseEntries, setFranchiseEntries] = useState<FranchiseDbEntry[]>([]);
  const [volumes, setVolumes] = useState<ReadingVolumeRow[]>([]);
  const [familyId, setFamilyId] = useState<string | null>(null);
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [familyMembers, setFamilyMembers] = useState<FamilyMemberWithRole[]>([]);
  const [isVolumeModalOpen, setIsVolumeModalOpen] = useState(false);
  const [editingVolume, setEditingVolume] = useState<EditingVolumeState | null>(null);
  const [volumeSaving, setVolumeSaving] = useState(false);
  const [propagateOwnersDraft, setPropagateOwnersDraft] = useState<PropagateOwnersDraft | null>(null);
  const [propagateOwnerTargetsSelected, setPropagateOwnerTargetsSelected] = useState<Set<number>>(() => new Set());
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [translatingSynopsis, setTranslatingSynopsis] = useState(false);
  const [syncLaunching, setSyncLaunching] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [integrationConnected, setIntegrationConnected] = useState({ mal: false, anilist: false });
  const [exportingDebugJson, setExportingDebugJson] = useState(false);
  const { startSync: startReadingSync, activeRun: activeReadingRun } = useReadingSyncProgress();
  const [selectedDiffFieldIds, setSelectedDiffFieldIds] = useState<string[]>([]);
  const [galleryImages, setGalleryImages] = useState<string[]>([]);
  const [collapseChapters, setCollapseChapters] = useState<boolean>(() => localStorage.getItem("reading-detail:collapse:chapters") === "1");
  const [collapseVolumes, setCollapseVolumes] = useState<boolean>(() => localStorage.getItem("reading-detail:collapse:volumes") === "1");
  const chapterProgress = chaptersTotal > 0 ? Math.round((chaptersRead / Math.max(1, chaptersTotal)) * 100) : 0;

  const effectiveMalMangaId = useMemo(() => {
    const fromDb = Number((rawDbRow as { mal_manga_id?: unknown } | null)?.mal_manga_id ?? 0);
    if (Number.isFinite(fromDb) && fromDb > 0) {
      return fromDb;
    }
    return malId;
  }, [rawDbRow, malId]);

  const malIdForRemote = useMemo(() => {
    if (effectiveMalMangaId === null) {
      return null;
    }
    const n = Number(effectiveMalMangaId);
    if (!Number.isFinite(n) || n <= 0) {
      return null;
    }
    if (isMalSyntheticId(n)) {
      return null;
    }
    return n;
  }, [effectiveMalMangaId]);

  /** Clé catalogue tomes VF : MAL si présent, sinon AniList (fiche DB ou segment d’URL). */
  const volumeCatalogUpsertKeys = useMemo((): { malMangaId?: number; anilistMediaId?: number } | null => {
    const fromDbMal = Number((rawDbRow as { mal_manga_id?: unknown } | null)?.mal_manga_id ?? 0);
    const fromDbAni = Number((rawDbRow as { anilist_media_id?: unknown } | null)?.anilist_media_id ?? 0);
    const mal =
      Number.isFinite(fromDbMal) && fromDbMal > 0
        ? fromDbMal
        : malId != null && malId > 0
          ? malId
          : 0;
    const ani =
      Number.isFinite(fromDbAni) && fromDbAni > 0
        ? fromDbAni
        : anilistMediaIdRoute != null && anilistMediaIdRoute > 0
          ? anilistMediaIdRoute
          : 0;
    if (mal > 0) {
      return { malMangaId: mal };
    }
    if (ani > 0) {
      return { anilistMediaId: ani };
    }
    return null;
  }, [rawDbRow, malId, anilistMediaIdRoute]);

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

  const readingView = useMemo(() => {
    const db = rawDbRow ?? {};
    const rawMalSnapshot = ((db.mal_official_snapshot as Record<string, unknown> | undefined) ?? {});
    const manualOverrides = getManualOverrides(rawMalSnapshot);
    const manualLinks = ((manualOverrides.links as Record<string, unknown> | undefined) ?? {});
    const dbJikanSnapshot = ((db.jikan_snapshot as Record<string, unknown> | undefined) ?? {});
    const dbFull = ((dbJikanSnapshot.full as Record<string, unknown> | undefined) ?? {});
    const liveRaw = (rawLiveJikan?.data ?? rawLiveJikan ?? {}) as Record<string, unknown>;
    const jikanRaw = { ...liveRaw, ...dbFull };
    const manualTitleFr = String(manualOverrides.title_fr ?? "").trim();
    // Synopsis : manual_overrides.synopsis_fr en priorité, sinon fallback sur jikan_snapshot.synopsis_fr_auto (traduction auto)
    const synopsisFrAuto = String(dbJikanSnapshot.synopsis_fr_auto ?? "").trim();
    const manualSynopsisFr = String(manualOverrides.synopsis_fr ?? synopsisFrAuto).trim();
    const manualVolumesVf = Number(manualOverrides.volumes_vf ?? 0);
    const manualTitreOriginal = String(manualOverrides.titre_original ?? "").trim();
    const manualEditeurVf = String(manualOverrides.editeur_vf ?? "").trim();
    const manualEditeurVo = String(manualOverrides.editeur_vo ?? "").trim();
    const manualAnneeVf = String(manualOverrides.annee_vf ?? "").trim();
    const manualAnneeVo = String(manualOverrides.annee_vo ?? "").trim();
    const manualTraducteur = String(manualOverrides.traducteur ?? "").trim();
    const manualScenarist = String(manualOverrides.scenarist ?? "").trim();
    const manualDessinateur = String(manualOverrides.dessinateur ?? "").trim();
    const manualAgeConseille = String(manualOverrides.age_conseille ?? "").trim();
    const manualGroupe = String(manualOverrides.groupe ?? "").trim();
    const manualPrepublie = String(manualOverrides.prepublie ?? "").trim();
    const manualLinkMal = String(manualLinks.mal ?? "").trim();
    const manualLinkNautiljon = String(manualLinks.nautiljon ?? "").trim();
    const manualLinkAnilist = String(manualLinks.anilist ?? "").trim();
    const titleJapanese = String(jikanRaw.title_japanese ?? "").trim();
    const titleEnglish = String(jikanRaw.title_english ?? "").trim();
    
    // Priorisation : Titre VF > Titre Romanisé > Titre Original (japonais)
    const title = String(
      (manualTitleFr || undefined) ??
      (titleEnglish || undefined) ??
      (manualTitreOriginal || undefined) ??
      (titleJapanese || undefined) ??
      jikanRaw.title ??
        (db.title as string | undefined) ??
        "—"
    );
    const titleSynonyms = Array.isArray(jikanRaw.title_synonyms)
      ? (jikanRaw.title_synonyms as unknown[]).map((v) => String(v ?? "")).filter(Boolean)
      : [];
    const mediaType = translateLibraryTerm("mediaType", String(jikanRaw.type ?? "Manga"));
    const workStatus = translateLibraryTerm("workStatus", String(jikanRaw.status ?? "—")) || "—";
    const score = Number(jikanRaw.score ?? 0);
    const scoredBy = Number(jikanRaw.scored_by ?? 0);
    const rank = Number(jikanRaw.rank ?? 0);
    const popularity = Number(jikanRaw.popularity ?? 0);
    const members = Number(jikanRaw.members ?? 0);
    const favorites = Number(jikanRaw.favorites ?? 0);
    const synopsis = String((manualSynopsisFr || undefined) ?? jikanRaw.synopsis ?? "").trim();
    const synopsisOriginal = String(jikanRaw.synopsis ?? "").trim();
    const publishedObj = (jikanRaw.published as Record<string, unknown> | undefined) ?? {};
    const publishedFrom = String(publishedObj.from ?? "").trim();
    const publishedTo = String(publishedObj.to ?? "").trim();
    const publishedString = String(publishedObj.string ?? "").trim();
    const publishedStringFr = formatPeriodeFr(publishedFrom, publishedTo);
    const sourceUrl = String(jikanRaw.url ?? "").trim();
    const sourceUrlOverride = manualLinkMal || sourceUrl;
    const genres = Array.isArray(jikanRaw.genres)
      ? (jikanRaw.genres as Array<Record<string, unknown>>).map((g) => String(g.name ?? "")).filter(Boolean)
      : [];
    const themes = Array.isArray(jikanRaw.themes)
      ? (jikanRaw.themes as Array<Record<string, unknown>>).map((g) => String(g.name ?? "")).filter(Boolean)
      : [];
    const demographics = Array.isArray(jikanRaw.demographics)
      ? (jikanRaw.demographics as Array<Record<string, unknown>>).map((g) => String(g.name ?? "")).filter(Boolean)
      : [];
    const authors = Array.isArray(jikanRaw.authors)
      ? (jikanRaw.authors as Array<Record<string, unknown>>).map((a) => String(a.name ?? "")).filter(Boolean)
      : [];
    const serializations = Array.isArray(jikanRaw.serializations)
      ? (jikanRaw.serializations as Array<Record<string, unknown>>).map((s) => String(s.name ?? "")).filter(Boolean)
      : [];
    const imageUrl =
      String(
        ((jikanRaw.images as Record<string, unknown> | undefined)?.jpg as Record<string, unknown> | undefined)
          ?.large_image_url ??
          ((jikanRaw.images as Record<string, unknown> | undefined)?.jpg as Record<string, unknown> | undefined)
            ?.image_url ??
          (db.main_picture_url as string | undefined) ??
          ""
      ) || "";
    const liveChapters = Number(jikanRaw.chapters ?? 0);
    const liveVolumes = Number(jikanRaw.volumes ?? 0);
    const externalLinks = Array.isArray(jikanRaw.external)
      ? (jikanRaw.external as Array<Record<string, unknown>>)
          .map((entry) => ({
            name: String(entry.name ?? ""),
            url: String(entry.url ?? ""),
          }))
          .filter((entry) => entry.name.length > 0 && entry.url.length > 0)
      : [];
    const externalLinksWithOverrides = [
      ...externalLinks,
      ...(manualLinkNautiljon
        ? [{ name: "Nautiljon", url: manualLinkNautiljon }]
        : []),
      ...(manualLinkAnilist
        ? [{ name: "AniList", url: manualLinkAnilist }]
        : []),
    ];
    return {
      title,
      titleFr: manualTitleFr,
      titleRomanized: titleEnglish,
      titleOriginal: manualTitreOriginal || titleJapanese,
      titleJapanese,
      titleEnglish,
      titleSynonyms,
      mediaType,
      workStatus,
      score: Number.isFinite(score) ? score : 0,
      scoredBy: Number.isFinite(scoredBy) ? scoredBy : 0,
      rank: Number.isFinite(rank) ? rank : 0,
      popularity: Number.isFinite(popularity) ? popularity : 0,
      members: Number.isFinite(members) ? members : 0,
      favorites: Number.isFinite(favorites) ? favorites : 0,
      synopsis,
      synopsisOriginal,
      publishedString,
      publishedStringFr,
      publishedFrom,
      publishedTo,
      sourceUrl: sourceUrlOverride,
      genres: translateLibraryTerms("genre", genres),
      themes: translateLibraryTerms("theme", themes),
      demographics: translateLibraryTerms("demographic", demographics),
      authors,
      serializations,
      imageUrl,
      liveChapters: Number.isFinite(liveChapters) ? liveChapters : 0,
      liveVolumes: Number.isFinite(liveVolumes) ? liveVolumes : 0,
      volumesVf: Number.isFinite(manualVolumesVf) && manualVolumesVf > 0 ? manualVolumesVf : null,
      editeurVf: manualEditeurVf || null,
      editeurVo: manualEditeurVo || null,
      anneeVf: manualAnneeVf || null,
      anneeVo: manualAnneeVo || null,
      traducteur: manualTraducteur || null,
      scenarist: manualScenarist || null,
      dessinateur: manualDessinateur || null,
      ageConseille: manualAgeConseille || null,
      groupe: manualGroupe || null,
      prepublie: manualPrepublie || null,
      externalLinks: externalLinksWithOverrides,
    };
  }, [rawDbRow, rawLiveJikan]);
  
  const volumeByNumber = useMemo(() => {
    const map = new Map<number, ReadingVolumeRow>();
    volumes.forEach((volume) => map.set(volume.volumeNumber, volume));
    return map;
  }, [volumes]);
  const volumesWithReleaseDate = useMemo(() => {
    return volumes.filter((volume) => volume.releaseDateVf).sort((a, b) => a.volumeNumber - b.volumeNumber);
  }, [volumes]);
  
  // Calculer le nombre réel de volumes lus en fonction des toggles individuels
  const actualVolumesRead = useMemo(() => {
    return volumes.filter((volume) => volume.isRead).length;
  }, [volumes]);
  
  // Utiliser volumesVf (nombre de volumes sortis en VF) en priorité, sinon volumes VO
  const effectiveVolumesTotal = (readingView.volumesVf && readingView.volumesVf > 0) 
    ? readingView.volumesVf 
    : readingView.liveVolumes;
  const volumeProgress =
    effectiveVolumesTotal > 0 ? Math.round((actualVolumesRead / Math.max(1, effectiveVolumesTotal)) * 100) : 0;
  const costByOwner = useMemo(() => {
    const memberMap = new Map(familyMembers.map((member) => [member.id, member]));
    const totalByOwner = new Map<string, { amount: number; volumesCount: number; name: string; avatarPath: string | null }>();
    volumes.forEach((volume) => {
      volume.owners.forEach((owner) => {
        const member = memberMap.get(owner.userId);
        const current = totalByOwner.get(owner.userId) ?? {
          amount: 0,
          volumesCount: 0,
          name: member?.display_name ?? "Membre",
          avatarPath: member?.avatar_storage_path ?? null,
        };
        current.amount += owner.shareEuros;
        current.volumesCount += 1;
        totalByOwner.set(owner.userId, current);
      });
    });
    return Array.from(totalByOwner.entries()).map(([userId, data]) => ({
      userId,
      amount: data.amount,
      volumesCount: data.volumesCount,
      name: data.name,
      avatarPath: data.avatarPath,
    }));
  }, [familyMembers, volumes]);
  const totalCost = useMemo(
    () => costByOwner.reduce((acc, owner) => acc + owner.amount, 0),
    [costByOwner]
  );
  const dedupedAltTitles = useMemo(() => {
    function normalizeAltTitle(value: string): string {
      return value
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/^[\s"'`«»[\]【】(){}<>]+|[\s"'`«»[\]【】(){}<>]+$/g, "")
        .replace(/[[\]【】"'`«»]/g, "")
        .replace(/\s+/g, " ")
        .trim();
    }

    const source = [
      ...readingView.titleSynonyms,
      readingView.titleEnglish,
      readingView.titleJapanese,
    ].map((value) => value.trim()).filter(Boolean);
    const normalizedMain = normalizeAltTitle(readingView.title.trim());
    const seen = new Set<string>();
    const output: string[] = [];
    for (const value of source) {
      const normalized = normalizeAltTitle(value);
      if (!normalized || normalized === normalizedMain || seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      output.push(value);
    }
    return output;
  }, [readingView.title, readingView.titleEnglish, readingView.titleJapanese, readingView.titleSynonyms]);
  const dedupedBadges = useMemo(() => {
    function normalizeBadge(value: string): string {
      return value
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[[\]【】"'`«»]/g, "")
        .replace(/\s+/g, " ")
        .trim();
    }

    const seen = new Set<string>();
    const genres: string[] = [];
    const themes: string[] = [];
    const demographics: string[] = [];

    for (const value of readingView.genres) {
      const key = normalizeBadge(value);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      genres.push(value);
    }
    for (const value of readingView.themes) {
      const key = normalizeBadge(value);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      themes.push(value);
    }
    for (const value of readingView.demographics) {
      const key = normalizeBadge(value);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      demographics.push(value);
    }
    return { genres, themes, demographics };
  }, [readingView.demographics, readingView.genres, readingView.themes]);

  // Déterminer la couleur du badge de statut selon sa valeur
  const getWorkStatusColor = (status: string): string => {
    const normalized = status.toLowerCase();
    if (normalized.includes("terminé") || normalized.includes("finished")) {
      return "anime-detail-chip-green";
    }
    if (normalized.includes("en cours") || normalized.includes("en pause") || normalized.includes("publishing") || normalized.includes("hiatus")) {
      return "anime-detail-chip-info";
    }
    if (normalized.includes("abandonné") || normalized.includes("discontinued")) {
      return "anime-detail-chip-red";
    }
    return "anime-detail-chip-violet";
  };
  const generalInfoItems = [
    // Créateurs - Prioriser les données Nautiljon (plus détaillées) sur MAL
    ...(readingView.scenarist || readingView.dessinateur 
      ? [
          ...(readingView.scenarist ? [{ key: "scenarist", label: "Scénariste", value: readingView.scenarist }] : []),
          ...(readingView.dessinateur ? [{ key: "dessinateur", label: "Dessinateur", value: readingView.dessinateur }] : []),
        ]
      : readingView.authors.length > 0 
        ? [{ key: "authors", label: "Auteur", value: readingView.authors.join(", ") }]
        : []
    ),
    ...(readingView.traducteur ? [{ key: "traducteur", label: "Traducteur", value: readingView.traducteur }] : []),
    
    // Magazine - Prioriser Nautiljon (prepublie) sur MAL (serializations)
    ...(readingView.prepublie 
      ? [{ key: "magazine", label: "Magazine", value: readingView.prepublie }]
      : readingView.serializations.length > 0 
        ? [{ key: "magazine", label: "Magazine", value: readingView.serializations.join(", ") }]
        : []
    ),
    
    // Éditeurs
    ...(readingView.editeurVf ? [{ key: "editeur-vf", label: "Éditeur VF", value: readingView.editeurVf }] : []),
    ...(readingView.editeurVo ? [{ key: "editeur-vo", label: "Éditeur VO", value: readingView.editeurVo }] : []),
    
    // Publication complète (dates de début/fin)
    ...(readingView.publishedStringFr && readingView.publishedStringFr !== "—" ? [{ key: "publication", label: "Publication", value: readingView.publishedStringFr }] : []),
    
    // Années et Volumes - alignés en colonnes (gauche: années, droite: volumes)
    ...(readingView.anneeVo ? [{ key: "annee-vo", label: "Première parution VO", value: readingView.anneeVo }] : []),
    ...(readingView.liveVolumes > 0 ? [{ key: "source-volumes", label: "Volumes VO", value: String(readingView.liveVolumes) }] : []),
    ...(readingView.anneeVf ? [{ key: "annee-vf", label: "Première parution VF", value: readingView.anneeVf }] : []),
    ...(readingView.volumesVf ? [{ key: "vf-volumes", label: "Volumes VF", value: String(readingView.volumesVf) }] : []),
    
    // Chapitres
    ...(readingView.liveChapters > 0 ? [{ key: "source-chapters", label: "Chapitres", value: String(readingView.liveChapters) }] : []),
    
    // Autres
    ...(readingView.ageConseille ? [{ key: "age-conseille", label: "Âge conseillé", value: readingView.ageConseille }] : []),
  ];
  const [editDraft, setEditDraft] = useState<Record<string, string | number | boolean>>({});
  const syncDiffFields = useMemo(
    () => buildReadingSyncDiffFields({ dbRow: rawDbRow, livePayload: rawLiveJikan }),
    [rawDbRow, rawLiveJikan]
  );

  useEffect(() => {
    const db = rawDbRow ?? {};
    const rawMalSnapshot = ((db.mal_official_snapshot as Record<string, unknown> | undefined) ?? {});
    const manualOverrides = getManualOverrides(rawMalSnapshot);
    const manualLinks = ((manualOverrides.links as Record<string, unknown> | undefined) ?? {});
    setEditDraft({
      malId: String((rawDbRow?.mal_manga_id as number | undefined) ?? malId ?? ""),
      titleFr: String(manualOverrides.title_fr ?? ""),
      titleJapanese: readingView.titleJapanese,
      titleEnglish: readingView.titleEnglish,
      titleOriginal: readingView.titleOriginal || "",
      titleSynonyms: readingView.titleSynonyms.join(" | "),
      mediaType: readingView.mediaType,
      workStatus: readingView.workStatus,
      score: readingView.score,
      synopsisOriginal: readingView.synopsisOriginal,
      synopsisFr: String(manualOverrides.synopsis_fr ?? readingView.synopsis),
      imageUrl: readingView.imageUrl,
      sourceUrl: readingView.sourceUrl,
      linkNautiljon: String(manualLinks.nautiljon ?? ""),
      linkAnilist: String(manualLinks.anilist ?? ""),
      authors: readingView.authors.join(", "),
      scenarist: readingView.scenarist || "",
      dessinateur: readingView.dessinateur || "",
      traducteur: readingView.traducteur || "",
      serializations: readingView.serializations.join(", "),
      prepublie: readingView.prepublie || "",
      editeurVf: readingView.editeurVf || "",
      editeurVo: readingView.editeurVo || "",
      publishedString: readingView.publishedString,
      anneeVf: readingView.anneeVf || "",
      anneeVo: readingView.anneeVo || "",
      chapters: readingView.liveChapters,
      volumes: readingView.liveVolumes,
      volumesVf: readingView.volumesVf ?? 0,
      ageConseille: readingView.ageConseille || "",
      groupe: readingView.groupe || "",
      readStatus: userReadStatus,
      isFavorite: userFavorite,
    });
  }, [malId, rawDbRow, readingView, userReadStatus, userFavorite]);

  const editFields: LibraryEditField[] = [
    { key: "titleFr", label: "Titre VF", group: "Titres", type: "text", value: editDraft.titleFr ?? "" },
    { key: "titleEnglish", label: "Titre romanisé", group: "Titres", type: "text", value: editDraft.titleEnglish ?? "" },
    { key: "titleOriginal", label: "Titre original (japonais)", group: "Titres", type: "text", value: editDraft.titleOriginal ?? "" },
    { key: "titleSynonyms", label: "Titres alternatifs (séparateur |)", group: "Titres", type: "text", value: editDraft.titleSynonyms ?? "", span2: true },
    { key: "malId", label: "MAL ID (liaison)", group: "Titres", type: "text", value: editDraft.malId ?? "" },
    { key: "mediaType", label: "Type", group: "Métadonnées", type: "text", value: editDraft.mediaType ?? "" },
    {
      key: "workStatus",
      label: "Statut oeuvre",
      group: "Métadonnées",
      type: "select",
      value: String(editDraft.workStatus ?? ""),
      options: [
        { value: "Publishing", label: "Publishing" },
        { value: "Finished", label: "Finished" },
        { value: "On Hiatus", label: "On Hiatus" },
        { value: "Discontinued", label: "Discontinued" },
        { value: "Not yet published", label: "Not yet published" },
      ],
    },
    { key: "score", label: "Score", group: "Métadonnées", type: "number", value: Number(editDraft.score ?? 0), min: 0, step: 0.01 },
    {
      key: "readStatus",
      label: "Mon statut",
      group: "Suivi personnel",
      type: "select",
      value: String(editDraft.readStatus ?? "Planifié"),
      options: ["Planifié", "En cours", "En pause", "Terminé", "Abandonné"].map((value) => ({ value, label: value })),
    },
    { key: "isFavorite", label: "Favori", group: "Suivi personnel", type: "toggle", value: Boolean(editDraft.isFavorite ?? false) },
    { key: "imageUrl", label: "Image principale", group: "Liens", type: "text", value: editDraft.imageUrl ?? "", span2: true },
    { key: "sourceUrl", label: "Lien MAL", group: "Liens", type: "text", value: editDraft.sourceUrl ?? "", span2: true },
    { key: "linkNautiljon", label: "Lien Nautiljon", group: "Liens", type: "text", value: editDraft.linkNautiljon ?? "" },
    { key: "linkAnilist", label: "Lien AniList", group: "Liens", type: "text", value: editDraft.linkAnilist ?? "" },
    { key: "authors", label: "Auteurs (séparateur ,)", group: "Métadonnées", type: "text", value: editDraft.authors ?? "", span2: true },
    { key: "scenarist", label: "Scénariste", group: "Métadonnées", type: "text", value: editDraft.scenarist ?? "" },
    { key: "dessinateur", label: "Dessinateur", group: "Métadonnées", type: "text", value: editDraft.dessinateur ?? "" },
    { key: "traducteur", label: "Traducteur", group: "Métadonnées", type: "text", value: editDraft.traducteur ?? "" },
    { key: "serializations", label: "Magazines (séparateur ,)", group: "Métadonnées", type: "text", value: editDraft.serializations ?? "", span2: true },
    { key: "prepublie", label: "Prépublié dans", group: "Métadonnées", type: "text", value: editDraft.prepublie ?? "" },
    { key: "editeurVf", label: "Éditeur VF", group: "Métadonnées", type: "text", value: editDraft.editeurVf ?? "" },
    { key: "editeurVo", label: "Éditeur VO", group: "Métadonnées", type: "text", value: editDraft.editeurVo ?? "" },
    { key: "publishedString", label: "Publication", group: "Métadonnées", type: "text", value: editDraft.publishedString ?? "", span2: true },
    { key: "anneeVf", label: "Année VF", group: "Métadonnées", type: "text", value: editDraft.anneeVf ?? "" },
    { key: "anneeVo", label: "Année VO", group: "Métadonnées", type: "text", value: editDraft.anneeVo ?? "" },
    { key: "chapters", label: "Chapitres (source)", group: "Métadonnées", type: "number", value: Number(editDraft.chapters ?? 0), min: 0 },
    { key: "volumes", label: "Volumes VO", group: "Métadonnées", type: "number", value: Number(editDraft.volumes ?? 0), min: 0 },
    { key: "volumesVf", label: "Volumes VF", group: "Métadonnées", type: "number", value: Number(editDraft.volumesVf ?? 0), min: 0 },
    { key: "ageConseille", label: "Âge conseillé", group: "Métadonnées", type: "text", value: editDraft.ageConseille ?? "" },
    { key: "groupe", label: "Groupe / Franchise", group: "Métadonnées", type: "text", value: editDraft.groupe ?? "" },
    { key: "synopsisOriginal", label: "Synopsis source", group: "Synopsis", type: "textarea", value: editDraft.synopsisOriginal ?? "", rows: 5, span2: true },
    { key: "synopsisFr", label: "Synopsis FR", group: "Synopsis", type: "textarea", value: editDraft.synopsisFr ?? "", rows: 5, span2: true },
  ];

  async function openSyncDiffModal() {
    await loadReadingLivePayload().catch(() => undefined);
    const malSnapshot = ((rawDbRow as { mal_official_snapshot?: unknown } | null)?.mal_official_snapshot ?? null) as Record<string, unknown> | null;
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

  const loadReadingDbRow = useCallback(async () => {
    if (!malId && !anilistMediaIdRoute && !rowIdFromRoute) {
      return;
    }
    const supabase = getSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const userId = user?.id ?? "";
    if (!userId) {
      return;
    }
    let query = supabase.from("library_reading").select("*").eq("user_id", userId);
    if (malId != null) {
      query = query.eq("mal_manga_id", malId);
    } else if (anilistMediaIdRoute != null) {
      query = query.eq("anilist_media_id", anilistMediaIdRoute);
    } else if (rowIdFromRoute) {
      query = query.eq("id", rowIdFromRoute);
    }
    const { data } = await query.maybeSingle();
    if (!data) {
      return;
    }
    setRawDbRow(data as Record<string, unknown>);
    setReadingRowId((data as { id?: string }).id ?? null);
    const readStatus = (data as { read_status?: string | null }).read_status ?? null;
    setUserReadStatus(mapReadStatusToFr(readStatus));
    const rawJikanSnapshot = ((data as { jikan_snapshot?: unknown }).jikan_snapshot ?? {}) as Record<string, unknown>;
    const rawMalSnapshot = ((data as { mal_official_snapshot?: unknown }).mal_official_snapshot ?? {}) as Record<string, unknown>;
    const listEntry = (rawMalSnapshot.list_entry ?? {}) as Record<string, unknown>;
    const listStatus = (listEntry.list_status ?? rawMalSnapshot.my_list_status ?? {}) as Record<string, unknown>;
    const nextChaptersRead = Number(listStatus.num_chapters_read ?? listStatus.num_chapters_readed ?? 0);
    const nextVolumesRead = Number(listStatus.num_volumes_read ?? listStatus.num_volumes_readed ?? 0);
    setChaptersRead(Number.isFinite(nextChaptersRead) ? Math.max(0, nextChaptersRead) : 0);
    setVolumesRead(Number.isFinite(nextVolumesRead) ? Math.max(0, nextVolumesRead) : 0);
    setUserFavorite(Boolean(listStatus.is_favorite ?? false));
    const relatedReadingMalIds = new Set<number>();
    const relatedAnimeMalIds = new Set<number>();
    const relatedReadingAnilistIds = new Set<number>();
    const relatedAnimeAnilistIds = new Set<number>();
    const relatedIdOpts = {
      animeAnilistIds: relatedAnimeAnilistIds,
      readingAnilistIds: relatedReadingAnilistIds,
    };
    collectRelatedIdsFromSnapshots(rawJikanSnapshot, rawMalSnapshot, relatedAnimeMalIds, relatedReadingMalIds, relatedIdOpts);

    // Étend d'un niveau pour éviter les franchises incomplètes selon la fiche ouverte.
    if (relatedAnimeMalIds.size > 0 || relatedAnimeAnilistIds.size > 0) {
      const expandChunks: Array<{ jikan_snapshot?: unknown; mal_official_snapshot?: unknown }> = [];
      if (relatedAnimeMalIds.size > 0) {
        const { data: expandAnimeMal } = await supabase
          .from("library_anime")
          .select("jikan_snapshot, mal_official_snapshot")
          .eq("user_id", userId)
          .in("mal_id", Array.from(relatedAnimeMalIds));
        expandChunks.push(...(expandAnimeMal ?? []));
      }
      if (relatedAnimeAnilistIds.size > 0) {
        const { data: expandAnimeAni } = await supabase
          .from("library_anime")
          .select("jikan_snapshot, mal_official_snapshot")
          .eq("user_id", userId)
          .in("anilist_media_id", Array.from(relatedAnimeAnilistIds));
        expandChunks.push(...(expandAnimeAni ?? []));
      }
      expandChunks.forEach((row) => {
        collectRelatedIdsFromSnapshots(
          ((row as { jikan_snapshot?: unknown }).jikan_snapshot ?? {}) as Record<string, unknown>,
          ((row as { mal_official_snapshot?: unknown }).mal_official_snapshot ?? {}) as Record<string, unknown>,
          relatedAnimeMalIds,
          relatedReadingMalIds,
          relatedIdOpts
        );
      });
    }
    if (relatedReadingMalIds.size > 0 || relatedReadingAnilistIds.size > 0) {
      const expandChunks: Array<{ jikan_snapshot?: unknown; mal_official_snapshot?: unknown }> = [];
      if (relatedReadingMalIds.size > 0) {
        const { data: expandReadingMal } = await supabase
          .from("library_reading")
          .select("jikan_snapshot, mal_official_snapshot")
          .eq("user_id", userId)
          .in("mal_manga_id", Array.from(relatedReadingMalIds));
        expandChunks.push(...(expandReadingMal ?? []));
      }
      if (relatedReadingAnilistIds.size > 0) {
        const { data: expandReadingAni } = await supabase
          .from("library_reading")
          .select("jikan_snapshot, mal_official_snapshot")
          .eq("user_id", userId)
          .in("anilist_media_id", Array.from(relatedReadingAnilistIds));
        expandChunks.push(...(expandReadingAni ?? []));
      }
      expandChunks.forEach((row) => {
        collectRelatedIdsFromSnapshots(
          ((row as { jikan_snapshot?: unknown }).jikan_snapshot ?? {}) as Record<string, unknown>,
          ((row as { mal_official_snapshot?: unknown }).mal_official_snapshot ?? {}) as Record<string, unknown>,
          relatedAnimeMalIds,
          relatedReadingMalIds,
          relatedIdOpts
        );
      });
    }

    const nextEntries: FranchiseDbEntry[] = [];
    const readingFranchiseById = new Map<string, FranchiseDbEntry>();
    if (relatedReadingMalIds.size > 0 || relatedReadingAnilistIds.size > 0) {
      const readingChunks: Array<Record<string, unknown>> = [];
      if (relatedReadingMalIds.size > 0) {
        const { data: readingRowsMal } = await supabase
          .from("library_reading")
          .select(
            "id, mal_manga_id, anilist_media_id, title, main_picture_url, read_status, mal_official_snapshot, jikan_snapshot"
          )
          .eq("user_id", userId)
          .in("mal_manga_id", Array.from(relatedReadingMalIds));
        readingChunks.push(...((readingRowsMal ?? []) as Record<string, unknown>[]));
      }
      if (relatedReadingAnilistIds.size > 0) {
        const { data: readingRowsAni } = await supabase
          .from("library_reading")
          .select(
            "id, mal_manga_id, anilist_media_id, title, main_picture_url, read_status, mal_official_snapshot, jikan_snapshot"
          )
          .eq("user_id", userId)
          .in("anilist_media_id", Array.from(relatedReadingAnilistIds));
        readingChunks.push(...((readingRowsAni ?? []) as Record<string, unknown>[]));
      }
      readingChunks.forEach((row) => {
        const rowId = String(row.id ?? "");
        if (!rowId) {
          return;
        }
        const rowMalSnapshot = (row.mal_official_snapshot ?? {}) as Record<string, unknown>;
        const rowJikanSnapshot = (row.jikan_snapshot ?? {}) as Record<string, unknown>;
        const rowFullSnapshot = (rowJikanSnapshot.full ?? rowJikanSnapshot.data ?? {}) as Record<string, unknown>;
        const rowListEntry = (rowMalSnapshot.list_entry ?? {}) as Record<string, unknown>;
        const rowListStatus = (rowListEntry.list_status ?? {}) as Record<string, unknown>;
        const chaptersReadSnapshot = Number(rowListStatus.num_chapters_read ?? 0);
        const chaptersTotalSnapshot = Number(rowFullSnapshot.chapters ?? 0);
        const malMid = Number(row.mal_manga_id ?? 0);
        const aniMidRaw = row.anilist_media_id;
        const aniMid =
          aniMidRaw != null && Number.isFinite(Number(aniMidRaw)) && Number(aniMidRaw) > 0 ? Number(aniMidRaw) : null;
        readingFranchiseById.set(rowId, {
          media: "reading",
          rowId,
          malId: Number.isFinite(malMid) && malMid > 0 ? malMid : 0,
          anilistMediaId: aniMid,
          title: String(row.title ?? (malMid > 0 ? `Manga #${malMid}` : aniMid ? `AniList ${aniMid}` : "—")),
          status: mapReadStatusToFr((row.read_status as string | null) ?? null),
          progressLabel: `${Number.isFinite(chaptersReadSnapshot) ? chaptersReadSnapshot : 0}/${Number.isFinite(chaptersTotalSnapshot) ? chaptersTotalSnapshot : 0} ch.`,
          imageUrl: String(
            (row.main_picture_url as string | null | undefined) ??
              ((rowFullSnapshot.images as Record<string, unknown> | undefined)?.jpg as Record<string, unknown> | undefined)
                ?.large_image_url ??
              ((rowFullSnapshot.images as Record<string, unknown> | undefined)?.jpg as Record<string, unknown> | undefined)
                ?.image_url ??
              ""
          ),
        });
      });
      readingFranchiseById.forEach((v) => nextEntries.push(v));
    }
    if (relatedAnimeMalIds.size > 0 || relatedAnimeAnilistIds.size > 0) {
      const animeChunks: Array<Record<string, unknown>> = [];
      if (relatedAnimeMalIds.size > 0) {
        const { data: animeRowsMal } = await supabase
          .from("library_anime")
          .select("id, mal_id, anilist_media_id, title, main_picture_url, watch_status, mal_official_snapshot, jikan_snapshot")
          .eq("user_id", userId)
          .in("mal_id", Array.from(relatedAnimeMalIds));
        animeChunks.push(...((animeRowsMal ?? []) as Record<string, unknown>[]));
      }
      if (relatedAnimeAnilistIds.size > 0) {
        const { data: animeRowsAni } = await supabase
          .from("library_anime")
          .select("id, mal_id, anilist_media_id, title, main_picture_url, watch_status, mal_official_snapshot, jikan_snapshot")
          .eq("user_id", userId)
          .in("anilist_media_id", Array.from(relatedAnimeAnilistIds));
        animeChunks.push(...((animeRowsAni ?? []) as Record<string, unknown>[]));
      }
      const animeFranchiseById = new Map<string, FranchiseDbEntry>();
      animeChunks.forEach((row) => {
        const rowId = String(row.id ?? "");
        if (!rowId) {
          return;
        }
        const rowMalSnapshot = (row.mal_official_snapshot ?? {}) as Record<string, unknown>;
        const rowJikanSnapshot = (row.jikan_snapshot ?? {}) as Record<string, unknown>;
        const rowFullSnapshot = (rowJikanSnapshot.full ?? rowJikanSnapshot.data ?? {}) as Record<string, unknown>;
        const rowListEntry = (rowMalSnapshot.list_entry ?? {}) as Record<string, unknown>;
        const rowListStatus = (rowListEntry.list_status ?? {}) as Record<string, unknown>;
        const episodesSeenSnapshot = Number(rowListStatus.num_episodes_watched ?? 0);
        const episodesTotalSnapshot = Number(rowFullSnapshot.episodes ?? 0);
        const malAid = Number(row.mal_id ?? 0);
        const aniAidRaw = row.anilist_media_id;
        const aniAid =
          aniAidRaw != null && Number.isFinite(Number(aniAidRaw)) && Number(aniAidRaw) > 0 ? Number(aniAidRaw) : null;
        animeFranchiseById.set(rowId, {
          media: "anime",
          rowId,
          malId: Number.isFinite(malAid) && malAid > 0 ? malAid : 0,
          anilistMediaId: aniAid,
          title: String(row.title ?? (malAid > 0 ? `Anime #${malAid}` : aniAid ? `AniList ${aniAid}` : "—")),
          status: mapWatchStatusToFr((row.watch_status as string | null) ?? null),
          progressLabel: `${Number.isFinite(episodesSeenSnapshot) ? episodesSeenSnapshot : 0}/${Number.isFinite(episodesTotalSnapshot) ? episodesTotalSnapshot : 0} ép.`,
          imageUrl: String(
            (row.main_picture_url as string | null | undefined) ??
              ((rowFullSnapshot.images as Record<string, unknown> | undefined)?.jpg as Record<string, unknown> | undefined)
                ?.large_image_url ??
              ((rowFullSnapshot.images as Record<string, unknown> | undefined)?.jpg as Record<string, unknown> | undefined)
                ?.image_url ??
              ""
          ),
        });
      });
      animeFranchiseById.forEach((v) => nextEntries.push(v));
    }
    setFranchiseEntries(
      nextEntries.sort((a, b) => {
        if (a.media !== b.media) {
          return a.media === "reading" ? -1 : 1;
        }
        return a.title.localeCompare(b.title);
      })
    );
  }, [malId, anilistMediaIdRoute, rowIdFromRoute]);

  const loadReadingLivePayload = useCallback(async () => {
    if (!malId) {
      return;
    }
    const live = await fetchReadingFull(malId);
    if (!live.ok) {
      setRawLiveJikan(null);
      return;
    }
    setRawLiveJikan(live.data as unknown as Record<string, unknown>);
  }, [malId]);

  async function launchReadingSync(source: "mal" | "anilist") {
    setSyncLaunching(true);
    try {
      const allFieldIds = syncDiffFields.map((field) => field.id);
      const selectedIds = selectedDiffFieldIds;
      const lockedIds = allFieldIds.filter((id) => !selectedIds.includes(id));
      if (readingRowId && rawDbRow) {
        const supabase = getSupabaseClient();
        const baseMalSnapshot = ((rawDbRow as { mal_official_snapshot?: unknown }).mal_official_snapshot ?? {}) as Record<string, unknown>;
        const nextMalSnapshot = {
          ...baseMalSnapshot,
          manual_overrides: {
            ...((baseMalSnapshot.manual_overrides ?? {}) as Record<string, unknown>),
            locked_field_ids: lockedIds,
          },
        };
        await supabase
          .from("library_reading")
          .update({
            mal_official_snapshot: nextMalSnapshot,
            updated_at: new Date().toISOString(),
          })
          .eq("id", readingRowId);
        setRawDbRow((prev) => (prev ? { ...prev, mal_official_snapshot: nextMalSnapshot } : prev));
      }
      const targetMalId = Number(String(editDraft.malId ?? "").trim());
      await startReadingSync(source, {
        selectedFieldIds: selectedDiffFieldIds,
        targetMalId:
          Number.isFinite(targetMalId) && targetMalId > 0
            ? targetMalId
            : Number((rawDbRow as { mal_manga_id?: unknown } | null)?.mal_manga_id ?? malId ?? 0),
      });
      setIsSyncModalOpen(false);
      window.location.reload();
    } finally {
      setSyncLaunching(false);
    }
  }


  function openEditVolume(volumeNumber: number) {
    const existing = volumeByNumber.get(volumeNumber);
    setEditingVolume({
      volumeNumber,
      volumeType: existing?.volumeType ?? "standard",
      priceEuros: existing?.priceEuros ?? 0,
      imageUrl: existing?.imageUrl ?? "",
      releaseDateVf: existing?.releaseDateVf ?? "",
      purchaseDate: existing?.purchaseDate ?? "",
      ownerIds: existing?.owners.map((owner) => owner.userId) ?? [],
    });
    setIsVolumeModalOpen(true);
  }

  async function saveEditingVolume() {
    if (!editingVolume || !readingRowId) {
      return;
    }
    setVolumeSaving(true);
    try {
      const supabase = getSupabaseClient();
      const { data: authUser } = await supabase.auth.getUser();
      const existingVol = volumeByNumber.get(editingVolume.volumeNumber);
      let ownerIds = [...editingVolume.ownerIds];
      if (existingVol?.isOwned && ownerIds.length === 0 && authUser.user?.id) {
        ownerIds = [authUser.user.id];
      }
      const ownerCount = Math.max(1, ownerIds.length);
      const share = Number((editingVolume.priceEuros / ownerCount).toFixed(2));
      const resolvedFamilyId = familyId ?? volumeByNumber.get(editingVolume.volumeNumber)?.familyId ?? null;
      if (!volumeCatalogUpsertKeys) {
        throw new Error("Identifiant catalogue tomes manquant (MAL ou AniList).");
      }
      await upsertReadingVolume(supabase, {
        readingId: readingRowId,
        ...volumeCatalogUpsertKeys,
        familyId: resolvedFamilyId,
        volumeNumber: editingVolume.volumeNumber,
        volumeType: editingVolume.volumeType,
        imageUrl: editingVolume.imageUrl || null,
        releaseDateVf: editingVolume.releaseDateVf || null,
        purchaseDate: editingVolume.purchaseDate || null,
        priceEuros: editingVolume.priceEuros,
        isOwned: existingVol?.isOwned ?? false,
        isRead: existingVol?.isRead ?? false,
        isMihon: existingVol?.isMihon ?? false,
        owners: ownerIds.map((ownerId) => ({ userId: ownerId, shareEuros: share })),
      });
      const refreshed = await fetchReadingVolumes(supabase, readingRowId, {
        familyId: resolvedFamilyId,
        currentUserId: sessionUserId,
      });
      setVolumes(refreshed);
      const sourceNum = editingVolume.volumeNumber;
      const multiOwner = ownerIds.length >= 2;
      const candidateTargets = refreshed.filter(
        (v) => v.releaseDateVf && v.volumeNumber !== sourceNum
      );
      setIsVolumeModalOpen(false);
      setEditingVolume(null);
      notifyToast({ kind: "success", message: "Tome enregistré." });
      if (resolvedFamilyId && multiOwner && candidateTargets.length > 0) {
        setPropagateOwnersDraft({
          sourceVolumeNumber: sourceNum,
          ownerIds,
          volumesSnapshot: refreshed,
        });
        setPropagateOwnerTargetsSelected(new Set(candidateTargets.map((v) => v.volumeNumber)));
      }
    } catch (err) {
      notifyToast({
        kind: "error",
        message: err instanceof Error ? err.message : "Impossible d'enregistrer le tome.",
      });
    } finally {
      setVolumeSaving(false);
    }
  }

  async function applyPropagateOwners() {
    if (!propagateOwnersDraft || !readingRowId) {
      return;
    }
    setVolumeSaving(true);
    try {
      const supabase = getSupabaseClient();
      for (const volumeNumber of propagateOwnerTargetsSelected) {
        if (volumeNumber === propagateOwnersDraft.sourceVolumeNumber) {
          continue;
        }
        const vol = propagateOwnersDraft.volumesSnapshot.find((v) => v.volumeNumber === volumeNumber);
        if (!vol) {
          continue;
        }
        const ownerCount = Math.max(1, propagateOwnersDraft.ownerIds.length);
        const share = Number((vol.priceEuros / ownerCount).toFixed(2));
        const owners = propagateOwnersDraft.ownerIds.map((id) => ({ userId: id, shareEuros: share }));
        const resolvedFamilyId = familyId ?? vol.familyId ?? null;
        if (!volumeCatalogUpsertKeys) {
          throw new Error("Identifiant catalogue tomes manquant (MAL ou AniList).");
        }
        await upsertReadingVolume(supabase, {
          readingId: readingRowId,
          ...volumeCatalogUpsertKeys,
          familyId: resolvedFamilyId,
          volumeNumber: vol.volumeNumber,
          volumeType: vol.volumeType,
          imageUrl: vol.imageUrl,
          releaseDateVf: vol.releaseDateVf,
          purchaseDate: vol.purchaseDate,
          priceEuros: vol.priceEuros,
          isOwned: owners.length > 0,
          isRead: vol.isRead,
          isMihon: vol.isMihon,
          owners,
        });
      }
      const refreshed = await fetchReadingVolumes(supabase, readingRowId, {
        familyId: familyId ?? null,
        currentUserId: sessionUserId,
      });
      setVolumes(refreshed);
      setPropagateOwnersDraft(null);
      setPropagateOwnerTargetsSelected(new Set());
      notifyToast({ kind: "success", message: "Propriétaires appliqués aux tomes sélectionnés." });
    } catch (err) {
      notifyToast({
        kind: "error",
        message:
          err instanceof Error ? err.message : "Impossible de propager les propriétaires.",
      });
    } finally {
      setVolumeSaving(false);
    }
  }

  function closePropagateOwnersModal() {
    setPropagateOwnersDraft(null);
    setPropagateOwnerTargetsSelected(new Set());
  }

  async function markAllVolumesAs(field: "isRead" | "isOwned") {
    if (!readingRowId || !rawDbRow) {
      return;
    }
    const previousVolumes = volumes;
    const previousVolumesRead = volumesRead;
    const optimistic = volumes.map((volume) => ({ ...volume, [field]: true }));
    setVolumes(optimistic);
    
    // Si on marque tout comme lu, mettre à jour aussi le compteur volumesRead
    // Utiliser le nombre effectif de volumes (VF si disponible, sinon VO)
    if (field === "isRead") {
      setVolumesRead(effectiveVolumesTotal);
    }
    
    try {
      const supabase = getSupabaseClient();
      
      // Récupérer l'utilisateur actuel pour "Marquer tout comme possédé"
      let currentUserId: string | undefined;
      if (field === "isOwned") {
        const { data: { user } } = await supabase.auth.getUser();
        currentUserId = user?.id;
      }
      
      for (const volume of volumesWithReleaseDate) {
        let nextOwners = volume.owners;
        
        // Si on marque comme possédé, ajouter l'utilisateur actuel aux propriétaires
        if (field === "isOwned" && currentUserId) {
          const uid = normalizeOwnerUserId(currentUserId);
          const ownerIds = new Set(volume.owners.map((o) => normalizeOwnerUserId(o.userId)));
          if (!ownerIds.has(uid)) {
            ownerIds.add(uid);
          }
          // Recalculer les parts de prix
          const ownerCount = Math.max(1, ownerIds.size);
          const share = Number((volume.priceEuros / ownerCount).toFixed(2));
          nextOwners = Array.from(ownerIds).map(ownerId => ({
            userId: ownerId,
            shareEuros: share,
          }));
        }
        
        const resolvedFamilyId = familyId ?? volume.familyId ?? null;
        if (!volumeCatalogUpsertKeys) {
          throw new Error("Identifiant catalogue tomes manquant (MAL ou AniList).");
        }
        await upsertReadingVolume(supabase, {
          readingId: volume.readingId,
          ...volumeCatalogUpsertKeys,
          familyId: resolvedFamilyId,
          volumeNumber: volume.volumeNumber,
          volumeType: volume.volumeType,
          imageUrl: volume.imageUrl,
          releaseDateVf: volume.releaseDateVf,
          purchaseDate: volume.purchaseDate,
          priceEuros: volume.priceEuros,
          isOwned: field === "isOwned" ? true : volume.isOwned,
          isRead: field === "isRead" ? true : volume.isRead,
          isMihon: volume.isMihon,
          owners: nextOwners,
        });
      }
      
      // Mettre à jour le snapshot MAL si on marque tout comme lu
      if (field === "isRead") {
        const baseSnapshot = ((rawDbRow as { mal_official_snapshot?: unknown }).mal_official_snapshot ?? {}) as Record<string, unknown>;
        const listEntry = ((baseSnapshot.list_entry ?? {}) as Record<string, unknown>);
        const listStatus = ((listEntry.list_status ?? {}) as Record<string, unknown>);
        const updatedSnapshot = {
          ...baseSnapshot,
          list_entry: {
            ...listEntry,
            list_status: {
              ...listStatus,
              num_volumes_read: effectiveVolumesTotal,
            },
          },
        };
        const { error } = await supabase
          .from("library_reading")
          .update({
            mal_official_snapshot: updatedSnapshot,
            updated_at: new Date().toISOString(),
          })
          .eq("id", readingRowId);
        if (error) {
          throw new Error(error.message);
        }
        setRawDbRow((prev) => (prev ? { ...prev, mal_official_snapshot: updatedSnapshot } : prev));
      }
      
      const refreshed = await fetchReadingVolumes(supabase, readingRowId, {
        familyId: familyId ?? null,
        currentUserId: sessionUserId,
      });
      setVolumes(refreshed);
      notifyToast({ kind: "success", message: `Tous les tomes marqués comme ${field === "isRead" ? "lus" : "possédés"}.` });
    } catch {
      setVolumes(previousVolumes);
      setVolumesRead(previousVolumesRead);
      notifyToast({ kind: "error", message: "Impossible de mettre à jour les tomes." });
    }
  }

  async function updateVolumeFlags(volumeNumber: number, patch: Partial<Pick<ReadingVolumeRow, "isOwned" | "isRead" | "isMihon">>) {
    if (!readingRowId) {
      return;
    }
    const current = volumeByNumber.get(volumeNumber);
    if (!current) {
      return;
    }
    const previousVolumes = volumes;
    const optimistic = previousVolumes.map((volume) =>
      volume.volumeNumber === volumeNumber ? { ...volume, ...patch } : volume
    );
    setVolumes(optimistic);
    try {
      const supabase = getSupabaseClient();
      
      // Gérer les propriétaires en fonction du toggle "Possédé"
      let nextOwners = current.owners;
      if (patch.isOwned !== undefined) {
        const { data: { user } } = await supabase.auth.getUser();
        const currentUserId = user?.id;
        
        if (currentUserId) {
          const uid = normalizeOwnerUserId(currentUserId);
          const ownerIds = new Set(current.owners.map((o) => normalizeOwnerUserId(o.userId)));

          if (patch.isOwned && !ownerIds.has(uid)) {
            // Ajouter l'utilisateur actuel comme propriétaire
            ownerIds.add(uid);
          } else if (!patch.isOwned && ownerIds.has(uid)) {
            // Retirer l'utilisateur actuel des propriétaires
            ownerIds.delete(uid);
          }
          
          // Recalculer les parts de prix
          const ownerCount = Math.max(1, ownerIds.size);
          const share = Number((current.priceEuros / ownerCount).toFixed(2));
          nextOwners = Array.from(ownerIds).map(ownerId => ({
            userId: ownerId,
            shareEuros: share,
          }));
        }
      }
      
      const resolvedFamilyId = familyId ?? current.familyId ?? null;
      if (!volumeCatalogUpsertKeys) {
        throw new Error("Identifiant catalogue tomes manquant (MAL ou AniList).");
      }
      await upsertReadingVolume(supabase, {
        readingId: current.readingId,
        ...volumeCatalogUpsertKeys,
        familyId: resolvedFamilyId,
        volumeNumber: current.volumeNumber,
        volumeType: current.volumeType,
        imageUrl: current.imageUrl,
        releaseDateVf: current.releaseDateVf,
        purchaseDate: current.purchaseDate,
        priceEuros: current.priceEuros,
        isOwned: patch.isOwned ?? current.isOwned,
        isRead: patch.isRead ?? current.isRead,
        isMihon: patch.isMihon ?? current.isMihon,
        owners: nextOwners,
      });
      const refreshed = await fetchReadingVolumes(supabase, readingRowId, {
        familyId: resolvedFamilyId,
        currentUserId: sessionUserId,
      });
      setVolumes(refreshed);
    } catch (err) {
      setVolumes(previousVolumes);
      notifyToast({
        kind: "error",
        message: err instanceof Error ? err.message : "Impossible de mettre à jour le tome.",
      });
    }
  }

  useEffect(() => {
    localStorage.setItem("reading-detail:collapse:chapters", collapseChapters ? "1" : "0");
  }, [collapseChapters]);
  useEffect(() => {
    localStorage.setItem("reading-detail:collapse:volumes", collapseVolumes ? "1" : "0");
  }, [collapseVolumes]);

  useEffect(() => {
    if (!malId && !anilistMediaIdRoute && !rowIdFromRoute) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        await loadReadingDbRow();
        if (cancelled) {
          return;
        }
      } catch {
        // Ignore silencieusement.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadReadingDbRow, malId, anilistMediaIdRoute, rowIdFromRoute]);

  useEffect(() => {
    if (readingView.liveChapters > 0) {
      setChaptersTotal(readingView.liveChapters);
    }
  }, [readingView.liveChapters]);

  useEffect(() => {
    (async () => {
      try {
        await loadReadingLivePayload();
      } catch {
        // Ignore silencieusement : indisponibilité réseau temporaire.
      }
    })();
  }, [loadReadingLivePayload]);

  useEffect(() => {
    if (!malId) {
      setGalleryImages([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const res = await fetchReadingPictures(malId);
      if (!res.ok) {
        if (!cancelled) {
          setGalleryImages([]);
        }
        return;
      }
      const images = (res.data.data ?? [])
        .map((item) => item.jpg.large_image_url || item.jpg.image_url || "")
        .filter((src) => src.length > 0);
      if (!cancelled) {
        setGalleryImages(Array.from(new Set(images)));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [malId]);

  useEffect(() => {
    if (!activeReadingRun || activeReadingRun.status === "queued" || activeReadingRun.status === "running") {
      return;
    }
    void loadReadingDbRow().catch(() => undefined);
    void loadReadingLivePayload().catch(() => undefined);
  }, [activeReadingRun, loadReadingDbRow, loadReadingLivePayload]);

  useEffect(() => {
    let cancelled = false;
    void getSupabaseClient()
      .auth.getUser()
      .then(({ data }) => {
        if (!cancelled) {
          setSessionUserId(data.user?.id ?? null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = getSupabaseClient();
      const families = await listMyFamilies(supabase);
      const firstFamilyId = families[0]?.id ?? null;
      if (!cancelled) {
        setFamilyId(firstFamilyId);
      }
      if (firstFamilyId) {
        const members = await listFamilyMembersWithRole(supabase, firstFamilyId);
        if (!cancelled) {
          setFamilyMembers(members);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!readingRowId) {
      setVolumes([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const supabase = getSupabaseClient();
      const rows = await fetchReadingVolumes(supabase, readingRowId, {
        familyId: familyId ?? null,
        currentUserId: sessionUserId,
      });
      if (!cancelled) {
        setVolumes(rows);
      }
    })().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [readingRowId, familyId, sessionUserId]);

  async function updateReadingStatus(next: string) {
    const previous = userReadStatus;
    setUserReadStatus(next);
    if (!readingRowId) {
      return;
    }
    setStatusSaving(true);
    try {
      const supabase = getSupabaseClient();
      const { error } = await supabase
        .from("library_reading")
        .update({ read_status: mapReadStatusToDb(next), updated_at: new Date().toISOString() })
        .eq("id", readingRowId);
      if (error) {
        throw new Error(error.message);
      }
    } catch {
      setUserReadStatus(previous);
    } finally {
      setStatusSaving(false);
    }
  }

  async function updateReadingFavorite(next: boolean) {
    const previous = userFavorite;
    setUserFavorite(next);
    if (!readingRowId || !rawDbRow) {
      return;
    }
    setStatusSaving(true);
    try {
      const supabase = getSupabaseClient();
      const baseSnapshot = ((rawDbRow as { mal_official_snapshot?: unknown }).mal_official_snapshot ?? {}) as Record<string, unknown>;
      const listEntry = ((baseSnapshot.list_entry ?? {}) as Record<string, unknown>);
      const listStatus = ((listEntry.list_status ?? {}) as Record<string, unknown>);
      const updatedSnapshot = {
        ...baseSnapshot,
        list_entry: {
          ...listEntry,
          list_status: {
            ...listStatus,
            is_favorite: next,
          },
        },
      };
      const { error } = await supabase
        .from("library_reading")
        .update({
          mal_official_snapshot: updatedSnapshot,
          updated_at: new Date().toISOString(),
        })
        .eq("id", readingRowId);
      if (error) {
        throw new Error(error.message);
      }
      setRawDbRow((prev) => (prev ? { ...prev, mal_official_snapshot: updatedSnapshot } : prev));
    } catch {
      setUserFavorite(previous);
    } finally {
      setStatusSaving(false);
    }
  }

  async function updateReadingProgress(next: { chaptersRead?: number; volumesRead?: number }) {
    const previousChapters = chaptersRead;
    const previousVolumes = volumesRead;
    const safeChapters = Math.max(0, Math.min(chaptersTotal, Number(next.chaptersRead ?? chaptersRead)));
    const safeVolumes = Math.max(0, Math.min(effectiveVolumesTotal || Number.MAX_SAFE_INTEGER, Number(next.volumesRead ?? volumesRead)));
    setChaptersRead(safeChapters);
    setVolumesRead(safeVolumes);
    if (!readingRowId || !rawDbRow) {
      return;
    }
    setProgressSaving(true);
    try {
      const supabase = getSupabaseClient();
      const baseSnapshot = ((rawDbRow as { mal_official_snapshot?: unknown }).mal_official_snapshot ?? {}) as Record<string, unknown>;
      const listEntry = ((baseSnapshot.list_entry ?? {}) as Record<string, unknown>);
      const listStatus = ((listEntry.list_status ?? {}) as Record<string, unknown>);
      const updatedSnapshot = {
        ...baseSnapshot,
        list_entry: {
          ...listEntry,
          list_status: {
            ...listStatus,
            num_chapters_read: safeChapters,
            num_volumes_read: safeVolumes,
          },
        },
      };
      const { error } = await supabase
        .from("library_reading")
        .update({
          mal_official_snapshot: updatedSnapshot,
          updated_at: new Date().toISOString(),
        })
        .eq("id", readingRowId);
      if (error) {
        throw new Error(error.message);
      }
      setRawDbRow((prev) => (prev ? { ...prev, mal_official_snapshot: updatedSnapshot } : prev));
    } catch {
      setChaptersRead(previousChapters);
      setVolumesRead(previousVolumes);
    } finally {
      setProgressSaving(false);
    }
  }

  async function saveEditedReadingEntry() {
    if (!readingRowId || !rawDbRow || editSaving) {
      return;
    }
    setEditSaving(true);
    try {
      const supabase = getSupabaseClient();
      const baseJikanSnapshot = ((rawDbRow as { jikan_snapshot?: unknown }).jikan_snapshot ?? {}) as Record<string, unknown>;
      const baseMalSnapshot = ((rawDbRow as { mal_official_snapshot?: unknown }).mal_official_snapshot ?? {}) as Record<string, unknown>;
      const full = ((baseJikanSnapshot.full ?? rawLiveJikan?.data ?? rawLiveJikan ?? {}) as Record<string, unknown>);
      const parsedMalId = Number(String(editDraft.malId ?? "").trim());
      const nextMalId =
        Number.isFinite(parsedMalId) && parsedMalId > 0
          ? Math.floor(parsedMalId)
          : Number((rawDbRow as { mal_manga_id?: unknown }).mal_manga_id ?? malId ?? 0);
      const nextFull = {
        ...full,
        mal_id: nextMalId,
        title: String(full.title ?? ""),
        title_japanese: String(editDraft.titleJapanese ?? ""),
        title_english: String(editDraft.titleEnglish ?? ""),
        title_synonyms: String(editDraft.titleSynonyms ?? "")
          .split("|")
          .map((value) => value.trim())
          .filter(Boolean),
        type: String(editDraft.mediaType ?? ""),
        status: String(editDraft.workStatus ?? ""),
        score: Number(editDraft.score ?? 0),
        synopsis: String(editDraft.synopsisOriginal ?? ""),
        url: String(editDraft.sourceUrl ?? ""),
        chapters: Number(editDraft.chapters ?? 0),
        volumes: Number(editDraft.volumes ?? 0),
        published: {
          ...((full.published ?? {}) as Record<string, unknown>),
          string: String(editDraft.publishedString ?? ""),
        },
        authors: String(editDraft.authors ?? "")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
          .map((name) => ({ name })),
        serializations: String(editDraft.serializations ?? "")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
          .map((name) => ({ name })),
        images: {
          ...((full.images ?? {}) as Record<string, unknown>),
          jpg: {
            ...((((full.images as Record<string, unknown> | undefined)?.jpg as Record<string, unknown> | undefined) ?? {})),
            large_image_url: String(editDraft.imageUrl ?? ""),
            image_url: String(editDraft.imageUrl ?? ""),
          },
        },
      };
      const nextMalSnapshot = {
        ...baseMalSnapshot,
        list_entry: {
          ...(((baseMalSnapshot.list_entry ?? {}) as Record<string, unknown>)),
          list_status: {
            ...((((baseMalSnapshot.list_entry as Record<string, unknown> | undefined)?.list_status as Record<string, unknown> | undefined) ?? {})),
            status: mapReadStatusToDb(String(editDraft.readStatus ?? "Planifié")),
            is_favorite: Boolean(editDraft.isFavorite ?? false),
          },
        },
        manual_overrides: {
          ...(((baseMalSnapshot.manual_overrides ?? {}) as Record<string, unknown>)),
          title_fr: String(editDraft.titleFr ?? ""),
          titre_original: String(editDraft.titleOriginal ?? ""),
          synopsis_fr: String(editDraft.synopsisFr ?? ""),
          volumes_vf: Number(editDraft.volumesVf ?? 0) > 0 ? Number(editDraft.volumesVf) : null,
          editeur_vf: String(editDraft.editeurVf ?? ""),
          editeur_vo: String(editDraft.editeurVo ?? ""),
          annee_vf: String(editDraft.anneeVf ?? ""),
          annee_vo: String(editDraft.anneeVo ?? ""),
          traducteur: String(editDraft.traducteur ?? ""),
          scenarist: String(editDraft.scenarist ?? ""),
          dessinateur: String(editDraft.dessinateur ?? ""),
          age_conseille: String(editDraft.ageConseille ?? ""),
          groupe: String(editDraft.groupe ?? ""),
          prepublie: String(editDraft.prepublie ?? ""),
          links: {
            ...((((baseMalSnapshot.manual_overrides as Record<string, unknown> | undefined)?.links as Record<string, unknown> | undefined) ?? {})),
            mal: String(editDraft.sourceUrl ?? ""),
            nautiljon: String(editDraft.linkNautiljon ?? ""),
            anilist: String(editDraft.linkAnilist ?? ""),
          },
          locked_field_ids: ["title", "status", "score", "chapters", "volumes", "synopsis"],
        },
      };
      const { error } = await supabase
        .from("library_reading")
        .update({
          mal_manga_id: nextMalId,
          title: String((rawDbRow as { title?: unknown } | null)?.title ?? full.title ?? ""),
          read_status: mapReadStatusToDb(String(editDraft.readStatus ?? "Planifié")),
          main_picture_url: String(editDraft.imageUrl ?? ""),
          jikan_snapshot: { ...baseJikanSnapshot, full: nextFull },
          mal_official_snapshot: nextMalSnapshot,
          updated_at: new Date().toISOString(),
        })
        .eq("id", readingRowId);
      if (error) {
        throw new Error(error.message);
      }
      setUserFavorite(Boolean(editDraft.isFavorite ?? false));
      notifyToast({ kind: "success", message: "Fiche lecture enregistrée en base." });
      setIsEditModalOpen(false);
      if (nextMalId !== Number((rawDbRow as { mal_manga_id?: unknown }).mal_manga_id ?? malId ?? 0)) {
        navigate(`/lectures/${nextMalId}`, { state: backState });
      } else {
        window.location.reload();
      }
    } catch (error) {
      notifyToast({
        kind: "error",
        message: error instanceof Error ? error.message : "Impossible d'enregistrer la fiche lecture.",
      });
    } finally {
      setEditSaving(false);
    }
  }

  async function translateReadingSynopsisToFrench() {
    const sourceSynopsis = String(editDraft.synopsisOriginal ?? "").trim();
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
      setEditDraft((prev) => ({ ...prev, synopsisFr: translated }));
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

  function openDeleteReadingModal() {
    if (!readingRowId || deleting) {
      return;
    }
    setDeleteModalOpen(true);
  }

  async function confirmDeleteReading(opts: { removeMal: boolean; removeAnilist: boolean }) {
    if (!readingRowId || deleting) {
      return;
    }
    setDeleting(true);
    try {
      const supabase = getSupabaseClient();
      if (opts.removeMal && malIdForRemote) {
        const r = await removeFromExternalList(supabase, {
          provider: "mal",
          malMediaId: malIdForRemote,
          catalog: "manga",
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
          catalog: "manga",
        });
        if (!r.ok) {
          notifyToast({ kind: "error", message: r.error });
          return;
        }
      }
      await deleteReadingEntry(supabase, readingRowId);
      notifyToast({ kind: "success", message: "Fiche supprimée." });
      setDeleteModalOpen(false);
      navigate("/lectures", { state: backState });
    } catch (error) {
      notifyToast({
        kind: "error",
        message: error instanceof Error ? error.message : "Suppression impossible.",
      });
    } finally {
      setDeleting(false);
    }
  }

  async function downloadCoverImage() {
    if (!readingView.imageUrl) {
      notifyToast({ kind: "info", message: "Aucune image à télécharger." });
      return;
    }
    const result = await downloadImageToDownloads(
      readingView.imageUrl,
      `${(readingView.title || "lecture").trim()}-cover`
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
      `${(readingView.title || "lecture").trim()}-galerie-${index + 1}`
    );
    if (result.ok) {
      notifyToast({ kind: "success", message: `Image téléchargée: ${result.path}` });
      return;
    }
    notifyToast({ kind: "error", message: result.error });
  }

  async function downloadVolumeImage(imageUrl: string, volumeNumber: number) {
    const result = await downloadImageToDownloads(
      imageUrl,
      `${(readingView.title || "lecture").trim()}-tome-${volumeNumber}`
    );
    if (result.ok) {
      notifyToast({ kind: "success", message: `Image téléchargée: ${result.path}` });
      return;
    }
    notifyToast({ kind: "error", message: result.error });
  }

  async function exportDebugPayload() {
    if (!readingRowId || !malId || exportingDebugJson) {
      return;
    }
    setExportingDebugJson(true);
    try {
      const supabase = getSupabaseClient();
      const { data: authData } = await supabase.auth.getUser();
      const userId = authData.user?.id ?? null;
      const [
        readingById,
        readingByMal,
        catalogRows,
        stateRows,
        mihonRows,
        publicRows,
      ] = await Promise.all([
        supabase.from("library_reading").select("*").eq("id", readingRowId).maybeSingle(),
        supabase.from("library_reading").select("*").eq("mal_manga_id", malId),
        supabase
          .from("library_manga_volume_catalog")
          .select("*")
          .eq("mal_manga_id", malId)
          .order("volume_number", { ascending: true }),
        supabase.from("user_manga_volume_state").select("*").eq("reading_id", readingRowId),
        supabase
          .from("reading_mihon_presence")
          .select("*")
          .eq("reading_id", readingRowId),
        supabase.from("library_reading_public").select("*").eq("mal_manga_id", malId),
      ]);
      const catalogIds = (catalogRows.data ?? [])
        .map((c) => String((c as { id?: unknown }).id ?? "").trim())
        .filter(Boolean);
      const ownersRows =
        familyId && catalogIds.length > 0
          ? await supabase
              .from("family_manga_volume_owner")
              .select("family_id, catalog_volume_id, user_id, share_euros, created_at, updated_at")
              .eq("family_id", familyId)
              .in("catalog_volume_id", catalogIds)
          : { data: [], error: null };

      const payload = {
        exported_at: new Date().toISOString(),
        app: "Nexus-Tauri",
        entity: {
          media: "reading",
          mal_id: malId,
          reading_row_id: readingRowId,
        },
        context: {
          user_id: userId,
          url_path: window.location.pathname,
          debug_mode_enabled: isDebugModeEnabled(),
        },
        local_state: {
          raw_db_row: rawDbRow,
          raw_live_jikan: rawLiveJikan,
          reading_view: readingView,
          chapters_read: chaptersRead,
          chapters_total: chaptersTotal,
          volumes_read: volumesRead,
          volumes_loaded: volumes,
          family_members: familyMembers,
          franchise_entries: franchiseEntries,
        },
        supabase: {
          reading_by_id: readingById.data ?? null,
          reading_by_mal_all_rows: readingByMal.data ?? [],
          library_manga_volume_catalog: catalogRows.data ?? [],
          user_manga_volume_state: stateRows.data ?? [],
          family_manga_volume_owner: ownersRows.data ?? [],
          reading_mihon_presence: mihonRows.data ?? [],
          reading_public_rows: publicRows.data ?? [],
          errors: {
            reading_by_id: readingById.error?.message ?? null,
            reading_by_mal: readingByMal.error?.message ?? null,
            library_manga_volume_catalog: catalogRows.error?.message ?? null,
            user_manga_volume_state: stateRows.error?.message ?? null,
            family_manga_volume_owner: ownersRows.error?.message ?? null,
            reading_mihon_presence: mihonRows.error?.message ?? null,
            reading_public_rows: publicRows.error?.message ?? null,
          },
        },
      };

      const safeTitle = String(readingView.title || `reading-${malId}`)
        .toLowerCase()
        .replace(/[^a-z0-9-_]+/g, "-")
        .slice(0, 60);
      downloadJsonFile(`debug-reading-${malId}-${safeTitle}.json`, payload);
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
    <div className="library-page anime-detail-page reading-detail-page">
      <LibraryDetailStickyHeader
        backTo="/lectures"
        backLabel="← Retour à la collection lectures"
        backState={backState}
        onSync={() => void openSyncDiffModal()}
        onEdit={() => setIsEditModalOpen(true)}
        onRefresh={() => window.location.reload()}
        onExportJson={
          isDebugModeEnabled() ? () => void exportDebugPayload() : undefined
        }
        exportBusy={exportingDebugJson}
        onDelete={() => openDeleteReadingModal()}
        deleting={deleting}
      />
      <LibraryEditEntryModal
        open={isEditModalOpen}
        title="Modifier la fiche lecture"
        fields={editFields}
        saving={editSaving}
        translateLabel={translatingSynopsis ? "Traduction..." : "Traduire"}
        onTranslate={() => void translateReadingSynopsisToFrench()}
        translateDisabled={translatingSynopsis}
        onChange={(key, value) => setEditDraft((prev) => ({ ...prev, [key]: value }))}
        helpTitle="Aide au remplissage"
        helpLines={[
          "Statut oeuvre doit rester dans les valeurs MAL officielles.",
          "Liens: utiliser des URLs complètes (https://...).",
          "Synopsis source = texte brut d'origine ; Synopsis FR = adaptation/traduction.",
          "Champs numériques attendent une valeur entière positive ou 0.",
        ]}
        onClose={() => setIsEditModalOpen(false)}
        onSave={() => void saveEditedReadingEntry()}
      />

      {!malId && !anilistMediaIdRoute && !rowIdFromRoute ? (
        <p className="library-page-lead">Identifiant d’URL invalide (MAL, AniList ou id de fiche attendu).</p>
      ) : null}

      <section className="anime-detail-section reading-overview-layout">
        <aside className="reading-overview-left">
          {readingView.imageUrl ? (
            <div className="library-downloadable-image is-main-cover">
              <img
                className="anime-detail-poster anime-detail-poster-legacy"
                src={proxyNautiljonImage(readingView.imageUrl)}
                alt=""
                width={260}
                height={390}
              />
              <button
                type="button"
                className="library-download-image-btn"
                onClick={() => void downloadCoverImage()}
                title="Télécharger l'image"
              >
                💾
              </button>
            </div>
          ) : (
            <div className="anime-detail-poster anime-detail-poster-legacy anime-detail-relation-thumb-placeholder" aria-hidden>
              <ImageOff size={36} />
            </div>
          )}

          <LibraryReferenceLinksSection
            links={[
              ...(readingView.sourceUrl ? [{ key: "mal", label: "MyAnimeList", href: readingView.sourceUrl }] : []),
              ...readingView.externalLinks
                .filter((link) => /nautiljon/i.test(link.name) || /anilist/i.test(link.name))
                .map((link) => ({ key: `${link.name}-${link.url}`, label: link.name, href: link.url })),
            ]}
          />

          <LibraryPersonalProgressSection
            status={userReadStatus as "Planifié" | "En cours" | "En pause" | "Terminé" | "Abandonné"}
            onStatusChange={(next) => void updateReadingStatus(next)}
            statusDisabled={statusSaving}
            favorite={userFavorite}
            onToggleFavorite={() => void updateReadingFavorite(!userFavorite)}
            favoriteDisabled={statusSaving}
            progressItems={[
              {
                id: "chapters",
                label: "Chapitres",
                current: chaptersRead,
                total: chaptersTotal,
                percent: chapterProgress,
              },
              {
                id: "volumes",
                label: "Tomes",
                current: actualVolumesRead,
                total: effectiveVolumesTotal,
                percent: volumeProgress,
              },
            ]}
          />

          <div className="anime-detail-subsection reading-costs-simple">
            <h3>💰 Coûts par propriétaire</h3>
            <p>Coût total : {totalCost.toFixed(2)}€</p>
            {costByOwner.length === 0 ? (
              <p className="anime-detail-prose">Aucune dépense partagée n’est encore configurée pour cette oeuvre.</p>
            ) : (
              costByOwner.map((owner) => (
                <div key={owner.userId} className="reading-costs-simple-row">
                  <ProfileAvatarImage
                    storagePath={owner.avatarPath}
                    displayName={owner.name}
                    size={30}
                  />
                  <div className="reading-costs-simple-info">
                    <p style={{ margin: 0 }}>
                      {owner.name} ({owner.volumesCount} tomes)
                    </p>
                    <strong>{owner.amount.toFixed(2)}€</strong>
                  </div>
                </div>
              ))
            )}
          </div>
        </aside>

        <div className="reading-overview-right">
          <LibraryMainMetaHeader
            title={readingView.title}
            titleTag="h1"
            subtitles={[
              readingView.titleEnglish || "",
              readingView.titleJapanese || "",
              ...dedupedAltTitles,
            ]}
            chips={[
              ...(readingView.workStatus && readingView.workStatus !== "—"
                ? [{ key: "work-status", label: readingView.workStatus, toneClass: getWorkStatusColor(readingView.workStatus) }]
                : []),
              { key: "media-type", label: readingView.mediaType || "Manga", toneClass: "anime-detail-chip-violet" },
              ...dedupedBadges.demographics.map((demo) => ({
                key: `demo-${demo}`,
                label: demo,
                toneClass: "anime-detail-chip-violet",
              })),
              ...(readingView.score > 0
                ? [{ key: "score", label: `★ ${readingView.score} (MAL)`, toneClass: "anime-detail-chip-gold" }]
                : []),
            ]}
          />
          <LibraryBadgeGroup
            small
            items={[
              ...dedupedBadges.genres.map((genre) => ({
                key: `genre-${genre}`,
                label: genre,
                toneClass: "anime-detail-chip-teal",
              })),
              ...dedupedBadges.themes.map((theme) => ({
                key: `theme-${theme}`,
                label: theme,
                toneClass: "anime-detail-chip-teal",
              })),
            ]}
          />
          <LibrarySynopsisSection synopsis={readingView.synopsis} />
          <LibraryGeneralInfoGrid items={generalInfoItems} />
          <LibraryFranchiseSection
            items={franchiseEntries
              .filter((entry) => {
                if (entry.media !== "reading") {
                  return true;
                }
                const malHit =
                  effectiveMalMangaId != null &&
                  entry.malId > 0 &&
                  entry.malId === effectiveMalMangaId;
                const aniHit =
                  anilistMediaIdRoute != null &&
                  entry.anilistMediaId != null &&
                  entry.anilistMediaId > 0 &&
                  entry.anilistMediaId === anilistMediaIdRoute;
                const rowHit = readingRowId != null && entry.rowId === readingRowId;
                return !(malHit || aniHit || rowHit);
              })
              .map((entry) => {
                const base = {
                  key: `${entry.media}-${entry.rowId}`,
                  title: entry.title,
                  meta: `${entry.media === "anime" ? "Adaptation animé" : "Lecture"} • ${entry.status} • ${entry.progressLabel}`,
                  isCurrent:
                    entry.media === "reading" &&
                    ((effectiveMalMangaId != null &&
                      entry.malId > 0 &&
                      entry.malId === effectiveMalMangaId) ||
                      (anilistMediaIdRoute != null &&
                        entry.anilistMediaId != null &&
                        entry.anilistMediaId > 0 &&
                        entry.anilistMediaId === anilistMediaIdRoute) ||
                      (readingRowId != null && entry.rowId === readingRowId)),
                  imageUrl: entry.imageUrl,
                };
                if (entry.media === "anime") {
                  const { to, href } = franchiseAnimeLink(entry);
                  return href ? { ...base, href } : { ...base, to: to ?? "#" };
                }
                return { ...base, to: franchiseReadingDetailPath(entry) };
              })}
          />
          <LibraryMediaGallery
            images={galleryImages}
            emptyMessage="Galerie indisponible pour cette oeuvre."
            thumbClassName="anime-detail-gallery-thumb"
            onDownloadImage={(src, index) => void downloadGalleryImage(src, index)}
          />
        </div>
      </section>

      <section className="anime-detail-section reading-chapters-section">
        <div className="reading-collapse-head">
          <h2>📄 Chapitres ({chaptersTotal})</h2>
          <div className="reading-volumes-actions">
            <div className="reading-bulk-toggles">
              <button
                type="button"
                className="anime-detail-action-btn anime-detail-action-btn-small"
                onClick={() => void updateReadingProgress({ chaptersRead: chaptersTotal })}
                disabled={progressSaving}
              >
                ✓ Tout marquer comme lu
              </button>
            </div>
            <button type="button" className="anime-detail-action-btn" onClick={() => setCollapseChapters((v) => !v)}>
              {collapseChapters ? "Déplier" : "Réduire"}
            </button>
          </div>
        </div>
        {!collapseChapters ? (
          <div className="reading-chapters-inline-form">
            <p className="anime-detail-prose">
              Progression lue : {chaptersRead}/{chaptersTotal || "?"}
            </p>
            <label>
              Chapitres lus :
              <input
                type="number"
                min={0}
                max={chaptersTotal}
                disabled={progressSaving}
                value={chaptersRead}
                onChange={(e) => void updateReadingProgress({ chaptersRead: Number(e.target.value) || 0 })}
              />
            </label>
            <div className={`anime-collection-progress${chapterProgress === 100 ? " is-completed" : ""}`}>
              <div style={{ width: `${chapterProgress}%` }} />
            </div>
            <small className="anime-collection-progress-meta">
              <span>{chapterProgress}%</span>
            </small>
          </div>
        ) : null}
      </section>

      <section className="anime-detail-section reading-volumes-section">
        <div className="reading-volumes-header">
          <h2>📚 Tomes ({volumesWithReleaseDate.length})</h2>
          <div className="reading-volumes-actions">
            <div className="reading-bulk-toggles">
              <button
                type="button"
                className="anime-detail-action-btn anime-detail-action-btn-small"
                onClick={() => void markAllVolumesAs("isRead")}
              >
                ✓ Tout lu
              </button>
              <button
                type="button"
                className="anime-detail-action-btn anime-detail-action-btn-small"
                onClick={() => void markAllVolumesAs("isOwned")}
              >
                ✓ Tout possédé
              </button>
            </div>
            <button type="button" className="anime-detail-action-btn" onClick={() => setCollapseVolumes((v) => !v)}>
              {collapseVolumes ? "Déplier" : "Réduire"}
            </button>
          </div>
        </div>

        {!collapseVolumes ? (
          <>
            <div className="reading-volume-grid">
              {volumesWithReleaseDate.map((volume) => {
                const volumeNumber = volume.volumeNumber;
                const existing = volumeByNumber.get(volumeNumber);
                return (
                <article key={volumeNumber} className="reading-volume-card">
              <div className={`reading-volume-card-head${existing?.isRead ? " is-read" : ""}`}>
                <strong>Tome {volumeNumber}</strong>
                <div className="reading-volume-inline-checks">
                  <ToggleSwitch
                    checked={Boolean(existing?.isOwned)}
                    onChange={(checked) => void updateVolumeFlags(volumeNumber, { isOwned: checked })}
                    label="Possédé"
                  />
                  <ToggleSwitch
                    checked={Boolean(existing?.isRead)}
                    onChange={(checked) => void updateVolumeFlags(volumeNumber, { isRead: checked })}
                    label="Lu"
                  />
                  <ToggleSwitch
                    checked={Boolean(existing?.isMihon)}
                    onChange={(checked) => void updateVolumeFlags(volumeNumber, { isMihon: checked })}
                    label="Mihon"
                  />
                </div>
              </div>

              <div className="reading-volume-card-body">
                {(() => {
                  const volumeImageUrl = existing?.imageUrl || readingView.imageUrl || "";
                  const proxiedUrl = proxyNautiljonImage(volumeImageUrl);
                  
                  return proxiedUrl ? (
                    <div className="library-downloadable-image">
                      <img
                        src={proxiedUrl}
                        alt=""
                        width={105}
                        height={145}
                        onError={(e) => {
                          console.error(`❌ Erreur chargement image Vol. ${volumeNumber}:`, volumeImageUrl);
                          e.currentTarget.style.display = "none";
                        }}
                      />
                      <button
                        type="button"
                        className="library-download-image-btn"
                        onClick={() => void downloadVolumeImage(volumeImageUrl, volumeNumber)}
                        title="Télécharger l'image du tome"
                      >
                        💾
                      </button>
                    </div>
                  ) : (
                    <div className="anime-detail-relation-thumb-placeholder" aria-hidden style={{ width: 105, height: 145 }}>
                      <ImageOff size={20} />
                    </div>
                  );
                })()}
                <div className="reading-volume-meta">
                  <div>
                    <p className="reading-volume-meta-label">Prix :</p>
                    <p className="reading-volume-price">{Number(existing?.priceEuros ?? 0).toFixed(2)}€</p>
                  </div>
                  {existing?.releaseDateVf ? (
                    <div>
                      <p className="reading-volume-meta-label">Sortie :</p>
                      <p className="reading-volume-meta-value">
                        {new Date(existing.releaseDateVf).toLocaleDateString("fr-FR")}
                      </p>
                    </div>
                  ) : null}
                  {existing?.purchaseDate ? (
                    <div>
                      <p className="reading-volume-meta-label">Acheté :</p>
                      <p className="reading-volume-meta-value">
                        {new Date(existing.purchaseDate).toLocaleDateString("fr-FR")}
                      </p>
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="reading-volume-card-actions">
                <button type="button" className="anime-collection-btn" onClick={() => openEditVolume(volumeNumber)}>
                  Modifier
                </button>
              </div>
                </article>
              );
              })}
            </div>

          </>
        ) : null}
      </section>

      <Modal
        open={isVolumeModalOpen}
        onClose={() => setIsVolumeModalOpen(false)}
        title="Modifier le tome"
        maxWidth="min(96vw, 40rem)"
      >
        {editingVolume ? (
          <div className="reading-edit-volume-modal">
            <div className="reading-edit-volume-left">
              {(() => {
                const modalImageUrl = editingVolume.imageUrl || readingView.imageUrl || "";
                const proxiedModalUrl = proxyNautiljonImage(modalImageUrl);
                
                return proxiedModalUrl ? (
                  <img src={proxiedModalUrl} alt="" />
                ) : (
                  <div className="anime-detail-relation-thumb-placeholder reading-edit-volume-thumb-placeholder" aria-hidden>
                    <ImageOff size={24} />
                  </div>
                );
              })()}
              <label className="reading-modal-field">
                URL
                <input
                  type="text"
                  placeholder="https://..."
                  value={editingVolume.imageUrl}
                  onChange={(e) => setEditingVolume((prev) => (prev ? { ...prev, imageUrl: e.target.value } : prev))}
                />
              </label>
            </div>
            <div className="reading-edit-volume-right">
              <div className="reading-edit-volume-grid">
                <label className="reading-modal-field">
                  Numéro du tome *
                  <input
                    type="number"
                    min={1}
                    value={editingVolume.volumeNumber}
                    onChange={(e) =>
                      setEditingVolume((prev) => (prev ? { ...prev, volumeNumber: Math.max(1, Number(e.target.value) || 1) } : prev))
                    }
                  />
                </label>
                <label className="reading-modal-field">
                  Prix (€) *
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={editingVolume.priceEuros}
                    onChange={(e) =>
                      setEditingVolume((prev) => (prev ? { ...prev, priceEuros: Math.max(0, Number(e.target.value) || 0) } : prev))
                    }
                  />
                </label>
                <label className="reading-modal-field">
                  Type de tome
                  <select
                    value={editingVolume.volumeType}
                    onChange={(e) => setEditingVolume((prev) => (prev ? { ...prev, volumeType: e.target.value } : prev))}
                  >
                    <option value="standard">Standard</option>
                    <option value="collector">Collector</option>
                    <option value="deluxe">Deluxe</option>
                    <option value="integrale">Intégrale</option>
                    <option value="coffret">Coffret</option>
                    <option value="numerique">Numérique</option>
                    <option value="autre">Autre</option>
                  </select>
                </label>
                <label className="reading-modal-field">
                  Date de sortie VF
                  <input
                    type="date"
                    value={editingVolume.releaseDateVf}
                    onChange={(e) => setEditingVolume((prev) => (prev ? { ...prev, releaseDateVf: e.target.value } : prev))}
                  />
                </label>
                <label className="reading-modal-field">
                  Date d'achat
                  <input
                    type="date"
                    value={editingVolume.purchaseDate}
                    onChange={(e) => setEditingVolume((prev) => (prev ? { ...prev, purchaseDate: e.target.value } : prev))}
                  />
                </label>
                <label className="reading-modal-field reading-span-2">
                  Propriétaire(s) *
                  <OwnerToggleList
                    items={familyMembers.map((member) => ({
                      id: member.id,
                      displayName: member.display_name?.trim() || member.id.slice(0, 8),
                      avatarStoragePath: member.avatar_storage_path,
                    }))}
                    selectedIds={editingVolume.ownerIds}
                    onToggle={(ownerId, nextChecked) =>
                      setEditingVolume((prev) => {
                        if (!prev) {
                          return prev;
                        }
                        const currentIds = new Set(prev.ownerIds);
                        if (nextChecked) {
                          currentIds.add(ownerId);
                        } else {
                          currentIds.delete(ownerId);
                        }
                        return { ...prev, ownerIds: Array.from(currentIds) };
                      })
                    }
                    listClassName="reading-owner-list"
                    rowClassName="reading-owner-row"
                    mainClassName="reading-owner-main"
                    avatarSize={30}
                  />
                </label>
              </div>
              <div className="reading-modal-actions">
                <button type="button" className="anime-collection-btn" onClick={() => setIsVolumeModalOpen(false)} disabled={volumeSaving}>
                  Annuler
                </button>
                <button type="button" className="anime-collection-btn" onClick={() => void saveEditingVolume()} disabled={volumeSaving}>
                  Enregistrer
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(propagateOwnersDraft)}
        onClose={closePropagateOwnersModal}
        title="Propager les propriétaires"
        maxWidth="min(96vw, 36rem)"
      >
        {propagateOwnersDraft ? (
          <div className="reading-propagate-owners-modal">
            <p className="anime-detail-prose">
              Le tome {propagateOwnersDraft.sourceVolumeNumber} a plusieurs propriétaires. Tu peux appliquer le même groupe
              aux autres tomes (parts recalculées selon le prix de chaque tome).
            </p>
            <div className="reading-propagate-actions">
              <button
                type="button"
                className="anime-detail-action-btn anime-detail-action-btn-small"
                onClick={() => {
                  const nums = propagateOwnersDraft.volumesSnapshot
                    .filter((v) => v.releaseDateVf && v.volumeNumber !== propagateOwnersDraft.sourceVolumeNumber)
                    .map((v) => v.volumeNumber);
                  setPropagateOwnerTargetsSelected(new Set(nums));
                }}
              >
                Tous
              </button>
              <button
                type="button"
                className="anime-detail-action-btn anime-detail-action-btn-small"
                onClick={() => setPropagateOwnerTargetsSelected(new Set())}
              >
                Aucun
              </button>
            </div>
            <ul className="reading-propagate-volume-list">
              {propagateOwnersDraft.volumesSnapshot
                .filter(
                  (v) =>
                    v.releaseDateVf && v.volumeNumber !== propagateOwnersDraft.sourceVolumeNumber
                )
                .map((vol) => {
                  const selected = propagateOwnerTargetsSelected.has(vol.volumeNumber);
                  const targetKey = normalizeUserIdsList(propagateOwnersDraft.ownerIds);
                  const conflict =
                    vol.owners.length > 0 && normalizeOwnerIdsKey(vol.owners) !== targetKey;
                  return (
                    <li key={vol.volumeNumber}>
                      <div className="reading-propagate-volume-item">
                        <ToggleSwitch
                          checked={selected}
                          onChange={(checked) => {
                            setPropagateOwnerTargetsSelected((prev) => {
                              const next = new Set(prev);
                              if (checked) {
                                next.add(vol.volumeNumber);
                              } else {
                                next.delete(vol.volumeNumber);
                              }
                              return next;
                            });
                          }}
                          label={`Tome ${vol.volumeNumber}`}
                        />
                        {conflict ? (
                          <small className="reading-propagate-warning">
                            Possession différente : vérifier manuellement après application.
                          </small>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
            </ul>
            <div className="reading-modal-actions reading-propagate-footer">
              <button
                type="button"
                className="anime-collection-btn"
                onClick={closePropagateOwnersModal}
                disabled={volumeSaving}
              >
                Plus tard
              </button>
              <button
                type="button"
                className="anime-collection-btn"
                onClick={() => void applyPropagateOwners()}
                disabled={volumeSaving || propagateOwnerTargetsSelected.size === 0}
              >
                Appliquer
              </button>
            </div>
          </div>
        ) : null}
      </Modal>

      <DeleteLibraryEntryConfirmModal
        open={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        entryTitle={readingView.title}
        kind="reading"
        malMediaId={malIdForRemote}
        oauthMalConnected={integrationConnected.mal}
        oauthAnilistConnected={integrationConnected.anilist}
        busy={deleting}
        onConfirm={(opts) => void confirmDeleteReading(opts)}
      />

      <LibrarySyncDiffModal
        open={isSyncModalOpen}
        onClose={() => setIsSyncModalOpen(false)}
        fields={syncDiffFields}
        selectedFieldIds={selectedDiffFieldIds}
        onToggleField={toggleDiffField}
        onSelectAll={() => setSelectedDiffFieldIds(syncDiffFields.map((field) => field.id))}
        onSelectNone={() => setSelectedDiffFieldIds([])}
        onValidate={() => void launchReadingSync("mal")}
        onSyncMal={() => void launchReadingSync("mal")}
        onSyncAnilist={() => void launchReadingSync("anilist")}
        syncing={syncLaunching}
      />

    </div>
  );
}
