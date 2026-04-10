import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AddReadingModal } from "@/features/library/AddReadingModal/AddReadingModal";
import { ToggleSwitch } from "@/components/common/ToggleSwitch";
import { PersonalStatusMenu, type StatusOption } from "@/components/library/PersonalStatusMenu";
import { ResyncQueueModal } from "@/components/modals/ResyncQueueModal/ResyncQueueModal";
import { useReadingSyncProgress } from "@/contexts/ReadingSyncProgressContext";
import { getSupabaseClient } from "@/lib/supabaseClient";
import { useSession } from "@/hooks/useSession";
import {
  fetchReadingCollection,
  updateReadingStatus,
  updateReadingFavorite,
  type ReadingCollectionEntry,
} from "@/services/library/readingCollectionService";
import {
  detectResyncChanges,
  applyResyncChanges,
  type ResyncQueueEntry,
} from "@/services/library/resyncQueueService";
import { proxyNautiljonImage } from "@/lib/imageProxy";
import {
  getMainScrollContainer,
  readMainScrollTop,
  writeMainScrollTop,
} from "@/lib/collectionScroll";
import "./LibraryPages.css";
import "./AnimeCollectionPage.css";

type ViewMode = "grid" | "list";
type UserStatus = "Planifié" | "En cours" | "En pause" | "Terminé" | "Abandonné";
type WorkStatus = "En cours" | "Terminé" | "Abandonné" | "À venir";
type SortMode = "az" | "za" | "recent" | "oldest" | "score-asc" | "score-desc";
type PageSizeValue = 25 | 50 | 100 | 250 | 500 | "all";

const SCROLL_KEY_GRID = "reading-collection:scroll-main:grid";
const SCROLL_KEY_LIST = "reading-collection:scroll-main:list";
const VIEW_MODE_KEY = "reading-collection:view-mode";
const NO_IMAGE_DATA_URI =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="340" viewBox="0 0 240 340"><rect width="100%" height="100%" fill="#1f2430"/><circle cx="120" cy="135" r="44" fill="#2f3647"/><path d="M68 250h104" stroke="#6f7a93" stroke-width="10" stroke-linecap="round"/><text x="120" y="290" fill="#9aa3b8" font-size="18" text-anchor="middle" font-family="Arial">No Image</text></svg>'
  );

