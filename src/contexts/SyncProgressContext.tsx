import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { getSupabaseClient } from "@/lib/supabaseClient";
import { appendClientLog } from "@/services/observability/clientLogService";
import { fetchIntegrationStatus } from "@/services/integrations/integrationService";
import {
  getAnimeSyncStatus,
  getReadingSyncStatus,
  type SyncStartOptions,
  startAnimeSync,
  startReadingSync,
  tickSyncWorker,
  type SyncRun,
  type SyncProgressRow,
  type SyncSource,
  type SyncMediaType,
} from "@/services/library/syncService";
import { useSyncProgressRealtime, type RealtimeProgressRow } from "@/hooks/useSyncProgressRealtime";

/** Polling lorsqu'une sync est en cours : 1,5 s pour un retour quasi-temps réel. */
const SYNC_POLL_ACTIVE_MS = 1_500;
const SYNC_POLL_IDLE_MS = 15_000;
/** 3 heures depuis la dernière complétion (pas depuis le démarrage). */
const AUTO_SYNC_INTERVAL_MS = 3 * 60 * 60 * 1000;
const AUTO_SYNC_CHECK_MS = 5 * 60 * 1000;

export type SyncProgressContextType = {
  animeActiveRun: SyncRun | null;
  animeStages: SyncProgressRow[];
  animeRecentRuns: SyncRun[];
  readingActiveRun: SyncRun | null;
  readingStages: SyncProgressRow[];
  readingRecentRuns: SyncRun[];
  loading: boolean;
  error: string | null;
  /** Séquence complète MAL → AniList complement pour un media type. */
  startFullSync: (mediaType: SyncMediaType) => Promise<void>;
  /** Sync sur une source unique (pour les pages détail). */
  startSingleSync: (
    mediaType: SyncMediaType,
    source: SyncSource,
    options?: SyncStartOptions
  ) => Promise<void>;
  refresh: () => Promise<void>;
  /**
   * Annule le run actif pour un media type.
   * Efface l'état local immédiatement (réponse UI instantanée) avant même le retour HTTP.
   */
  cancelRun: (mediaType: SyncMediaType) => Promise<void>;
  /** Shims de compatibilité pour les anciens consommateurs anime. */
  activeRun: SyncRun | null;
  recentRuns: SyncRun[];
  startSync: (source: SyncSource, options?: SyncStartOptions) => Promise<void>;
};

const SyncProgressContext = createContext<SyncProgressContextType | undefined>(undefined);

