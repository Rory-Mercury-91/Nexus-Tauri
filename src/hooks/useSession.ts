import { useContext } from "react";
import { SessionContext } from "@/contexts/sessionContext";

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error("useSession doit être utilisé dans un SessionProvider.");
  }
  return ctx;
}
