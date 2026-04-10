import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { SessionContext } from "@/contexts/sessionContext";
import { getSupabaseClient } from "@/lib/supabaseClient";

/**
 * État de session unique pour l’app. La persistance tokens se fait via Supabase (localStorage, clé configurée dans supabaseClient).
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    let unsubscribe: (() => void) | undefined;

    try {
      const supabase = getSupabaseClient();
      supabase.auth.getSession().then(({ data }) => {
        if (mounted) {
          setSession(data.session ?? null);
          setLoading(false);
        }
      });
      const {
        data: { subscription },
      } = supabase.auth.onAuthStateChange((_event, next) => {
        setSession(next);
      });
      unsubscribe = () => subscription.unsubscribe();
    } catch {
      if (mounted) {
        setSession(null);
        setLoading(false);
      }
    }

    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, []);

  const value = useMemo(
    () => ({ session, loading }),
    [session, loading]
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}
