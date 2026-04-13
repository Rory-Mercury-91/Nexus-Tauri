import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { AddReadingModal } from "@/features/library/AddReadingModal/AddReadingModal";
import { ToggleSwitch } from "@/components/common/ToggleSwitch";
import { ProfileAvatarImage } from "@/components/common/ProfileAvatarImage";
import { PersonalStatusMenu, type StatusOption } from "@/components/library/PersonalStatusMenu";
import { ResyncQueueModal } from "@/components/modals/ResyncQueueModal/ResyncQueueModal";
import { useReadingSyncProgress } from "@/contexts/ReadingSyncProgressContext";
import { getSupabaseClient } from "@/lib/supabaseClient";
import { useSession } from "@/hooks/useSession";
import { fetchIntegrationStatus } from "@/services/integrations/integrationService";
import {
  deleteReadingEntry,
  fetchReadingCollection,
  fetchReadingCollectionStamp,
  setReadingMihonState,
  updateReadingStatus,
  updateReadingFavorite,
  type ReadingCollectionEntry,
} from "@/services/library/readingCollectionService";
import {
  isSameCollectionStamp,
  readCachedCollection,
  writeCachedCollection,
} from "@/services/library/collectionCacheService";
import {
  detectResyncChanges,
  applyResyncChanges,
  type ResyncQueueEntry,
} from "@/services/library/resyncQueueService";
import { runNautiljonRefresh } from "@/services/library/nautiljonRefreshService";
import { notifyToast } from "@/lib/toastEvents";
import { proxyNautiljonImage } from "@/lib/imageProxy";
import {
  getMainScrollContainer,
  readMainScrollTop,
  writeMainScrollTop,
} from "@/lib/collectionScroll";
import "./LibraryPages.css";
import "./AnimeCollectionPage.css";

type ViewMode = "grid" | "list";
type CollectionRestoreState = {
  fromDetailCollection?: "lectures";
  restoreScrollY?: number;
  collectionViewMode?: ViewMode;
};
type UserStatus = "Planifié" | "En cours" | "En pause" | "Terminé" | "Abandonné";
type WorkStatus = "En cours" | "Terminé" | "Abandonné" | "À venir";
type SortMode = "az" | "za" | "recent" | "oldest" | "score-asc" | "score-desc";
type PageSizeValue = 25 | 50 | 100 | 250 | 500 | "all";
type ProgressSourceMode = "auto" | "mal" | "mihon";

const SCROLL_KEY_GRID = "reading-collection:scroll-main:grid";
const SCROLL_KEY_LIST = "reading-collection:scroll-main:list";
const RETURN_TO_COLLECTION_KEY = "app:scroll:return-to-collection";
const VIEW_MODE_KEY = "reading-collection:view-mode";
const NO_IMAGE_DATA_URI =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="340" viewBox="0 0 240 340"><rect width="100%" height="100%" fill="#1f2430"/><circle cx="120" cy="135" r="44" fill="#2f3647"/><path d="M68 250h104" stroke="#6f7a93" stroke-width="10" stroke-linecap="round"/><text x="120" y="290" fill="#9aa3b8" font-size="18" text-anchor="middle" font-family="Arial">No Image</text></svg>'
  );
const READING_COLLECTION_CACHE_KEY = "library:reading:collection:cache:v1";

function getScrollKey(mode: ViewMode): string {
  return mode === "list" ? SCROLL_KEY_LIST : SCROLL_KEY_GRID;
}

function markReturnToReadingCollection(): void {
  sessionStorage.setItem(RETURN_TO_COLLECTION_KEY, "lectures");
}

function buildReadingDetailState(scrollY: number, mode: ViewMode) {
  return {
    fromCollection: "lectures" as const,
    collectionScrollY: scrollY,
    collectionViewMode: mode,
  };
}

function percent(value: number, total: number): number {
  if (total <= 0) {
    return 0;
  }
  return Math.round((value / total) * 100);
}

function userStatusClass(status: UserStatus): string {
  switch (status) {
    case "En cours":
      return "watching";
    case "Terminé":
      return "completed";
    case "En pause":
      return "paused";
    case "Planifié":
      return "planned";
    case "Abandonné":
      return "dropped";
    default:
      return "planned";
  }
}

function workStatusClass(status: WorkStatus): string {
  switch (status) {
    case "En cours":
      return "airing";
    case "Terminé":
      return "done";
    case "Abandonné":
      return "dropped";
    case "À venir":
      return "upcoming";
    default:
      return "done";
  }
}

