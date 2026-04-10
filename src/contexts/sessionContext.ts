import type { Session } from "@supabase/supabase-js";
import { createContext } from "react";

export type SessionContextValue = {
  session: Session | null;
  loading: boolean;
};

export const SessionContext = createContext<SessionContextValue | null>(null);
