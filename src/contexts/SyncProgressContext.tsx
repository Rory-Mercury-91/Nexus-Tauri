import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getSupabaseClient } from "@/lib/supabaseClient";
import {
  getAnimeSyncStatus,
  type SyncStartOptions,
  startAnimeSync,
  tickAnimeSyncWorker,
  type SyncRun,
  type SyncProgressRow,
  type SyncSource,
} from "@/services/library/syncService";

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

export function SyncProgressProvider({ children }: { children: ReactNode }) {
  const [activeRun, setActiveRun] = useState<SyncRun | null>(null);
  const [stages, setStages] = useState<SyncProgressRow[]>([]);
  const [recentRuns, setRecentRuns] = useState<SyncRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollingRef = useRef<number | null>(null);
  const inFlightRef = useRef(false);

  const load = useCallback(async () => {
    if (inFlightRef.current) {
      return;
    }
    inFlightRef.current = true;
    try {
      const supabase = getSupabaseClient();
      const status = await getAnimeSyncStatus(supabase);
      setActiveRun(status.active_run);
      setStages(status.active_progress);
      setRecentRuns(status.recent_runs);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur synchronisation.");
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

  const startSync = useCallback(async (source: SyncSource, options?: SyncStartOptions) => {
    const supabase = getSupabaseClient();
    setLoading(true);
    try {
      await startAnimeSync(supabase, source, options);
      await load();
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Échec lancement synchronisation.");
      throw e;
    } finally {
      setLoading(false);
    }
  }, [load]);

  useEffect(() => {
    void load();
  }, [load]);

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
    }, activeRun ? 3000 : 10000);
    return () => {
      if (pollingRef.current) {
        window.clearInterval(pollingRef.current);
      }
    };
  }, [activeRun, load]);

  const value = useMemo<SyncProgressContextType>(
    () => ({ activeRun, stages, recentRuns, loading, error, startSync, refresh }),
    [activeRun, stages, recentRuns, loading, error, startSync, refresh]
  );

  return <SyncProgressContext.Provider value={value}>{children}</SyncProgressContext.Provider>;
}

export function useSyncProgress() {
  const ctx = useContext(SyncProgressContext);
  if (!ctx) {
    throw new Error("useSyncProgress doit être utilisé dans SyncProgressProvider.");
  }
  return ctx;
}
