import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { AuthModal } from "@/features/auth/AuthModal/AuthModal";
import { AuthModalContext } from "@/contexts/authModalContext";
import { useSession } from "@/hooks/useSession";

type AuthTab = "login" | "register";

export function AuthModalProvider({ children }: { children: ReactNode }) {
  const { session, loading } = useSession();
  const [internalOpen, setInternalOpen] = useState(false);
  const [tab, setTab] = useState<AuthTab>("login");

  const mandatoryOpen = !loading && !session;
  const effectiveOpen = mandatoryOpen || internalOpen;

  useEffect(() => {
    if (session) {
      setInternalOpen(false);
    }
  }, [session]);

  const openLogin = useCallback(() => {
    setTab("login");
    setInternalOpen(true);
  }, []);

  const openRegister = useCallback(() => {
    setTab("register");
    setInternalOpen(true);
  }, []);

  const close = useCallback(() => {
    if (!loading && !session) {
      return;
    }
    setInternalOpen(false);
  }, [loading, session]);

  const value = useMemo(
    () => ({ openLogin, openRegister, close }),
    [openLogin, openRegister, close]
  );

  return (
    <AuthModalContext.Provider value={value}>
      {children}
      <AuthModal
        open={effectiveOpen}
        initialTab={tab}
        onClose={close}
        mandatory={mandatoryOpen}
      />
    </AuthModalContext.Provider>
  );
}
