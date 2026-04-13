import { useEffect, useRef } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabaseClient } from "@/lib/supabaseClient";
import type { SyncMediaType } from "@/services/library/syncService";

const DEBOUNCE_MS = 150;

/**
 * Pousse un rafraîchissement dès que le worker met à jour `sync_runs` / `sync_progress` (Realtime).
 * Nécessite que les tables soient dans `supabase_realtime` (voir `supabase/realtime_sync_tables.sql`).
 */
export function useSyncProgressRealtime(
  mediaType: SyncMediaType,
  enabled: boolean,
  onRefresh: () => void | Promise<void>
): void {
  const onRefreshRef = useRef(onRefresh);
  const timerRef = useRef<number | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const schedule = () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        void onRefreshRef.current();
      }, DEBOUNCE_MS);
    };

    let cancelled = false;
    const supabase = getSupabaseClient();

    void (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      if (cancelled || !userId) {
        return;
      }

      const channel = supabase
        .channel(`sync-progress:${mediaType}:${userId}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "sync_runs", filter: `user_id=eq.${userId}` },
          schedule
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "sync_progress", filter: `user_id=eq.${userId}` },
          schedule
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
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      const ch = channelRef.current;
      channelRef.current = null;
      if (ch) {
        void supabase.removeChannel(ch);
      }
    };
  }, [enabled, mediaType]);
}