export function SyncProgressProvider({ children }: { children: ReactNode }) {
  const [animeActiveRun, setAnimeActiveRun] = useState<SyncRun | null>(null);
  const [animeStages, setAnimeStages] = useState<SyncProgressRow[]>([]);
  const [animeRecentRuns, setAnimeRecentRuns] = useState<SyncRun[]>([]);
  const [readingActiveRun, setReadingActiveRun] = useState<SyncRun | null>(null);
  const [readingStages, setReadingStages] = useState<SyncProgressRow[]>([]);
  const [readingRecentRuns, setReadingRecentRuns] = useState<SyncRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inFlightRef = useRef(false);
  const pendingLoadRef = useRef(false);
  const pollingRef = useRef<number | null>(null);

  /** Indique le media type qui attend le démarrage de la phase AniList après MAL. */
  const [pendingAnilistFor, setPendingAnilistFor] = useState<SyncMediaType | null>(null);
  const pendingAnilistRef = useRef<SyncMediaType | null>(null);

  /** Refs stables pour les closures de l'auto-sync (évite de recréer l'interval). */
  const animeRecentRunsRef = useRef(animeRecentRuns);
  const readingRecentRunsRef = useRef(readingRecentRuns);
  const animeActiveRunRef = useRef(animeActiveRun);
  const readingActiveRunRef = useRef(readingActiveRun);

  useEffect(() => {
    animeRecentRunsRef.current = animeRecentRuns;
  }, [animeRecentRuns]);
  useEffect(() => {
    readingRecentRunsRef.current = readingRecentRuns;
  }, [readingRecentRuns]);
  useEffect(() => {
    animeActiveRunRef.current = animeActiveRun;
  }, [animeActiveRun]);
  useEffect(() => {
    readingActiveRunRef.current = readingActiveRun;
  }, [readingActiveRun]);

  const load = useCallback(async () => {
    if (inFlightRef.current) {
      pendingLoadRef.current = true;
      return;
    }
    inFlightRef.current = true;
    try {
      do {
        pendingLoadRef.current = false;
        const supabase = getSupabaseClient();
        const [anime, reading] = await Promise.all([
          getAnimeSyncStatus(supabase),
          getReadingSyncStatus(supabase),
        ]);
        setAnimeActiveRun(anime.active_run);
        setAnimeStages(anime.active_progress);
        setAnimeRecentRuns(anime.recent_runs);
        setReadingActiveRun(reading.active_run);
        setReadingStages(reading.active_progress);
        setReadingRecentRuns(reading.recent_runs);
        setError(null);
      } while (pendingLoadRef.current);
    } catch (e) {
      pendingLoadRef.current = false;
      const message = e instanceof Error ? e.message : "Erreur synchronisation.";
      setError(message);
      appendClientLog("error", "sync.status", message);
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      await load();
    } finally {
      setLoading(false);
    }
  }, [load]);

  useEffect(() => {
    void load();
  }, [load]);

  const animeActive = Boolean(
    animeActiveRun &&
      (animeActiveRun.status === "queued" || animeActiveRun.status === "running")
  );
  const readingActive = Boolean(
    readingActiveRun &&
      (readingActiveRun.status === "queued" || readingActiveRun.status === "running")
  );
  const anyActive = animeActive || readingActive;

  /** Refs stables pour l'accès aux run IDs dans le callback Realtime (pas de re-subscribe). */
  const animeActiveRunIdRef = useRef<string | null>(null);
  const readingActiveRunIdRef = useRef<string | null>(null);
  useEffect(() => { animeActiveRunIdRef.current = animeActiveRun?.id ?? null; }, [animeActiveRun]);
  useEffect(() => { readingActiveRunIdRef.current = readingActiveRun?.id ?? null; }, [readingActiveRun]);

  /**
   * Mise à jour directe depuis le payload Realtime de `sync_progress`.
   * Aucun aller-retour HTTP — équivalent du push IPC de l'ancien projet Electron.
   */
  const handleProgressRow = useCallback((row: RealtimeProgressRow) => {
    const updateStages = (prev: SyncProgressRow[]): SyncProgressRow[] => {
      const idx = prev.findIndex((s) => s.stage === row.stage);
      const next = { ...row };
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = next;
        return updated;
      }
      return [...prev, next];
    };
    if (row.run_id === animeActiveRunIdRef.current) {
      setAnimeStages(updateStages);
    } else if (row.run_id === readingActiveRunIdRef.current) {
      setReadingStages(updateStages);
    }
  }, []);

  /** Canal Realtime unifié : progress → push direct, run → reload complet. */
  useSyncProgressRealtime(anyActive, handleProgressRow, load);

  /**
   * Polling :
   * - Actif : tick le worker toutes les 1,5 s + reload de cohérence toutes les 6 s
   *   (Realtime assure les updates intermédiaires, le reload garde les runs/recent en sync).
   * - Idle : reload toutes les 15 s pour détecter une sync auto.
   */
  const consistencyTickRef = useRef(0);
  useEffect(() => {
    if (pollingRef.current) {
      window.clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    consistencyTickRef.current = 0;
    pollingRef.current = window.setInterval(async () => {
      if (anyActive) {
        const supabase = getSupabaseClient();
        await tickSyncWorker(supabase).catch(() => undefined);
        consistencyTickRef.current += 1;
        // Reload complet toutes les 4 ticks (~6 s) pour garder les runs en cohérence
        if (consistencyTickRef.current % 4 === 0) {
          await load();
        }
      } else {
        await load();
      }
    }, anyActive ? SYNC_POLL_ACTIVE_MS : SYNC_POLL_IDLE_MS);
    return () => {
      if (pollingRef.current) {
        window.clearInterval(pollingRef.current);
      }
    };
  }, [anyActive, load]);

  const ensureProviderConnected = useCallback(async (source: SyncSource): Promise<boolean> => {
    const supabase = getSupabaseClient();
    const status = await fetchIntegrationStatus(supabase, source);
    return status.ok && status.status.connected;
  }, []);

  /**
   * Effet de chaînage : dès que la phase MAL est terminée et qu'une phase AniList
   * est en attente, on lance la sync AniList complement.
   * Le worker skip automatiquement les entrées AniList ayant un idMal (priorité MAL).
   */
  useEffect(() => {
    const pending = pendingAnilistFor;
    if (!pending) return;

    const run = pending === "anime" ? animeActiveRun : readingActiveRun;
    const malDone =
      !run || (run.status !== "queued" && run.status !== "running");
    if (!malDone) return;

    setPendingAnilistFor(null);
    pendingAnilistRef.current = null;

    void (async () => {
      const anilistConnected = await ensureProviderConnected("anilist");
      if (!anilistConnected) return;
      try {
        const supabase = getSupabaseClient();
        if (pending === "anime") {
          await startAnimeSync(supabase, "anilist");
        } else {
          await startReadingSync(supabase, "anilist");
        }
        await load();
        appendClientLog(
          "info",
          `sync.${pending}.anilist-complement`,
          "Phase AniList complement démarrée."
        );
      } catch (e) {
        const message = e instanceof Error ? e.message : "Erreur lancement AniList complement.";
        setError(message);
        appendClientLog("error", `sync.${pending}.anilist-complement`, message);
      }
    })();
  }, [animeActiveRun, readingActiveRun, pendingAnilistFor, ensureProviderConnected, load]);

  /**
   * Synchronisation complète : MAL d'abord (données prioritaires),
   * puis AniList complement une fois MAL terminé (entrées sans idMal uniquement).
   */
  const startFullSync = useCallback(
    async (mediaType: SyncMediaType) => {
      if (pendingAnilistRef.current === mediaType) return;
      const current =
        mediaType === "anime" ? animeActiveRunRef.current : readingActiveRunRef.current;
      if (current && (current.status === "queued" || current.status === "running")) return;

      setLoading(true);
      setError(null);
      try {
        const malConnected = await ensureProviderConnected("mal");
        const supabase = getSupabaseClient();

        if (malConnected) {
          if (mediaType === "anime") {
            await startAnimeSync(supabase, "mal");
          } else {
            await startReadingSync(supabase, "mal");
          }
          pendingAnilistRef.current = mediaType;
          setPendingAnilistFor(mediaType);
          await load();
          appendClientLog(
            "info",
            `sync.${mediaType}.full`,
            "Phase MAL démarrée ; AniList complement suivra automatiquement."
          );
        } else {
          const anilistConnected = await ensureProviderConnected("anilist");
          if (anilistConnected) {
            if (mediaType === "anime") {
              await startAnimeSync(supabase, "anilist");
            } else {
              await startReadingSync(supabase, "anilist");
            }
            await load();
          }
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : "Échec lancement synchronisation.";
        setError(message);
        appendClientLog("error", `sync.${mediaType}.full`, message);
      } finally {
        setLoading(false);
      }
    },
    [ensureProviderConnected, load]
  );

  const startFullSyncRef = useRef(startFullSync);
  useEffect(() => {
    startFullSyncRef.current = startFullSync;
  }, [startFullSync]);

  /** Sync sur une source unique (pages détail ou usage ponctuel). */
  const startSingleSync = useCallback(
    async (mediaType: SyncMediaType, source: SyncSource, options?: SyncStartOptions) => {
      const connected = await ensureProviderConnected(source);
      if (!connected) {
        const message = `Synchronisation ${source.toUpperCase()} ignorée : intégration non connectée.`;
        setError(message);
        appendClientLog("warn", `sync.${mediaType}.single`, message);
        return;
      }
      setLoading(true);
      try {
        const supabase = getSupabaseClient();
        if (mediaType === "anime") {
          await startAnimeSync(supabase, source, options);
        } else {
          await startReadingSync(supabase, source, options);
        }
        await load();
        setError(null);
      } catch (e) {
        const message = e instanceof Error ? e.message : "Échec lancement synchronisation.";
        setError(message);
        appendClientLog("error", `sync.${mediaType}.single`, message);
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [ensureProviderConnected, load]
  );

  /**
   * Auto-sync toutes les 3 heures.
   * Le compteur part de la DERNIÈRE COMPLÉTION (finished_at en base),
   * pas du dernier démarrage — évite les chevauchements.
   * Vérifié toutes les 5 min ; ne tourne pas si une sync est déjà active.
   */
  useEffect(() => {
    let autoSyncRunning = false;

    const tick = async () => {
      if (autoSyncRunning) return;
      if (pendingAnilistRef.current) return;
      const animeRunning =
        animeActiveRunRef.current?.status === "queued" ||
        animeActiveRunRef.current?.status === "running";
      const readingRunning =
        readingActiveRunRef.current?.status === "queued" ||
        readingActiveRunRef.current?.status === "running";
      if (animeRunning || readingRunning) return;

      const now = Date.now();
      const animeCompleted = animeRecentRunsRef.current.find((r) => r.status === "completed");
      const animeLastMs = animeCompleted?.finished_at
        ? new Date(animeCompleted.finished_at).getTime()
        : 0;
      const readingCompleted = readingRecentRunsRef.current.find((r) => r.status === "completed");
      const readingLastMs = readingCompleted?.finished_at
        ? new Date(readingCompleted.finished_at).getTime()
        : 0;

      if (now - animeLastMs >= AUTO_SYNC_INTERVAL_MS) {
        autoSyncRunning = true;
        try {
          await startFullSyncRef.current("anime");
        } catch {
          /* Ignore silencieusement (intégration non configurée, etc.) */
        } finally {
          autoSyncRunning = false;
        }
      } else if (now - readingLastMs >= AUTO_SYNC_INTERVAL_MS) {
        autoSyncRunning = true;
        try {
          await startFullSyncRef.current("reading");
        } catch {
          /* Ignore silencieusement */
        } finally {
          autoSyncRunning = false;
        }
      }
    };

    const id = window.setInterval(() => void tick(), AUTO_SYNC_CHECK_MS);
    return () => window.clearInterval(id);
  }, []); // Stable — utilise des refs

  /**
   * Annule le run actif : efface l'état local IMMÉDIATEMENT (réponse UI instantanée),
   * puis appelle l'API d'annulation en arrière-plan et rechargele statut.
   */
  const cancelRun = useCallback(
    async (mediaType: SyncMediaType) => {
      // Effacement optimiste : l'UI réagit sans attendre le réseau
      if (mediaType === "anime") {
        setAnimeActiveRun(null);
        setAnimeStages([]);
      } else {
        setReadingActiveRun(null);
        setReadingStages([]);
      }
      try {
        const supabase = getSupabaseClient();
        const { cancelActiveSyncRun } = await import("@/services/library/syncService");
        await cancelActiveSyncRun(supabase, mediaType);
      } catch {
        // En cas d'échec de l'API, le reload rétablira l'état réel
      }
      await load();
    },
    [load]
  );

  const value = useMemo<SyncProgressContextType>(
    () => ({
      animeActiveRun,
      animeStages,
      animeRecentRuns,
      readingActiveRun,
      readingStages,
      readingRecentRuns,
      loading,
      error,
      startFullSync,
      startSingleSync,
      refresh,
      cancelRun,
      /* Shims de rétrocompatibilité pour les anciens consommateurs anime */
      activeRun: animeActiveRun,
      recentRuns: animeRecentRuns,
      startSync: (source, options) => startSingleSync("anime", source, options),
    }),
    [
      animeActiveRun,
      animeStages,
      animeRecentRuns,
      readingActiveRun,
      readingStages,
      readingRecentRuns,
      loading,
      error,
      startFullSync,
      startSingleSync,
      refresh,
      cancelRun,
    ]
  );

  return <SyncProgressContext.Provider value={value}>{children}</SyncProgressContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useSyncProgress() {
  const ctx = useContext(SyncProgressContext);
  if (!ctx) {
    throw new Error("useSyncProgress doit être utilisé dans SyncProgressProvider.");
  }
  return ctx;
}