function getScrollKey(mode: ViewMode): string {
  return mode === "list" ? SCROLL_KEY_LIST : SCROLL_KEY_GRID;
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

  const loadCollection = useCallback(async () => {
    setLoadingCollection(true);
    try {
      const supabase = getSupabaseClient();
      const rows = await fetchReadingCollection(supabase);
      setItems(rows);
      setCollectionError(null);
    } catch (e) {
      setCollectionError(e instanceof Error ? e.message : "Impossible de charger la collection.");
    } finally {
      setLoadingCollection(false);
    }
  }, []);

  useEffect(() => {
    void loadCollection();
  }, [loadCollection]);

  useEffect(() => {
    const container = getMainScrollContainer();
    const scrollKey = getScrollKey(viewMode);
    const handler = () => {
      const y = readMainScrollTop(container);
      sessionStorage.setItem(scrollKey, String(y));
    };
    if (container) {
      container.addEventListener("scroll", handler, { passive: true });
      return () => container.removeEventListener("scroll", handler);
    }
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, [viewMode]);

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
    const raw = sessionStorage.getItem(getScrollKey(viewMode));
    if (!raw) {
      return;
    }
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      return;
    }
    const restore = () => {
      const container = getMainScrollContainer();
      writeMainScrollTop(container, value);
    };
    // Restaurations multiples pour gérer le rendu asynchrone
    requestAnimationFrame(restore);
    const timeout1 = window.setTimeout(restore, 50);
    const timeout2 = window.setTimeout(restore, 150);
    const timeout3 = window.setTimeout(restore, 300);
    const timeout4 = window.setTimeout(restore, 500);
    return () => {
      window.clearTimeout(timeout1);
      window.clearTimeout(timeout2);
      window.clearTimeout(timeout3);
      window.clearTimeout(timeout4);
    };
  }, [viewMode, items.length]);

  const filtered = useMemo(() => {
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
  }, [favoriteOnly, genreFilter, items, query, showFamilyCollection, sortMode, tabType, themeFilter, userStatusFilter, workStatusFilter]);

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
    const readChapters = filtered.reduce((acc, x) => acc + x.chaptersRead, 0);
    const totalChapters = filtered.reduce((acc, x) => acc + x.chaptersTotal, 0);
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
  }, [filtered]);

  function resetFilters() {
    setQuery("");
    setSortMode("az");
    setUserStatusFilter("Tous");
    setWorkStatusFilter("Tous");
    setGenreFilter("Tous");
    setThemeFilter("Tous");
    setFavoriteOnly(false);
    setShowFamilyCollection(false);
    setPage(1);
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
          <button type="button" className="anime-collection-btn" onClick={() => void loadCollection()}>
            Recharger
          </button>
          <button
            type="button"
            className="anime-collection-btn"
            disabled={syncLoading || isSyncBusy}
            onClick={() => void onStartSync("mal")}
            title={isSyncBusy ? "Synchronisation en cours, merci d'attendre la fin." : "Lancer la synchronisation MAL"}
          >
            Sync MAL
          </button>
          <button
            type="button"
            className="anime-collection-btn"
            disabled={syncLoading || isSyncBusy}
            onClick={() => void onStartSync("anilist")}
            title={isSyncBusy ? "Synchronisation en cours, merci d'attendre la fin." : "Lancer la synchronisation AniList"}
          >
            Sync AniList
          </button>
          <button
            type="button"
            className="anime-collection-btn"
            disabled={detectingChanges}
            onClick={() => void detectChanges("mal")}
            title="Vérifier les modifications MAL/Jikan"
          >
            {detectingChanges ? "Détection..." : "Détecter changements"}
          </button>
          <button type="button" className="library-add-anime-btn" onClick={() => setAddOpen(true)}>
            + Ajouter une lecture
          </button>
        </div>
      </div>

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
        {pageSlice.map((item) => {
          const chapterProgress = percent(item.chaptersRead, item.chaptersTotal);
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
                const container = getMainScrollContainer();
                const y = readMainScrollTop(container);
                sessionStorage.setItem(getScrollKey(viewMode), String(y));
                navigate(`/lectures/${item.malId}`);
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
                const container = getMainScrollContainer();
                const y = readMainScrollTop(container);
                sessionStorage.setItem(getScrollKey(viewMode), String(y));
                navigate(`/lectures/${item.malId}`);
              }}
            >
              {item.favorite ? (
                <span className="anime-collection-favorite-badge" title="Entrée en favoris" aria-label="Favori">
                  ❤
                </span>
              ) : null}
              <Link
                to={`/lectures/${item.malId}`}
                onClick={() => {
                  const container = getMainScrollContainer();
                  const y = readMainScrollTop(container);
                  sessionStorage.setItem(getScrollKey(viewMode), String(y));
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
                        onClick={() => {
                          const container = getMainScrollContainer();
                          const y = readMainScrollTop(container);
                          sessionStorage.setItem(getScrollKey(viewMode), String(y));
                        }}
                        className="anime-collection-title-link"
                        title={item.title}
                      >
                        {item.title}
                      </Link>
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
                      <div className="anime-collection-double-progress anime-collection-double-progress-list">
                        <div className="anime-collection-progress-row">
                          <small className="anime-collection-progress-label">
                            {item.chaptersRead}/{item.chaptersTotal || "?"} ch.
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
                          {item.chaptersRead}/{item.chaptersTotal || "?"} ch.
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
                        onClick={() => {
                          const container = getMainScrollContainer();
                          const y = readMainScrollTop(container);
                          sessionStorage.setItem(getScrollKey(viewMode), String(y));
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
