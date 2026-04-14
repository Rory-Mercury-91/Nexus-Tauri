import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { AddAnimeModal } from "@/features/library/AddAnimeModal/AddAnimeModal";
import { ToggleSwitch } from "@/components/common/ToggleSwitch";
import { PersonalStatusMenu, type StatusOption } from "@/components/library/PersonalStatusMenu";
import { notifyToast } from "@/lib/toastEvents";
import { getSupabaseClient } from "@/lib/supabaseClient";
import {
  fetchAnimeCollection,
  fetchAnimeCollectionStamp,
  deleteAnimeEntry,
  updateAnimeFavorite,
  updateAnimeWatchStatus,
  type AnimeCollectionEntry,
} from "@/services/library/animeCollectionService";
import {
  isSameCollectionStamp,
  readCachedCollection,
  writeCachedCollection,
} from "@/services/library/collectionCacheService";
import {
  getMainScrollContainer,
  readMainScrollTop,
  writeMainScrollTop,
} from "@/lib/collectionScroll";
import "./LibraryPages.css";
import "./AnimeCollectionPage.css";

type ViewMode = "grid" | "list";
type CollectionRestoreState = {
  fromDetailCollection?: "anime";
  restoreScrollY?: number;
  collectionViewMode?: ViewMode;
};
type UserStatus = "Planifié" | "En cours" | "En pause" | "Terminé" | "Abandonné";
type WorkStatus = "En cours" | "Terminé" | "Abandonné" | "À venir";
type SortMode =
  | "az"
  | "za"
  | "recent"
  | "oldest"
  | "score-asc"
  | "score-desc";
type PageSizeValue = 25 | 50 | 100 | 250 | 500 | "all";

type AnimeItem = AnimeCollectionEntry;

const SCROLL_KEY_GRID = "anime-collection:scroll-main:grid";
const SCROLL_KEY_LIST = "anime-collection:scroll-main:list";
const RETURN_TO_COLLECTION_KEY = "app:scroll:return-to-collection";
const VIEW_MODE_KEY = "anime-collection:view-mode";
const GROUP_MODE_KEY = "anime-collection:group-mode";
const USER_STATUS_ORDER: UserStatus[] = ["Planifié", "En cours", "En pause", "Terminé", "Abandonné"];
const WORK_STATUS_ORDER: WorkStatus[] = ["En cours", "Terminé", "Abandonné", "À venir"];
const ANIME_COLLECTION_CACHE_KEY = "library:anime:collection:cache:v1";


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

function getScrollKey(mode: ViewMode): string {
  return mode === "list" ? SCROLL_KEY_LIST : SCROLL_KEY_GRID;
}

function markReturnToAnimeCollection(): void {
  sessionStorage.setItem(RETURN_TO_COLLECTION_KEY, "anime");
}

function buildAnimeDetailState(scrollY: number, mode: ViewMode) {
  return {
    fromCollection: "anime" as const,
    collectionScrollY: scrollY,
    collectionViewMode: mode,
  };
}

function aggregateUserStatus(items: AnimeItem[]): UserStatus {
  if (items.some((item) => item.userStatus === "En cours")) return "En cours";
  if (items.some((item) => item.userStatus === "En pause")) return "En pause";
  if (items.every((item) => item.userStatus === "Terminé")) return "Terminé";
  if (items.some((item) => item.userStatus === "Abandonné")) return "Abandonné";
  return "Planifié";
}

function aggregateWorkStatus(items: AnimeItem[]): WorkStatus {
  if (items.some((item) => item.workStatus === "En cours")) return "En cours";
  if (items.some((item) => item.workStatus === "À venir")) return "À venir";
  if (items.some((item) => item.workStatus === "Abandonné")) return "Abandonné";
  return "Terminé";
}

