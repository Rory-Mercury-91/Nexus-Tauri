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
  cancelActiveSyncRun,
  type SyncRun,
  type SyncProgressRow,
  type SyncSource,
  type SyncMediaType,
} from "@/services/library/syncService";
import { useSyncProgressRealtime, type RealtimeProgressRow } from "@/hooks/useSyncProgressRealtime";
import type { MihonImportProgress } from "@/services/library/mihonBackupImportService";

/** Polling lorsqu'une sync est en cours : 1,5 s pour un retour quasi-temps réel. */
const SYNC_POLL_ACTIVE_MS = 1_500;
/** Polling idle : recharge toutes les 15 s pour détecter les jobs créés côté serveur. */
const SYNC_POLL_IDLE_MS = 15_000;

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
  /** Import Mihon en cours (client-side uniquement, pas de sync_runs en DB). */
  mihonImportActive: boolean;
  mihonImportProgress: MihonImportProgress | null;
  setMihonImportState: (active: boolean, progress: MihonImportProgress | null) => void;
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
  const [mihonImportActive, setMihonImportActive] = useState(false);
  const [mihonImportProgress, setMihonImportProgress] = useState<MihonImportProgress | null>(null);

  const setMihonImportState = useCallback(
    (active: boolean, progress: MihonImportProgress | null) => {
      setMihonImportActive(active);
      setMihonImportProgress(progress);
    },
    []
  );

  const inFlightRef = useRef(false);
  const pendingLoadRef = useRef(false);
  const pollingRef = useRef<number | null>(null);

  /** Indique le media type qui attend le démarrage de la phase AniList après MAL. */
  const [pendingAnilistFor, setPendingAnilistFor] = useState<SyncMediaType | null>(null);
  const pendingAnilistRef = useRef<SyncMediaType | null>(null);
  /** run_id du run MAL qu'on attend avant de lancer AniList (évite la race condition). */
  const pendingMalRunIdRef = useRef<string | null>(null);

  /** Refs stables pour l'accès aux run actifs dans les closures sans re-render. */
  const animeActiveRunRef = useRef(animeActiveRun);
  const readingActiveRunRef = useRef(readingActiveRun);

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
   *
   * On traque le run_id du run MAL lancé (pendingMalRunIdRef) pour ne pas confondre
   * avec d'anciens runs terminés — ce qui causait une race condition où AniList
   * démarrait avant que MAL ait fini.
   */
  useEffect(() => {
    const pending = pendingAnilistFor;
    if (!pending) return;

    const targetRunId = pendingMalRunIdRef.current;
    const run = pending === "anime" ? animeActiveRun : readingActiveRun;
    const recentRuns = pending === "anime" ? animeRecentRuns : readingRecentRuns;

    let malDone: boolean;
    if (targetRunId) {
      if (run?.id === targetRunId) {
        // Le run MAL est encore actif — attendre
        malDone = run.status !== "queued" && run.status !== "running";
      } else {
        // Chercher dans l'historique récent : il y apparaît une fois terminé
        const targetRun = recentRuns.find((r) => r.id === targetRunId);
        malDone = targetRun
          ? targetRun.status !== "queued" && targetRun.status !== "running"
          : false; // Pas encore visible dans l'historique — attendre
      }
    } else {
      malDone = !run || (run.status !== "queued" && run.status !== "running");
    }
    if (!malDone) return;

    setPendingAnilistFor(null);
    pendingAnilistRef.current = null;
    pendingMalRunIdRef.current = null;

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
  }, [animeActiveRun, animeRecentRuns, readingActiveRun, readingRecentRuns, pendingAnilistFor, ensureProviderConnected, load]);

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
          const malResult = mediaType === "anime"
            ? await startAnimeSync(supabase, "mal")
            : await startReadingSync(supabase, "mal");
          pendingMalRunIdRef.current = malResult.run_id;
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
      mihonImportActive,
      mihonImportProgress,
      setMihonImportState,
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
      mihonImportActive,
      mihonImportProgress,
      setMihonImportState,
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
