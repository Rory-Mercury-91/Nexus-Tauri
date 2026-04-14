/**
 * Shim de compatibilité — délègue au contexte unifié SyncProgressContext.
 * Les anciens consommateurs (ReadingCollectionPage, ReadingDetailPage, AppShell…)
 * continuent de fonctionner sans modification des imports.
 */
import { useSyncProgress } from "@/contexts/SyncProgressContext";
import type { SyncStartOptions, SyncSource } from "@/services/library/syncService";

// eslint-disable-next-line react-refresh/only-export-components
export function useReadingSyncProgress() {
  const ctx = useSyncProgress();
  return {
    activeRun: ctx.readingActiveRun,
    stages: ctx.readingStages,
    recentRuns: ctx.readingRecentRuns,
    loading: ctx.loading,
    error: ctx.error,
    startSync: (source: SyncSource, options?: SyncStartOptions) =>
      ctx.startSingleSync("reading", source, options),
    refresh: ctx.refresh,
  };
}