function buildGroupedAnimeItems(items: AnimeItem[]): AnimeItem[] {
  const byId = new Map<number, AnimeItem>();
  items.forEach((item) => byId.set(item.malId, item));
  const parent = new Map<number, number>();
  const find = (x: number): number => {
    const p = parent.get(x) ?? x;
    if (p === x) return x;
    const r = find(p);
    parent.set(x, r);
    return r;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  byId.forEach((_, id) => parent.set(id, id));
  byId.forEach((item, id) => {
    item.relatedAnimeIds.forEach((relId) => {
      if (byId.has(relId)) union(id, relId);
    });
  });
  const groups = new Map<number, AnimeItem[]>();
  byId.forEach((item, id) => {
    const root = find(id);
    const list = groups.get(root) ?? [];
    list.push(item);
    groups.set(root, list);
  });
  return Array.from(groups.values()).map((group) => {
    const main =
      group.find((item) => item.userStatus === "En cours") ??
      group.find((item) => item.userStatus === "Terminé") ??
      group[0];
    const episodesSeen = group.reduce((acc, item) => acc + item.episodesSeen, 0);
    const episodesTotal = group.reduce((acc, item) => acc + item.episodesTotal, 0);
    const scoreAvg = group.reduce((acc, item) => acc + item.score, 0) / Math.max(1, group.length);
    const genres = Array.from(new Set(group.flatMap((item) => item.genres)));
    const themes = Array.from(new Set(group.flatMap((item) => item.themes)));
    const relatedAnimeIds = Array.from(new Set(group.flatMap((item) => item.relatedAnimeIds)));
    const latestAddedAt =
      group
        .map((item) => item.addedAt)
        .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? main.addedAt;
    return {
      ...main,
      title: group.length > 1 ? `${main.title} (${group.length})` : main.title,
      favorite: group.some((item) => item.favorite),
      userStatus: aggregateUserStatus(group),
      workStatus: aggregateWorkStatus(group),
      episodesSeen,
      episodesTotal,
      score: Number.isFinite(scoreAvg) ? scoreAvg : main.score,
      genres,
      themes,
      relatedAnimeIds,
      addedAt: latestAddedAt,
    };
  });
}


export function AnimeCollectionPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [addOpen, setAddOpen] = useState(false);
  const [items, setItems] = useState<AnimeItem[]>([]);
  const [loadingCollection, setLoadingCollection] = useState(false);
  const [collectionError, setCollectionError] = useState<string | null>(null);
  const [tabType, setTabType] = useState<string>("Tous");
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("az");
  const [userStatusFilter, setUserStatusFilter] = useState<string>("Tous");
  const [workStatusFilter, setWorkStatusFilter] = useState<string>("Tous");
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [genreFilter, setGenreFilter] = useState<string>("Tous");
  const [themeFilter, setThemeFilter] = useState<string>("Tous");
  const [groupMode, setGroupMode] = useState<boolean>(() => localStorage.getItem(GROUP_MODE_KEY) === "1");
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const saved = localStorage.getItem(VIEW_MODE_KEY);
    return saved === "list" ? "list" : "grid";
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSizeValue>(25);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  
  const [menuOpenFor, setMenuOpenFor] = useState<number | null>(null);
  const [menuAnchorRect, setMenuAnchorRect] = useState<DOMRect | null>(null);
  const filterRef = useRef<HTMLDivElement | null>(null);
  const lazySentinelRef = useRef<HTMLDivElement | null>(null);
  const [lazyVisibleCount, setLazyVisibleCount] = useState(30);
  const sourceItems = useMemo(() => (groupMode ? buildGroupedAnimeItems(items) : items), [groupMode, items]);
  const types = useMemo(() => {
    const counts = new Map<string, number>();
    sourceItems.forEach((item) => counts.set(item.type, (counts.get(item.type) ?? 0) + 1));
    return [
      { type: "Tous", count: sourceItems.length },
      ...Array.from(counts.entries())
        .filter(([, count]) => count > 0)
        .map(([type, count]) => ({ type, count })),
    ];
  }, [sourceItems]);

  const availableGenres = useMemo(
    () => ["Tous", ...Array.from(new Set(sourceItems.flatMap((x) => x.genres))).sort((a, b) => a.localeCompare(b))],
    [sourceItems]
  );
  const availableThemes = useMemo(
    () => ["Tous", ...Array.from(new Set(sourceItems.flatMap((x) => x.themes))).sort((a, b) => a.localeCompare(b))],
    [sourceItems]
  );

  const loadCollection = useCallback(async (forceRefresh = false) => {
    setLoadingCollection(true);
    try {
      const supabase = getSupabaseClient();
      const remoteStamp = await fetchAnimeCollectionStamp(supabase);
      const cached = readCachedCollection<AnimeItem>(ANIME_COLLECTION_CACHE_KEY);
      if (!forceRefresh && cached && isSameCollectionStamp(cached.stamp, remoteStamp)) {
        setItems(cached.items);
        setCollectionError(null);
        return;
      }
      const rows = await fetchAnimeCollection(supabase);
      setItems(rows);
      writeCachedCollection(ANIME_COLLECTION_CACHE_KEY, rows, remoteStamp);
      setCollectionError(null);
    } catch (e) {
      setCollectionError(e instanceof Error ? e.message : "Impossible de charger la collection.");
    } finally {
      setLoadingCollection(false);
    }
  }, []);
  
  useEffect(() => {
    const cached = readCachedCollection<AnimeItem>(ANIME_COLLECTION_CACHE_KEY);
    if (cached) {
      setItems(cached.items);
    }
    void loadCollection(false);
  }, [loadCollection]);


  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    let base = sourceItems.filter((item) => {
      if (tabType !== "Tous" && item.type !== tabType) {
        return false;
      }
      if (favoriteOnly && !item.favorite) {
        return false;
      }
      if (userStatusFilter !== "Tous" && item.userStatus !== userStatusFilter) {
        return false;
      }
      if (workStatusFilter !== "Tous" && item.workStatus !== workStatusFilter) {
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
  }, [
    favoriteOnly,
    genreFilter,
    sourceItems,
    query,
    sortMode,
    tabType,
    themeFilter,
    userStatusFilter,
    workStatusFilter,
  ]);

  const availableUserStatuses = useMemo(
    () => USER_STATUS_ORDER.filter((status) => sourceItems.some((item) => item.userStatus === status)),
    [sourceItems]
  );
  const availableWorkStatuses = useMemo(
    () => WORK_STATUS_ORDER.filter((status) => sourceItems.some((item) => item.workStatus === status)),
    [sourceItems]
  );

  useEffect(() => {
    if (userStatusFilter !== "Tous" && !availableUserStatuses.includes(userStatusFilter as UserStatus)) {
      setUserStatusFilter("Tous");
    }
  }, [availableUserStatuses, userStatusFilter]);

  useEffect(() => {
    if (workStatusFilter !== "Tous" && !availableWorkStatuses.includes(workStatusFilter as WorkStatus)) {
      setWorkStatusFilter("Tous");
    }
  }, [availableWorkStatuses, workStatusFilter]);

  const isUnlimited = pageSize === "all";
  const pageCount = isUnlimited ? 1 : Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pageSlice = useMemo<AnimeItem[]>(() => {
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

  useEffect(() => {
    setLazyVisibleCount(30);
  }, [page, pageSize, query, tabType, sortMode, userStatusFilter, workStatusFilter, genreFilter, themeFilter, favoriteOnly, groupMode]);

  useEffect(() => {
    localStorage.setItem(VIEW_MODE_KEY, viewMode);
  }, [viewMode]);
  useEffect(() => {
    localStorage.setItem(GROUP_MODE_KEY, groupMode ? "1" : "0");
  }, [groupMode]);
  useEffect(() => {
    if (groupMode) {
      setMenuOpenFor(null);
    }
  }, [groupMode]);

  useEffect(() => {
    const node = lazySentinelRef.current;
    if (!node) {
      return;
    }
    const root = getMainScrollContainer();
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) {
          return;
        }
        setLazyVisibleCount((prev) => Math.min(prev + 30, pageSlice.length));
      },
      { root, rootMargin: "200px 0px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [pageSlice.length]);

  const renderedItems = useMemo(
    () => pageSlice.slice(0, Math.min(lazyVisibleCount, pageSlice.length)),
    [lazyVisibleCount, pageSlice]
  );
  useEffect(() => {
    if (location.pathname !== "/anime") return;
    const routeState = (location.state as CollectionRestoreState | null) ?? null;
    const fromBackState =
      routeState?.fromDetailCollection === "anime" &&
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
  const pageStart = filtered.length === 0 ? 0 : isUnlimited ? 1 : (safePage - 1) * pageSize + 1;
  const pageEnd = filtered.length === 0 ? 0 : isUnlimited ? renderedItems.length : Math.min(filtered.length, safePage * pageSize);

  const stats = useMemo(() => {
    const watching = filtered.filter((x) => x.userStatus === "En cours").length;
    const completed = filtered.filter((x) => x.userStatus === "Terminé").length;
    const seen = filtered.reduce((acc, x) => acc + x.episodesSeen, 0);
    const total = filtered.reduce((acc, x) => acc + x.episodesTotal, 0);
    return {
      watching,
      completed,
      seen,
      total,
      ratio: percent(seen, total),
    };
  }, [filtered]);

  function resetFilters() {
    setQuery("");
    setSortMode("az");
    setUserStatusFilter("Tous");
    setWorkStatusFilter("Tous");
    setFavoriteOnly(false);
    setGenreFilter("Tous");
    setThemeFilter("Tous");
    setPage(1);
  }

  function scrollToFilters() {
    if (!filterRef.current) {
      return;
    }
    filterRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function updateUserStatus(itemId: number, status: StatusOption) {
    const target = items.find((entry) => entry.malId === itemId);
    if (!target) {
      return;
    }
    setItems((prev) => prev.map((item) => (item.malId === itemId ? { ...item, userStatus: status } : item)));
    try {
      const supabase = getSupabaseClient();
      await updateAnimeWatchStatus(supabase, target.id, status);
    } catch {
      // Annule localement en cas d'erreur DB.
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
      await updateAnimeFavorite(supabase, target.id, nextValue);
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
      await deleteAnimeEntry(supabase, target.id);
      setItems((prev) => prev.filter((entry) => entry.id !== target.id));
    } catch (error) {
      setCollectionError(
        error instanceof Error ? error.message : "Suppression impossible."
      );
    }
  }

  function navigateToAnimeDetail(malId: number) {
    const container = getMainScrollContainer();
    const y = readMainScrollTop(container);
    sessionStorage.setItem(getScrollKey(viewMode), String(y));
    markReturnToAnimeCollection();
    navigate(`/anime/${malId}`, {
      state: buildAnimeDetailState(y, viewMode),
    });
  }

  return (
    <div className="library-page anime-collection-page">
      <div className="anime-collection-head">
        <h1 className="library-page-title anime-collection-title">Collection Animés</h1>
        <div className="anime-collection-head-actions">
          <button type="button" className="anime-collection-btn" onClick={() => void loadCollection(true)}>
            Recharger
          </button>
          <button type="button" className="library-add-anime-btn" onClick={() => setAddOpen(true)}>
            + Ajouter un animé
          </button>
        </div>
      </div>

      {loadingCollection ? (
        <div className="anime-collection-loading-overlay">
          <div className="anime-collection-loading-spinner">
            <div className="spinner"></div>
            <p>Chargement de la collection…</p>
          </div>
        </div>
      ) : null}

      {collectionError ? <p className="library-page-lead">{collectionError}</p> : null}

      <div className="anime-collection-tabs" role="tablist" aria-label="Types d'animés">
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
          <strong>🎬 Animés :</strong>
          <span className="anime-collection-stats-watching">{stats.watching} animés en cours</span>
          <span className="anime-collection-stats-sep">|</span>
          <span className="anime-collection-stats-completed">{stats.completed} animés terminés</span>
          <span className="anime-collection-stats-sep">|</span>
          <span className="anime-collection-stats-seen">
            {stats.seen}/{stats.total} épisodes vus
          </span>
          <span className="anime-collection-stats-sep">|</span>
          <span className="anime-collection-stats-ratio">{stats.ratio}%</span>
        </div>
      </section>

      <section ref={filterRef} className="anime-collection-filters">
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
          <button
            type="button"
            className="anime-collection-help-btn"
            aria-label="Aide filtres"
            onClick={() => setIsHelpOpen(true)}
          >
            ?
          </button>
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
            <span>Statut de visionnage</span>
            <select value={userStatusFilter} onChange={(e) => setUserStatusFilter(e.target.value)}>
              <option>Tous</option>
              {availableUserStatuses.map((status) => (
                <option key={status}>{status}</option>
              ))}
            </select>
          </label>

          <label className="anime-collection-filter-field">
            <span>Statut de l'oeuvre</span>
            <select value={workStatusFilter} onChange={(e) => setWorkStatusFilter(e.target.value)}>
              <option>Tous</option>
              {availableWorkStatuses.map((status) => (
                <option key={status}>{status}</option>
              ))}
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

          <div className="anime-collection-filter-field anime-collection-filter-field-toggle">
            <span>Affichage</span>
            <ToggleSwitch
              checked={favoriteOnly}
              onChange={(checked) => {
                setFavoriteOnly(checked);
                setPage(1);
              }}
              label="Favoris uniquement"
            />
            <ToggleSwitch
              checked={groupMode}
              onChange={(checked) => {
                setGroupMode(checked);
                setPage(1);
              }}
              label="Regrouper préquelles/suites"
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
        {renderedItems.map((item) => {
          const progress = percent(item.episodesSeen, item.episodesTotal);
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
                navigateToAnimeDetail(item.malId);
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
                navigateToAnimeDetail(item.malId);
              }}
            >
              {item.favorite ? (
                <span className="anime-collection-favorite-badge" title="Entrée en favoris" aria-label="Favori">
                  ❤
                </span>
              ) : null}
              <Link
                to={`/anime/${item.malId}`}
                onClick={(e) => {
                  e.preventDefault();
                  navigateToAnimeDetail(item.malId);
                }}
                className="anime-collection-cover-link"
              >
                <img src={item.imageUrl} alt={item.title} className="anime-collection-cover" loading="lazy" />
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
                      {viewMode === "list" && item.favorite ? (
                        <span className="anime-collection-title-favorite" title="Entrée en favoris" aria-label="Favori">
                          ❤
                        </span>
                      ) : null}
                      <Link
                        to={`/anime/${item.malId}`}
                        onClick={(e) => {
                          e.preventDefault();
                          navigateToAnimeDetail(item.malId);
                        }}
                        className="anime-collection-title-link"
                        title={item.title}
                      >
                        {item.title}
                      </Link>
                    </div>
                    <div className="anime-collection-list-line2">
                      <small className="anime-collection-progress-meta">
                        <span>
                          {item.episodesSeen}/{item.episodesTotal} épisodes vus
                        </span>
                      </small>
                      <div className="anime-collection-status-row">
                        <span className={`anime-collection-status anime-collection-status-${userStatusClass(item.userStatus)}`}>
                          {item.userStatus}
                        </span>
                        {item.workStatus !== item.userStatus ? (
                          <span className={`anime-collection-status anime-collection-work-status anime-collection-work-status-${workStatusClass(item.workStatus)}`}>
                            {item.workStatus}
                          </span>
                        ) : null}
                      </div>
                      <div className={`anime-collection-progress anime-collection-progress-inline${item.userStatus === "Terminé" ? " is-completed" : ""}`}>
                        <div style={{ width: `${progress}%` }} />
                      </div>
                      <span
                        className={`anime-collection-progress-percent${
                          item.userStatus === "Terminé" ? " is-completed" : ""
                        }`}
                      >
                        {progress}%
                      </span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className={`anime-collection-progress${item.userStatus === "Terminé" ? " is-completed" : ""}`}>
                      <div style={{ width: `${progress}%` }} />
                    </div>
                    <small className="anime-collection-progress-meta">
                      <span>
                        {item.episodesSeen}/{item.episodesTotal} épisodes vus
                      </span>
                      <span
                        className={`anime-collection-progress-percent${
                          item.userStatus === "Terminé" ? " is-completed" : ""
                        }`}
                      >
                        {progress}%
                      </span>
                    </small>
                    <div className="anime-collection-title-row">
                      <Link
                        to={`/anime/${item.malId}`}
                        onClick={(e) => {
                          e.preventDefault();
                          navigateToAnimeDetail(item.malId);
                        }}
                        className="anime-collection-title-link"
                        title={item.title}
                      >
                        {item.title}
                      </Link>
                    </div>
                  </>
                )}
              </div>
              {groupMode ? null : (
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
                  onDelete={() => void removeEntry(item.malId)}
                  />
                </>
              )}
            </article>
          );
        })}
      </section>
      {renderedItems.length < pageSlice.length ? <div ref={lazySentinelRef} className="anime-collection-lazy-sentinel" /> : null}

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

      <AddAnimeModal open={addOpen} onClose={() => setAddOpen(false)} />

      {isHelpOpen ? (
        <div className="anime-collection-help-backdrop" role="presentation" onMouseDown={() => setIsHelpOpen(false)}>
          <div className="anime-collection-help-modal" onMouseDown={(e) => e.stopPropagation()}>
            <h3>Aide - Recherche et filtres Animés</h3>
            <p>
              Recherche par titre ou MAL ID. Les filtres Genre/Thème sont appliqués en mode AND.
              Le tri change l’ordre d’affichage, sans perdre tes filtres.
            </p>
            <ul>
              <li>A-Z / Z-A : ordre alphabétique</li>
              <li>Ajout récent / ancien : date d’ajout</li>
              <li>Score ascendant / descendant : notation personnelle</li>
              <li>Statut de visionnage : état personnel</li>
              <li>Statut de l’œuvre : état de diffusion de l’animé</li>
            </ul>
            <button type="button" className="anime-collection-btn" onClick={() => setIsHelpOpen(false)}>
              Fermer
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
