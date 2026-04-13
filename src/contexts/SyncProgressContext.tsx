import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getSupabaseClient } from "@/lib/supabaseClient";
import { appendClientLog } from "@/services/observability/clientLogService";
import { fetchIntegrationStatus } from "@/services/integrations/integrationService";
import {
  getAnimeSyncStatus,
  type SyncStartOptions,
  startAnimeSync,
  tickAnimeSyncWorker,
  type SyncRun,
  type SyncProgressRow,
  type SyncSource,
} from "@/services/library/syncService";
import { useSyncProgressRealtime } from "@/hooks/useSyncProgressRealtime";

const SYNC_POLL_ACTIVE_MS = 750;
const SYNC_POLL_IDLE_MS = 10_000;

type SyncProgressContextType = {
  activeRun: SyncRun | null;
  stages: SyncProgressRow[];
  recentRuns: SyncRun[];
  loading: boolean;
  error: string | null;
  startSync: (source: SyncSource, options?: SyncStartOptions) => Promise<void>;
  refresh: () => Promise<void>;
};

const SyncProgressContext = createContext<SyncProgressContextType | undefined>(undefined);
const AUTO_SYNC_MAL_KEY = "sync:auto:last-run:anime:mal";
const AUTO_SYNC_ANILIST_KEY = "sync:auto:last-run:anime:anilist";
const AUTO_SYNC_INTERVAL_MS = 60 * 60 * 1000;
const AUTO_SYNC_CHECK_MS = 60 * 1000;

export function SyncProgressProvider({ children }: { children: ReactNode }) {
  const [activeRun, setActiveRun] = useState<SyncRun | null>(null);
  const [stages, setStages] = useState<SyncProgressRow[]>([]);
  const [recentRuns, setRecentRuns] = useState<SyncRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollingRef = useRef<number | null>(null);
  const inFlightRef = useRef(false);
  const pendingLoadRef = useRef(false);

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
        const status = await getAnimeSyncStatus(supabase);
        setActiveRun(status.active_run);
        setStages(status.active_progress);
        setRecentRuns(status.recent_runs);
        setError(null);
      } while (pendingLoadRef.current);
    } catch (e) {
      pendingLoadRef.current = false;
      const message = e instanceof Error ? e.message : "Erreur synchronisation.";
      setError(message);
      appendClientLog("error", "sync.anime.status", message);
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

  const ensureProviderConnected = useCallback(async (source: SyncSource): Promise<boolean> => {
    const supabase = getSupabaseClient();
    const status = await fetchIntegrationStatus(supabase, source);
    if (!status.ok) {
      const message = `Impossible de vérifier la connexion ${source.toUpperCase()}: ${status.error}`;
      setError(message);
      appendClientLog("warn", "sync.anime.provider-check", message);
      return false;
    }
    if (!status.status.connected) {
      const message = `Synchronisation ${source.toUpperCase()} ignorée: intégration non connectée.`;
      setError(message);
      appendClientLog("info", "sync.anime.provider-check", message);
      return false;
    }
    return true;
  }, []);

  const startSync = useCallback(async (source: SyncSource, options?: SyncStartOptions) => {
    const supabase = getSupabaseClient();
    setLoading(true);
    try {
      const connected = await ensureProviderConnected(source);
      if (!connected) {
        return;
      }
      await startAnimeSync(supabase, source, options);
      await load();
      setError(null);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Échec lancement synchronisation.";
      setError(message);
      appendClientLog("error", "sync.anime.start", message);
      throw e;
    } finally {
      setLoading(false);
    }
  }, [ensureProviderConnected, load]);

  useEffect(() => {
    void load();
  }, [load]);

  const syncActive = Boolean(
    activeRun && (activeRun.status === "queued" || activeRun.status === "running")
  );
  useSyncProgressRealtime("anime", syncActive, load);

  useEffect(() => {
    if (pollingRef.current) {
      window.clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    pollingRef.current = window.setInterval(async () => {
      const supabase = getSupabaseClient();
      if (activeRun && (activeRun.status === "queued" || activeRun.status === "running")) {
        // Fallback local: avance le worker si le cron n'est pas encore configuré.
        await tickAnimeSyncWorker(supabase).catch(() => undefined);
      }
      await load();
    }, activeRun ? SYNC_POLL_ACTIVE_MS : SYNC_POLL_IDLE_MS);
    return () => {
      if (pollingRef.current) {
        window.clearInterval(pollingRef.current);
      }
    };
  }, [activeRun, load]);

  useEffect(() => {
    let inFlight = false;
    const tick = async () => {
      if (inFlight) {
        return;
      }
      if (activeRun && (activeRun.status === "queued" || activeRun.status === "running")) {
        return;
      }
      const now = Date.now();
      const dueSources: SyncSource[] = [];
      const malMs = Number(localStorage.getItem(AUTO_SYNC_MAL_KEY) ?? 0);
      const anilistMs = Number(localStorage.getItem(AUTO_SYNC_ANILIST_KEY) ?? 0);
      if (!Number.isFinite(malMs) || now - malMs >= AUTO_SYNC_INTERVAL_MS) {
        dueSources.push("mal");
      }
      if (!Number.isFinite(anilistMs) || now - anilistMs >= AUTO_SYNC_INTERVAL_MS) {
        dueSources.push("anilist");
      }
      if (dueSources.length === 0) {
        return;
      }
      inFlight = true;
      try {
        for (const source of dueSources) {
          try {
            await startSync(source);
            const key = source === "mal" ? AUTO_SYNC_MAL_KEY : AUTO_SYNC_ANILIST_KEY;
            localStorage.setItem(key, String(Date.now()));
          } catch {
            // Ignore silencieusement (intégration potentiellement non configurée).
          }
        }
      } finally {
        inFlight = false;
      }
    };
    const id = window.setInterval(() => {
      void tick();
    }, AUTO_SYNC_CHECK_MS);
    void tick();
    return () => window.clearInterval(id);
  }, [activeRun, startSync]);

  const value = useMemo<SyncProgressContextType>(
    () => ({ activeRun, stages, recentRuns, loading, error, startSync, refresh }),
    [activeRun, stages, recentRuns, loading, error, startSync, refresh]
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