export function ReadingCollectionPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { session } = useSession();
  const userId = session?.user?.id ?? "";
  const [addOpen, setAddOpen] = useState(false);
  const [items, setItems] = useState<ReadingCollectionEntry[]>([]);
  const [loadingCollection, setLoadingCollection] = useState(false);
  const [collectionError, setCollectionError] = useState<string | null>(null);
  const [tabType, setTabType] = useState<string>("Tous");
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("az");
  const [userStatusFilter, setUserStatusFilter] = useState<string>("Tous");
  const [workStatusFilter, setWorkStatusFilter] = useState<string>("Tous");
  const [genreFilter, setGenreFilter] = useState<string>("Tous");
  const [themeFilter, setThemeFilter] = useState<string>("Tous");
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [showFamilyCollection, setShowFamilyCollection] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const saved = localStorage.getItem(VIEW_MODE_KEY);
    return saved === "list" ? "list" : "grid";
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSizeValue>(25);
  const [menuOpenFor, setMenuOpenFor] = useState<number | null>(null);
  const [menuAnchorRect, setMenuAnchorRect] = useState<DOMRect | null>(null);
  const { startSync, loading: syncLoading, activeRun } = useReadingSyncProgress();
  const isSyncBusy = Boolean(
    activeRun && (activeRun.status === "queued" || activeRun.status === "running")
  );
  
  const [resyncQueue, setResyncQueue] = useState<ResyncQueueEntry[]>([]);
  const [resyncQueueIndex, setResyncQueueIndex] = useState(0);
  const [resyncQueueOpen, setResyncQueueOpen] = useState(false);
  const [resyncProcessing, setResyncProcessing] = useState(false);
  const [detectingChanges, setDetectingChanges] = useState(false);
  const [nautiljonRefreshing, setNautiljonRefreshing] = useState(false);
  const [showNautiljonPendingOnly, setShowNautiljonPendingOnly] = useState(false);
  const [showMihonOnly, setShowMihonOnly] = useState(false);
  const [showDuplicateMalGroups, setShowDuplicateMalGroups] = useState(false);
  const [progressSourceMode, setProgressSourceMode] = useState<ProgressSourceMode>("auto");
  const [integrationConnected, setIntegrationConnected] = useState({
    mal: false,
    anilist: false,
  });
  
  const filterRef = useRef<HTMLDivElement>(null);

  const types = useMemo(() => {
    const counts = new Map<string, number>();
    items.forEach((item) => counts.set(item.type, (counts.get(item.type) ?? 0) + 1));
    return [
      { type: "Tous", count: items.length },
      ...Array.from(counts.entries())
        .filter(([, count]) => count > 0)
        .map(([type, count]) => ({ type, count })),
    ];
  }, [items]);

  const availableGenres = useMemo(
    () => ["Tous", ...Array.from(new Set(items.flatMap((x) => x.genres))).sort((a, b) => a.localeCompare(b))],
    [items]
  );
  const availableThemes = useMemo(
    () => ["Tous", ...Array.from(new Set(items.flatMap((x) => x.themes))).sort((a, b) => a.localeCompare(b))],
    [items]
  );

  const loadCollection = useCallback(async (forceRefresh = false) => {
    setLoadingCollection(true);
    try {
      const supabase = getSupabaseClient();
      const remoteStamp = await fetchReadingCollectionStamp(supabase);
      const cached = readCachedCollection<ReadingCollectionEntry>(READING_COLLECTION_CACHE_KEY);
      if (!forceRefresh && cached && isSameCollectionStamp(cached.stamp, remoteStamp)) {
        setItems(cached.items);
        setCollectionError(null);
        return;
      }
      const rows = await fetchReadingCollection(supabase);
      setItems(rows);
      writeCachedCollection(READING_COLLECTION_CACHE_KEY, rows, remoteStamp);
      setCollectionError(null);
    } catch (e) {
      setCollectionError(e instanceof Error ? e.message : "Impossible de charger la collection.");
    } finally {
      setLoadingCollection(false);
    }
  }, []);

  useEffect(() => {
    const cached = readCachedCollection<ReadingCollectionEntry>(READING_COLLECTION_CACHE_KEY);
    if (cached) {
      setItems(cached.items);
    }
    void loadCollection(false);
  }, [loadCollection]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
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

  async function updateUserStatus(itemId: number, status: StatusOption) {
    const target = items.find((entry) => entry.malId === itemId);
    if (!target) {
      return;
    }
    setItems((prev) => prev.map((item) => (item.malId === itemId ? { ...item, userStatus: status } : item)));
    try {
      const supabase = getSupabaseClient();
      await updateReadingStatus(supabase, target.id, status);
    } catch {
      setItems((prev) =>
        prev.map((item) => (item.malId === itemId ? { ...item, userStatus: target.userStatus } : item))
      );
    }
  }

  async function updateFavorite(itemId: number) {
    const target = items.find((entry) => entry.malId === itemId);
    if (!target) {
      return;
    }
    const nextValue = !target.favorite;
    setItems((prev) => prev.map((item) => (item.malId === itemId ? { ...item, favorite: nextValue } : item)));
    try {
      const supabase = getSupabaseClient();
      await updateReadingFavorite(supabase, target.id, nextValue);
    } catch {
      setItems((prev) => prev.map((item) => (item.malId === itemId ? { ...item, favorite: target.favorite } : item)));
    }
  }

  async function removeEntry(itemId: number) {
    const target = items.find((entry) => entry.malId === itemId);
    if (!target) {
      return;
    }
    const confirmed = window.confirm(
      `Supprimer définitivement "${target.title}" de la collection ?`
    );
    if (!confirmed) {
      return;
    }
    try {
      const supabase = getSupabaseClient();
      await deleteReadingEntry(supabase, target.id);
      setItems((prev) => prev.filter((entry) => entry.id !== target.id));
    } catch (error) {
      setCollectionError(
        error instanceof Error ? error.message : "Suppression impossible."
      );
    }
  }

  async function toggleMihonEntry(itemId: number) {
    const target = items.find((entry) => entry.malId === itemId);
    if (!target) {
      return;
    }
    const nextEnabled = !target.mihonEnabledByCurrentUser;
    const previous = target;
    const nextRead = nextEnabled ? Math.max(target.mihonChaptersRead, target.malChaptersRead) : 0;
    const nextTotal = nextEnabled
      ? Math.max(target.mihonChaptersTotal, target.malChaptersTotal, nextRead)
      : 0;
    setItems((prev) =>
      prev.map((item) =>
        item.malId === itemId
          ? {
              ...item,
              mihonEnabledByCurrentUser: nextEnabled,
              preferMihonProgress: nextEnabled,
              mihonChaptersRead: nextRead,
              mihonChaptersTotal: nextTotal,
              chaptersRead: nextEnabled ? nextRead : item.malChaptersRead,
              chaptersTotal: nextEnabled
                ? (nextTotal > 0 ? nextTotal : item.malChaptersTotal)
                : item.malChaptersTotal,
              hasMihonInFamily: nextEnabled || item.hasMihonInFamily,
              mihonUsers: nextEnabled
                ? Array.from(new Set([...(item.mihonUsers ?? []), "Moi"]))
                : (item.mihonUsers ?? []).filter((label) => label !== "Moi"),
              mihonUserBadges: nextEnabled
                ? [
                    ...(item.mihonUserBadges ?? []),
                    ...(item.mihonUserBadges?.some((badge) => badge.name === "Moi")
                      ? []
                      : [{ name: "Moi", avatarPath: null }]),
                  ]
                : (item.mihonUserBadges ?? []).filter((badge) => badge.name !== "Moi"),
            }
          : item
      )
    );
    try {
      const supabase = getSupabaseClient();
      await setReadingMihonState(supabase, target.id, nextEnabled, {
        chaptersRead: nextRead,
        chaptersTotal: nextTotal,
        preferMihonProgress: nextEnabled,
      });
      await loadCollection(true);
    } catch {
      setItems((prev) =>
        prev.map((item) => (item.malId === itemId ? previous : item))
      );
    }
  }

  function navigateToReadingDetail(malId: number) {
    const container = getMainScrollContainer();
    const y = readMainScrollTop(container);
    sessionStorage.setItem(getScrollKey(viewMode), String(y));
    markReturnToReadingCollection();
    navigate(`/lectures/${malId}`, {
      state: buildReadingDetailState(y, viewMode),
    });
  }

  useEffect(() => {
    if (!activeRun || activeRun.status === "queued" || activeRun.status === "running") {
      return;
    }
    void loadCollection();
  }, [activeRun, loadCollection]);

  useEffect(() => {
    localStorage.setItem(VIEW_MODE_KEY, viewMode);
  }, [viewMode]);

  useEffect(() => {
    if (location.pathname !== "/lectures") return;
    const routeState = (location.state as CollectionRestoreState | null) ?? null;
    const fromBackState =
      routeState?.fromDetailCollection === "lectures" &&
      routeState.collectionViewMode === viewMode &&
      Number.isFinite(routeState.restoreScrollY ?? NaN)
        ? Number(routeState.restoreScrollY)
        : null;
    const fromSession = (() => {
      const raw = sessionStorage.getItem(getScrollKey(viewMode));
      if (!raw) return null;
      const value = Number(raw);
      return Number.isFinite(value) ? value : null;
    })();
    const value = fromBackState ?? fromSession;
    if (value === null) return;
    const applyRestore = () => {
      writeMainScrollTop(getMainScrollContainer(), value);
    };
    applyRestore();
    const rafId = requestAnimationFrame(applyRestore);
    const timeoutId = window.setTimeout(applyRestore, 120);
    return () => {
      cancelAnimationFrame(rafId);
      window.clearTimeout(timeoutId);
    };
  }, [location.pathname, location.state, viewMode]);

  const filteredBase = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    let base = items.filter((item) => {
      if (tabType !== "Tous" && item.type !== tabType) {
        return false;
      }
      if (userStatusFilter !== "Tous" && item.userStatus !== userStatusFilter) {
        return false;
      }
      if (workStatusFilter !== "Tous" && item.workStatus !== workStatusFilter) {
        return false;
      }
      if (favoriteOnly && !item.favorite) {
        return false;
      }
      if (showFamilyCollection && !item.hasFamilyOwners) {
        return false;
      }
      if (showNautiljonPendingOnly && !item.nautiljonNeedsManualImport) {
        return false;
      }
      if (showMihonOnly && !item.hasMihonInFamily) {
        return false;
      }
      if (genreFilter !== "Tous" && !item.genres.includes(genreFilter)) {
        return false;
      }
      if (themeFilter !== "Tous" && !item.themes.includes(themeFilter)) {
        return false;
      }
      if (!normalized) {
        return true;
      }
      return item.title.toLowerCase().includes(normalized) || String(item.malId).includes(normalized);
    });

    base = [...base].sort((a, b) => {
      switch (sortMode) {
        case "az":
          return a.title.localeCompare(b.title);
        case "za":
          return b.title.localeCompare(a.title);
        case "recent":
          return new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime();
        case "oldest":
          return new Date(a.addedAt).getTime() - new Date(b.addedAt).getTime();
        case "score-asc":
          return a.score - b.score;
        case "score-desc":
          return b.score - a.score;
        default:
          return 0;
      }
    });
    return base;
  }, [favoriteOnly, genreFilter, items, query, showFamilyCollection, showMihonOnly, showNautiljonPendingOnly, sortMode, tabType, themeFilter, userStatusFilter, workStatusFilter]);

  const duplicateMalIds = useMemo(() => {
    const counts = new Map<number, number>();
    filteredBase.forEach((entry) => {
      counts.set(entry.malId, (counts.get(entry.malId) ?? 0) + 1);
    });
    return new Set(
      Array.from(counts.entries())
        .filter(([, count]) => count > 1)
        .map(([malId]) => malId)
    );
  }, [filteredBase]);

  const filtered = useMemo(
    () =>
      showDuplicateMalGroups
        ? filteredBase.filter((entry) => duplicateMalIds.has(entry.malId))
        : filteredBase,
    [duplicateMalIds, filteredBase, showDuplicateMalGroups]
  );

  const duplicateGroups = useMemo(() => {
    const groups = new Map<number, ReadingCollectionEntry[]>();
    filtered.forEach((entry) => {
      if (!duplicateMalIds.has(entry.malId)) return;
      if (!groups.has(entry.malId)) {
        groups.set(entry.malId, []);
      }
      groups.get(entry.malId)!.push(entry);
    });
    return Array.from(groups.entries()).sort((a, b) => a[0] - b[0]);
  }, [duplicateMalIds, filtered]);

  const isUnlimited = pageSize === "all";
  const pageCount = isUnlimited ? 1 : Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pageSlice = useMemo<ReadingCollectionEntry[]>(() => {
    if (isUnlimited) {
      return filtered;
    }
    const start = (safePage - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, isUnlimited, pageSize, safePage]);

  useEffect(() => {
    if (page > pageCount) {
      setPage(pageCount);
    }
  }, [page, pageCount]);

  const pageStart = filtered.length === 0 ? 0 : isUnlimited ? 1 : (safePage - 1) * pageSize + 1;
  const pageEnd = filtered.length === 0 ? 0 : isUnlimited ? pageSlice.length : Math.min(filtered.length, safePage * pageSize);

  const stats = useMemo(() => {
    const reading = filtered.filter((x) => x.userStatus === "En cours").length;
    const completed = filtered.filter((x) => x.userStatus === "Terminé").length;
    const chapterSource = (item: ReadingCollectionEntry) => {
      if (progressSourceMode === "mal") {
        return { read: item.malChaptersRead, total: item.malChaptersTotal };
      }
      if (progressSourceMode === "mihon") {
        const total = item.mihonChaptersTotal > 0 ? item.mihonChaptersTotal : item.mihonChaptersRead;
        return { read: item.mihonChaptersRead, total };
      }
      if (item.preferMihonProgress) {
        const total = item.mihonChaptersTotal > 0 ? item.mihonChaptersTotal : item.mihonChaptersRead;
        return { read: item.mihonChaptersRead, total };
      }
      return { read: item.malChaptersRead, total: item.malChaptersTotal };
    };
    const readChapters = filtered.reduce((acc, x) => acc + chapterSource(x).read, 0);
    const totalChapters = filtered.reduce((acc, x) => acc + chapterSource(x).total, 0);
    const readVolumes = filtered.reduce((acc, x) => acc + x.volumesRead, 0);
    const totalVolumes = filtered.reduce((acc, x) => acc + x.volumesTotal, 0);
    return {
      reading,
      completed,
      readChapters,
      totalChapters,
      readVolumes,
      totalVolumes,
      chapterRatio: percent(readChapters, totalChapters),
      volumeRatio: percent(readVolumes, totalVolumes),
    };
  }, [filtered, progressSourceMode]);
  const nautiljonPendingCount = useMemo(
    () => items.filter((item) => item.nautiljonNeedsManualImport).length,
    [items]
  );

  function resetFilters() {
    setQuery("");
    setSortMode("az");
    setUserStatusFilter("Tous");
    setWorkStatusFilter("Tous");
    setGenreFilter("Tous");
    setThemeFilter("Tous");
    setFavoriteOnly(false);
    setShowFamilyCollection(false);
    setShowNautiljonPendingOnly(false);
    setShowMihonOnly(false);
    setShowDuplicateMalGroups(false);
    setProgressSourceMode("auto");
    setPage(1);
  }

  async function refreshNautiljonFlags() {
    setNautiljonRefreshing(true);
    try {
      const result = await runNautiljonRefresh({ limit: 100, force: true });
      await loadCollection(true);
      notifyToast({
        kind: "success",
        message: `Nautiljon: ${result.checked} fiche(s) vérifiée(s), ${result.changed} changement(s), ${result.flagged} à réimporter.`,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Erreur lors de la vérification Nautiljon.";
      setCollectionError(message);
      notifyToast({ kind: "error", message });
    } finally {
      setNautiljonRefreshing(false);
    }
  }

  async function onStartSync(source: "mal" | "anilist") {
    try {
      await startSync(source);
      await loadCollection();
      setCollectionError(null);
    } catch (e) {
      setCollectionError(e instanceof Error ? e.message : "Impossible de lancer la synchronisation.");
    }
  }
  
  async function detectChanges(source: "mal" | "anilist") {
    if (!userId) return;
    setDetectingChanges(true);
    try {
      const supabase = getSupabaseClient();
      const queue = await detectResyncChanges(supabase, userId, "reading", source);
      if (queue.length === 0) {
        setCollectionError("Aucune modification détectée. Toutes les entrées sont à jour.");
      } else {
        setResyncQueue(queue);
        setResyncQueueIndex(0);
        setResyncQueueOpen(true);
      }
    } catch (e) {
      setCollectionError(e instanceof Error ? e.message : "Erreur lors de la détection des changements.");
    } finally {
      setDetectingChanges(false);
    }
  }
  
  async function applyCurrentEntry(entryId: string, selectedFieldIds: string[]) {
    setResyncProcessing(true);
    try {
      const currentEntry = resyncQueue[resyncQueueIndex];
      if (!currentEntry) return;
      
      const supabase = getSupabaseClient();
      
      // Récupérer les nouveaux snapshots (déjà chargés lors de la détection)
      // Pour simplifier, on va juste recharger les données live
      const malId = currentEntry.malId;
      const jikanEndpoint = `https://api.jikan.moe/v4/manga/${malId}/full`;
      const jikanResp = await fetch(jikanEndpoint);
      const jikanJson = await jikanResp.json() as { data?: Record<string, unknown> };
      const newJikanData = jikanJson.data ?? {};
      
      const newMalSnapshot = {}; // Pour l'instant, pas de données MAL
      const newJikanSnapshot = { full: newJikanData };
      
      await applyResyncChanges(supabase, entryId, "reading", selectedFieldIds, newMalSnapshot, newJikanSnapshot);
      
      // Passer à l'entrée suivante ou fermer
      if (resyncQueueIndex < resyncQueue.length - 1) {
        setResyncQueueIndex((prev) => prev + 1);
      } else {
        setResyncQueueOpen(false);
        await loadCollection();
      }
    } catch (e) {
      setCollectionError(e instanceof Error ? e.message : "Erreur lors de l'application des changements.");
    } finally {
      setResyncProcessing(false);
    }
  }
  
  async function skipCurrentEntry() {
    if (resyncQueueIndex < resyncQueue.length - 1) {
      setResyncQueueIndex((prev) => prev + 1);
    } else {
      setResyncQueueOpen(false);
      await loadCollection();
    }
  }
  
  async function applyAllEntries() {
    setResyncProcessing(true);
    try {
      const supabase = getSupabaseClient();
      for (const entry of resyncQueue) {
        const malId = entry.malId;
        const jikanEndpoint = `https://api.jikan.moe/v4/manga/${malId}/full`;
        const jikanResp = await fetch(jikanEndpoint);
        const jikanJson = await jikanResp.json() as { data?: Record<string, unknown> };
        const newJikanData = jikanJson.data ?? {};
        
        const newMalSnapshot = {};
        const newJikanSnapshot = { full: newJikanData };
        const allFieldIds = entry.fields.map((f) => f.id);
        
        await applyResyncChanges(supabase, entry.id, "reading", allFieldIds, newMalSnapshot, newJikanSnapshot);
      }
      setResyncQueueOpen(false);
      await loadCollection();
    } catch (e) {
      setCollectionError(e instanceof Error ? e.message : "Erreur lors de l'application globale.");
    } finally {
      setResyncProcessing(false);
    }
  }
  
  function handleResyncQueueClose() {
    if (!resyncProcessing) {
      setResyncQueueOpen(false);
    }
  }
  
  function scrollToFilters() {
    if (!filterRef.current) {
      return;
    }
    filterRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="library-page anime-collection-page">
      {loadingCollection ? (
        <div className="anime-collection-loading-overlay">
          <div className="anime-collection-loading-spinner">
            <div className="spinner"></div>
            <p>Chargement de la collection…</p>
          </div>
        </div>
      ) : null}

      <div className="anime-collection-head">
        <h1 className="library-page-title anime-collection-title">Collection Lectures</h1>
        <div className="anime-collection-head-actions">
          <button type="button" className="anime-collection-btn" onClick={() => void loadCollection(true)}>
            Recharger
          </button>
          <button
            type="button"
            className="anime-collection-btn"
            disabled={syncLoading || isSyncBusy || !integrationConnected.mal}
            onClick={() => void onStartSync("mal")}
            title={
              !integrationConnected.mal
                ? "Connecte d'abord MyAnimeList dans Paramètres > Intégrations."
                : isSyncBusy
                  ? "Synchronisation en cours, merci d'attendre la fin."
                  : "Lancer la synchronisation MAL"
            }
          >
            Sync MAL
          </button>
          <button
            type="button"
            className="anime-collection-btn"
            disabled={syncLoading || isSyncBusy || !integrationConnected.anilist}
            onClick={() => void onStartSync("anilist")}
            title={
              !integrationConnected.anilist
                ? "Connecte d'abord AniList dans Paramètres > Intégrations."
                : isSyncBusy
                  ? "Synchronisation en cours, merci d'attendre la fin."
                  : "Lancer la synchronisation AniList"
            }
          >
            Sync AniList
          </button>
          <button
            type="button"
            className="anime-collection-btn"
            disabled={detectingChanges || !integrationConnected.mal}
            onClick={() => void detectChanges("mal")}
            title={
              !integrationConnected.mal
                ? "Connecte d'abord MyAnimeList dans Paramètres > Intégrations."
                : "Compare la base locale avec MAL/Jikan et propose une mise à jour champ par champ."
            }
          >
            {detectingChanges ? "Détection..." : "Détecter changements (pré-sync)"}
          </button>
          <button
            type="button"
            className="anime-collection-btn"
            disabled={nautiljonRefreshing}
            onClick={() => void refreshNautiljonFlags()}
            title="Vérifie les pages Nautiljon liées et marque les fiches à réimporter."
          >
            {nautiljonRefreshing ? "Nautiljon..." : "Vérifier Nautiljon"}
          </button>
          <button type="button" className="library-add-anime-btn" onClick={() => setAddOpen(true)}>
            + Ajouter une lecture
          </button>
        </div>
      </div>
      {nautiljonPendingCount > 0 ? (
        <p className="library-page-lead">
          Nautiljon: {nautiljonPendingCount} fiche(s) à réimporter manuellement.
        </p>
      ) : null}

      {collectionError ? <p className="library-page-lead">{collectionError}</p> : null}

      <div className="anime-collection-tabs" role="tablist" aria-label="Types de lecture">
        {types.map((tab) => (
          <button
            key={tab.type}
            type="button"
            role="tab"
            aria-selected={tabType === tab.type}
            className={`anime-collection-tab${tabType === tab.type ? " is-active" : ""}`}
            onClick={() => {
              setTabType(tab.type);
              setPage(1);
            }}
          >
            {tab.type} ({tab.count})
          </button>
        ))}
      </div>

      <section className="anime-collection-stats">
        <div className="anime-collection-stats-content">
          <strong>📚 Lectures :</strong>
          <span className="anime-collection-stats-watching">{stats.reading} en cours</span>
          <span className="anime-collection-stats-sep">|</span>
          <span className="anime-collection-stats-completed">{stats.completed} terminées</span>
          <span className="anime-collection-stats-sep">|</span>
          <span className="anime-collection-stats-seen">
            {stats.readChapters}/{stats.totalChapters} chapitres
          </span>
          <span className="anime-collection-stats-sep">|</span>
          <span className="anime-collection-stats-ratio">{stats.chapterRatio}%</span>
          <span className="anime-collection-stats-sep">|</span>
          <span className="anime-collection-stats-seen">
            {stats.readVolumes}/{stats.totalVolumes} tomes
          </span>
          <span className="anime-collection-stats-sep">|</span>
          <span className="anime-collection-stats-ratio">{stats.volumeRatio}%</span>
        </div>
      </section>

      <section className="anime-collection-filters" ref={filterRef}>
        <div className="anime-collection-filters-head">
          <input
            className="anime-collection-search"
            placeholder="Rechercher par titre ou MAL ID"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
          />
          <button type="button" className="anime-collection-btn" onClick={resetFilters}>
            Réinitialiser
          </button>
        </div>

        <div className="anime-collection-filter-grid">
          <label className="anime-collection-filter-field">
            <span>Tri</span>
            <select value={sortMode} onChange={(e) => setSortMode(e.target.value as SortMode)}>
              <option value="az">A-Z</option>
              <option value="za">Z-A</option>
              <option value="recent">Ajout récent</option>
              <option value="oldest">Ajout ancien</option>
              <option value="score-asc">Score ascendant</option>
              <option value="score-desc">Score descendant</option>
            </select>
          </label>

          <label className="anime-collection-filter-field">
            <span>Statut de lecture</span>
            <select value={userStatusFilter} onChange={(e) => setUserStatusFilter(e.target.value)}>
              <option>Tous</option>
              <option>Planifié</option>
              <option>En cours</option>
              <option>En pause</option>
              <option>Terminé</option>
              <option>Abandonné</option>
            </select>
          </label>

          <label className="anime-collection-filter-field">
            <span>Statut de l'oeuvre</span>
            <select value={workStatusFilter} onChange={(e) => setWorkStatusFilter(e.target.value)}>
              <option>Tous</option>
              <option>En cours</option>
              <option>Terminé</option>
              <option>Abandonné</option>
              <option>À venir</option>
            </select>
          </label>

          <label className="anime-collection-filter-field">
            <span>Genre</span>
            <select value={genreFilter} onChange={(e) => setGenreFilter(e.target.value)}>
              {availableGenres.map((genre) => (
                <option key={genre}>{genre}</option>
              ))}
            </select>
          </label>

          <label className="anime-collection-filter-field">
            <span>Thème</span>
            <select value={themeFilter} onChange={(e) => setThemeFilter(e.target.value)}>
              {availableThemes.map((theme) => (
                <option key={theme}>{theme}</option>
              ))}
            </select>
          </label>
          <label className="anime-collection-filter-field">
            <span>Source progression</span>
            <select
              value={progressSourceMode}
              onChange={(e) => setProgressSourceMode(e.target.value as ProgressSourceMode)}
            >
              <option value="auto">Auto (par entrée)</option>
              <option value="mal">MAL</option>
              <option value="mihon">MIHON</option>
            </select>
          </label>

          <div className="anime-collection-filter-field anime-collection-filter-field-toggle">
            <span>Affichage collection</span>
            <ToggleSwitch
              checked={favoriteOnly}
              onChange={setFavoriteOnly}
              label="Favoris uniquement"
            />
            <ToggleSwitch
              checked={showFamilyCollection}
              onChange={setShowFamilyCollection}
              label="Collection famille"
            />
            <ToggleSwitch
              checked={showNautiljonPendingOnly}
              onChange={setShowNautiljonPendingOnly}
              label="Nautiljon à réimporter"
            />
            <ToggleSwitch
              checked={showMihonOnly}
              onChange={setShowMihonOnly}
              label="Présent sur Mihon"
            />
            <ToggleSwitch
              checked={showDuplicateMalGroups}
              onChange={setShowDuplicateMalGroups}
              label="Regrouper doublons MAL ID"
            />
          </div>
        </div>
      </section>

      <section className="anime-collection-toolbar">
        <div>
          {pageStart}-{pageEnd} sur {filtered.length}
        </div>
        <div className="anime-collection-toolbar-right">
          <button
            type="button"
            className={`anime-collection-view-btn${viewMode === "grid" ? " is-active" : ""}`}
            onClick={() => setViewMode("grid")}
          >
            Grille
          </button>
          <button
            type="button"
            className={`anime-collection-view-btn${viewMode === "list" ? " is-active" : ""}`}
            onClick={() => setViewMode("list")}
          >
            Liste
          </button>
          <select
            value={String(pageSize)}
            onChange={(e) => setPageSize(e.target.value === "all" ? "all" : (Number(e.target.value) as PageSizeValue))}
          >
            <option value="25">25</option>
            <option value="50">50</option>
            <option value="100">100</option>
            <option value="250">250</option>
            <option value="500">500</option>
            <option value="all">Illimité</option>
          </select>
          <button
            type="button"
            className="anime-collection-page-btn"
            disabled={isUnlimited}
            onClick={() => setPage(Math.max(1, safePage - 1))}
          >
            ‹
          </button>
          <span>{isUnlimited ? "∞" : `${safePage}/${pageCount}`}</span>
          <button
            type="button"
            className="anime-collection-page-btn"
            disabled={isUnlimited}
            onClick={() => setPage(Math.min(pageCount, safePage + 1))}
          >
            ›
          </button>
        </div>
      </section>

      <section className={viewMode === "grid" ? "anime-collection-grid" : "anime-collection-list"}>
        {showDuplicateMalGroups ? (
          <div style={{ display: "grid", gap: "12px", gridColumn: "1 / -1" }}>
            {duplicateGroups.length === 0 ? (
              <div className="library-page-lead">
                Aucun MAL ID dupliqué sur la sélection actuelle.
              </div>
            ) : (
              duplicateGroups.map(([malId, entries]) => (
                <article key={`dup-${malId}`} className="anime-collection-card" style={{ padding: "12px" }}>
                  <strong>MAL ID {malId}</strong>
                  <div
                    style={{
                      marginTop: "8px",
                      display: "grid",
                      gap: "8px",
                      gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
                    }}
                  >
                    {entries.map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        className="anime-collection-btn"
                        style={{ textAlign: "left" }}
                        onClick={() => navigateToReadingDetail(entry.malId)}
                        title={entry.title}
                      >
                        <div>{entry.title}</div>
                        <small>
                          {entry.userStatus} — Mihon:{" "}
                          {(entry.mihonUsers ?? []).length > 0 ? (entry.mihonUsers ?? []).join(", ") : "aucun"}
                        </small>
                      </button>
                    ))}
                  </div>
                </article>
              ))
            )}
          </div>
        ) : pageSlice.map((item) => {
          const mihonUsers = item.mihonUsers ?? [];
          const mihonUserBadges = item.mihonUserBadges ?? [];
          const chapterRead =
            progressSourceMode === "mal"
              ? item.malChaptersRead
              : progressSourceMode === "mihon"
                ? item.mihonChaptersRead
                : item.preferMihonProgress
                  ? item.mihonChaptersRead
                  : item.malChaptersRead;
          const chapterTotalRaw =
            progressSourceMode === "mal"
              ? item.malChaptersTotal
              : progressSourceMode === "mihon"
                ? item.mihonChaptersTotal
                : item.preferMihonProgress
                  ? item.mihonChaptersTotal
                  : item.malChaptersTotal;
          const chapterTotal = chapterTotalRaw > 0 ? chapterTotalRaw : chapterRead;
          const chapterProgress = percent(chapterRead, chapterTotal);
          const volumeProgress = percent(item.volumesRead, item.volumesTotal);
          return (
            <article
              key={item.malId}
              className="anime-collection-card"
              role="link"
              tabIndex={0}
              onClick={(e) => {
                const target = e.target as HTMLElement;
                if (target.closest("button,a,input,select,textarea,label")) {
                  return;
                }
                navigateToReadingDetail(item.malId);
              }}
              onKeyDown={(e) => {
                if (e.key !== "Enter" && e.key !== " ") {
                  return;
                }
                const target = e.target as HTMLElement;
                if (target.closest("button,a,input,select,textarea,label")) {
                  return;
                }
                e.preventDefault();
                navigateToReadingDetail(item.malId);
              }}
            >
              {item.favorite ? (
                <span className="anime-collection-favorite-badge" title="Entrée en favoris" aria-label="Favori">
                  ❤
                </span>
              ) : null}
              <Link
                to={`/lectures/${item.malId}`}
                onClick={(e) => {
                  e.preventDefault();
                  navigateToReadingDetail(item.malId);
                }}
                className="anime-collection-cover-link"
              >
                <img src={proxyNautiljonImage(item.imageUrl) || NO_IMAGE_DATA_URI} alt={item.title} className="anime-collection-cover" loading="lazy" />
                {viewMode === "grid" ? (
                  <span className={`anime-collection-status anime-collection-status-overlay anime-collection-status-${userStatusClass(item.userStatus)}`}>
                    {item.userStatus}
                  </span>
                ) : null}
              </Link>
              <div className="anime-collection-card-body">
                {viewMode === "list" ? (
                  <>
                    <div className="anime-collection-title-row">
                      {item.favorite ? (
                        <span className="anime-collection-title-favorite" title="Entrée en favoris" aria-label="Favori">
                          ❤
                        </span>
                      ) : null}
                      <Link
                        to={`/lectures/${item.malId}`}
                        onClick={(e) => {
                          e.preventDefault();
                          navigateToReadingDetail(item.malId);
                        }}
                        className="anime-collection-title-link"
                        title={item.title}
                      >
                        {item.title}
                      </Link>
                      {mihonUserBadges.length > 0 ? (
                        <div className="anime-collection-owners-inline" title={`Mihon: ${mihonUsers.join(", ")}`}>
                          {mihonUserBadges.map((badge, idx) => (
                            <span key={`${badge.name}-${idx}`} className="anime-collection-owner-chip">
                              <ProfileAvatarImage
                                size={18}
                                storagePath={badge.avatarPath}
                                displayName={badge.name}
                              />
                              <span>{badge.name}</span>
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <div className="anime-collection-list-line2">
                      <div className="anime-collection-status-row">
                        <span className={`anime-collection-status anime-collection-status-${userStatusClass(item.userStatus)}`}>
                          {item.userStatus}
                        </span>
                        <span className={`anime-collection-status anime-collection-work-status anime-collection-work-status-${workStatusClass(item.workStatus)}`}>
                          {item.workStatus}
                        </span>
                      </div>
                      {mihonUsers.length > 0 ? (
                        <small className="anime-collection-progress-label">
                          Mihon: {mihonUsers.join(", ")}
                        </small>
                      ) : null}
                      <div className="anime-collection-double-progress anime-collection-double-progress-list">
                        <div className="anime-collection-progress-row">
                          <small className="anime-collection-progress-label">
                            {chapterRead}/{chapterTotal || "?"} ch.
                          </small>
                          <div className={`anime-collection-progress anime-collection-progress-inline${item.userStatus === "Terminé" ? " is-completed" : ""}`}>
                            <div style={{ width: `${chapterProgress}%` }} />
                          </div>
                          <span className={`anime-collection-progress-percent${item.userStatus === "Terminé" ? " is-completed" : ""}`}>
                            {chapterProgress}%
                          </span>
                        </div>
                        <div className="anime-collection-progress-row">
                          <small className="anime-collection-progress-label">
                            {item.volumesRead}/{item.volumesTotal || "?"} tomes
                          </small>
                          <div className={`anime-collection-progress anime-collection-progress-inline${item.userStatus === "Terminé" ? " is-completed" : ""}`}>
                            <div style={{ width: `${volumeProgress}%` }} />
                          </div>
                          <span className={`anime-collection-progress-percent${item.userStatus === "Terminé" ? " is-completed" : ""}`}>
                            {volumeProgress}%
                          </span>
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="anime-collection-double-progress">
                      <div className="anime-collection-progress-row">
                        <small className="anime-collection-progress-label">
                          {chapterRead}/{chapterTotal || "?"} ch.
                        </small>
                        <div className={`anime-collection-progress anime-collection-progress-small${item.userStatus === "Terminé" ? " is-completed" : ""}`}>
                          <div style={{ width: `${chapterProgress}%` }} />
                        </div>
                        <span className={`anime-collection-progress-percent anime-collection-progress-percent-small${item.userStatus === "Terminé" ? " is-completed" : ""}`}>
                          {chapterProgress}%
                        </span>
                      </div>
                      <div className="anime-collection-progress-row">
                        <small className="anime-collection-progress-label">
                          {item.volumesRead}/{item.volumesTotal || "?"} tomes
                        </small>
                        <div className={`anime-collection-progress anime-collection-progress-small${item.userStatus === "Terminé" ? " is-completed" : ""}`}>
                          <div style={{ width: `${volumeProgress}%` }} />
                        </div>
                        <span className={`anime-collection-progress-percent anime-collection-progress-percent-small${item.userStatus === "Terminé" ? " is-completed" : ""}`}>
                          {volumeProgress}%
                        </span>
                      </div>
                    </div>
                    <div className="anime-collection-title-row">
                      <Link
                        to={`/lectures/${item.malId}`}
                        onClick={(e) => {
                          e.preventDefault();
                          navigateToReadingDetail(item.malId);
                        }}
                        className="anime-collection-title-link"
                        title={item.title}
                      >
                        {item.title}
                      </Link>
                      {mihonUserBadges.length > 0 ? (
                        <div className="anime-collection-owners-inline" title={`Mihon: ${mihonUsers.join(", ")}`}>
                          {mihonUserBadges.map((badge, idx) => (
                            <span key={`${badge.name}-${idx}`} className="anime-collection-owner-chip">
                              <ProfileAvatarImage
                                size={18}
                                storagePath={badge.avatarPath}
                                displayName={badge.name}
                              />
                              <span>{badge.name}</span>
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </>
                )}
              </div>
              <>
                <button
                  type="button"
                  className={`anime-collection-more${viewMode === "list" ? " is-list" : ""}`}
                  onClick={(e) => {
                    const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
                    setMenuAnchorRect(rect);
                    setMenuOpenFor((prev) => (prev === item.malId ? null : item.malId));
                  }}
                >
                  ⋮
                </button>
                <PersonalStatusMenu
                  open={menuOpenFor === item.malId}
                  anchorRect={menuAnchorRect}
                  selected={item.userStatus}
                  favorite={item.favorite}
                  onClose={() => setMenuOpenFor(null)}
                  onSelect={(status) => updateUserStatus(item.malId, status)}
                  onToggleFavorite={() => void updateFavorite(item.malId)}
                  mihonEnabled={item.mihonEnabledByCurrentUser}
                  onToggleMihon={() => void toggleMihonEntry(item.malId)}
                  onDelete={() => void removeEntry(item.malId)}
                />
              </>
            </article>
          );
        })}
      </section>

      <section className="anime-collection-toolbar anime-collection-toolbar-bottom">
        <div>
          {pageStart}-{pageEnd} sur {filtered.length}
        </div>
        <div className="anime-collection-toolbar-right">
          <button type="button" className="anime-collection-page-btn" disabled={isUnlimited} onClick={() => setPage(1)}>
            «
          </button>
          <button
            type="button"
            className="anime-collection-page-btn"
            disabled={isUnlimited}
            onClick={() => setPage(Math.max(1, safePage - 1))}
          >
            ‹
          </button>
          <span>{isUnlimited ? "∞" : `${safePage}/${pageCount}`}</span>
          <button
            type="button"
            className="anime-collection-page-btn"
            disabled={isUnlimited}
            onClick={() => setPage(Math.min(pageCount, safePage + 1))}
          >
            ›
          </button>
          <button type="button" className="anime-collection-page-btn" disabled={isUnlimited} onClick={() => setPage(pageCount)}>
            »
          </button>
        </div>
      </section>

      <button type="button" className="anime-collection-scroll-up" onClick={scrollToFilters} title="Remonter aux filtres">
        ↑↑
      </button>

      <AddReadingModal open={addOpen} onClose={() => setAddOpen(false)} />
      
      <ResyncQueueModal
        open={resyncQueueOpen}
        onClose={handleResyncQueueClose}
        queue={resyncQueue}
        currentIndex={resyncQueueIndex}
        onNext={() => setResyncQueueIndex((prev) => Math.min(resyncQueue.length - 1, prev + 1))}
        onPrevious={() => setResyncQueueIndex((prev) => Math.max(0, prev - 1))}
        onApply={applyCurrentEntry}
        onSkip={skipCurrentEntry}
        onApplyAll={applyAllEntries}
        processing={resyncProcessing}
      />
    </div>
  );
}
