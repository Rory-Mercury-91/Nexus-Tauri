import { useEffect, useRef } from "react";
import type { RealtimeChannel, RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { getSupabaseClient } from "@/lib/supabaseClient";
import type { SyncProgressRow } from "@/services/library/syncService";

/** Row telle que reçue par Realtime (inclut run_id/user_id absents du type public). */
export type RealtimeProgressRow = SyncProgressRow & { run_id: string; user_id: string };

const RUN_DEBOUNCE_MS = 200;

/**
 * Abonnement Realtime unifié pour `sync_runs` et `sync_progress`.
 *
 * - `sync_progress` → payload.new envoyé directement à `onProgressRow` (0 aller-retour HTTP)
 * - `sync_runs`     → déclenche `onRunChange` (rechargement complet pour les transitions d'état)
 *
 * Nécessite que les tables soient dans `supabase_realtime` (voir `supabase/realtime_sync_tables.sql`).
 */
export function useSyncProgressRealtime(
  enabled: boolean,
  onProgressRow: (row: RealtimeProgressRow) => void,
  onRunChange: () => void | Promise<void>
): void {
  const onProgressRef = useRef(onProgressRow);
  const onRunChangeRef = useRef(onRunChange);
  const runDebounceRef = useRef<number | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);

  useEffect(() => { onProgressRef.current = onProgressRow; }, [onProgressRow]);
  useEffect(() => { onRunChangeRef.current = onRunChange; }, [onRunChange]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const scheduleRunChange = () => {
      if (runDebounceRef.current !== null) {
        window.clearTimeout(runDebounceRef.current);
      }
      runDebounceRef.current = window.setTimeout(() => {
        runDebounceRef.current = null;
        void onRunChangeRef.current();
      }, RUN_DEBOUNCE_MS);
    };

    const handleProgressChange = (
      payload: RealtimePostgresChangesPayload<Record<string, unknown>>
    ) => {
      const row = payload.new as Record<string, unknown>;
      if (!row || typeof row !== "object") return;
      // Mapping direct depuis le payload Realtime → mise à jour d'état sans HTTP
      const mapped: RealtimeProgressRow = {
        run_id: String(row.run_id ?? ""),
        user_id: String(row.user_id ?? ""),
        stage: row.stage as SyncProgressRow["stage"],
        total: Number(row.total ?? 0),
        processed: Number(row.processed ?? 0),
        created_count: Number(row.created_count ?? 0),
        updated_count: Number(row.updated_count ?? 0),
        error_count: Number(row.error_count ?? 0),
        current_item_label: row.current_item_label != null ? String(row.current_item_label) : null,
        rate_per_min: row.rate_per_min != null ? Number(row.rate_per_min) : null,
        eta_seconds: row.eta_seconds != null ? Number(row.eta_seconds) : null,
        updated_at: String(row.updated_at ?? ""),
      };
      if (mapped.run_id && mapped.stage) {
        onProgressRef.current(mapped);
      }
    };

    const handleRunChange = (
      _payload: RealtimePostgresChangesPayload<Record<string, unknown>>
    ) => {
      scheduleRunChange();
    };

    let cancelled = false;
    const supabase = getSupabaseClient();

    void (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      if (cancelled || !userId) return;

      const channel = supabase
        .channel(`sync-rt:${userId}`)
        .on<Record<string, unknown>>(
          "postgres_changes",
          { event: "*", schema: "public", table: "sync_runs", filter: `user_id=eq.${userId}` },
          handleRunChange
        )
        .on<Record<string, unknown>>(
          "postgres_changes",
          { event: "*", schema: "public", table: "sync_progress", filter: `user_id=eq.${userId}` },
          handleProgressChange
        )
        .subscribe();

      if (cancelled) {
        await supabase.removeChannel(channel);
        return;
      }
      channelRef.current = channel;
    })();

    return () => {
      cancelled = true;
      if (runDebounceRef.current !== null) {
        window.clearTimeout(runDebounceRef.current);
        runDebounceRef.current = null;
      }
      const ch = channelRef.current;
      channelRef.current = null;
      if (ch) void supabase.removeChannel(ch);
    };
  }, [enabled]);
}
