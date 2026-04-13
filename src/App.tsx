import { useEffect, useState } from "react";
import { HashRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { DataLoadingOverlay } from "@/components/common/DataLoadingOverlay";
import { AppToastHost } from "@/components/common/AppToastHost";
import { ScrollToTop } from "@/components/common/ScrollToTop";
import { NautiljonImportReceptionModal } from "@/components/modals/NautiljonImportReceptionModal/NautiljonImportReceptionModal";
import { AuthModalProvider } from "@/contexts/AuthModalProvider";
import { DataFetchOverlayProvider } from "@/contexts/DataFetchOverlayContext";
import { SyncProgressProvider } from "@/contexts/SyncProgressContext";
import { ReadingSyncProgressProvider } from "@/contexts/ReadingSyncProgressContext";
import { SessionProvider } from "@/contexts/SessionProvider";
import { AppShell } from "@/layout/AppShell/AppShell";
import {
  NEXUS_PROFILE_CHANGED_EVENT,
} from "@/lib/profileEvents";
import { getSupabaseClient } from "@/lib/supabaseClient";
import { HomePage } from "@/pages/home/HomePage";
import { LoginPage } from "@/pages/auth/login/LoginPage";
import { RegisterPage } from "@/pages/auth/register/RegisterPage";
import { ForgotPasswordPage } from "@/pages/auth/forgotPassword/ForgotPasswordPage";
import { AuthCallbackPage } from "@/pages/auth/authCallback/AuthCallbackPage";
import { ResetPasswordPage } from "@/pages/auth/resetPassword/ResetPasswordPage";
import { SettingsPage } from "@/pages/settings/SettingsPage";
import { AnimeCollectionPage } from "@/pages/library/AnimeCollectionPage";
import { AnimeDetailPage } from "@/pages/library/AnimeDetailPage/AnimeDetailPage";
import { ReadingCollectionPage } from "@/pages/library/ReadingCollectionPage";
import { ReadingDetailPage } from "@/pages/library/ReadingDetailPage";
import { SubscriptionsPage } from "@/pages/subscriptions/SubscriptionsPage";
import { useSession } from "@/hooks/useSession";
import { initTauriAuthDeepLinks } from "@/services/auth/authRedirectService";

function AppRoutes() {
  const { session, loading: sessionLoading } = useSession();
  const [avatarPath, setAvatarPath] = useState<string | null>(null);
  const [profileTick, setProfileTick] = useState(0);
  const location = useLocation();
  const isPublicAuthPath =
    location.pathname === "/login" ||
    location.pathname === "/register" ||
    location.pathname.startsWith("/auth/");
  const isAnimeDetail = /^\/anime\/\d+/.test(location.pathname);
  const isReadingDetail = /^\/lectures\/\d+/.test(location.pathname);
  const renderAnimeSection = location.pathname === "/anime" || isAnimeDetail;
  const renderReadingSection = location.pathname === "/lectures" || isReadingDetail;
  /** Prêt à afficher l’app : session connue + premier chargement profil terminé si connecté. */
  const [initialDataReady, setInitialDataReady] = useState(false);

  useEffect(() => {
    void initTauriAuthDeepLinks();
  }, []);

  useEffect(() => {
    const onBump = () => setProfileTick((t) => t + 1);
    window.addEventListener(NEXUS_PROFILE_CHANGED_EVENT, onBump);
    return () => window.removeEventListener(NEXUS_PROFILE_CHANGED_EVENT, onBump);
  }, []);

  // Bootstrap : session Supabase + premier jet profil (évite un shell vide ou sans avatar).
  useEffect(() => {
    if (sessionLoading) {
      return;
    }
    if (!session?.user.id) {
      setAvatarPath(null);
      setInitialDataReady(true);
      return;
    }
    setInitialDataReady(false);
    let cancelled = false;
    (async () => {
      try {
        const supabase = getSupabaseClient();
        const { data } = await supabase
          .from("profiles")
          .select("avatar_storage_path")
          .eq("id", session.user.id)
          .maybeSingle();
        if (!cancelled) {
          setAvatarPath(data?.avatar_storage_path ?? null);
          setInitialDataReady(true);
        }
      } catch {
        if (!cancelled) {
          setAvatarPath(null);
          setInitialDataReady(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionLoading, session?.user?.id]);

  // Mise à jour avatar après changement de profil (sans bloquer l’interface).
  useEffect(() => {
    if (!session?.user.id || profileTick === 0) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const supabase = getSupabaseClient();
        const { data } = await supabase
          .from("profiles")
          .select("avatar_storage_path")
          .eq("id", session.user.id)
          .maybeSingle();
        if (!cancelled) {
          setAvatarPath(data?.avatar_storage_path ?? null);
        }
      } catch {
        if (!cancelled) {
          setAvatarPath(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session?.user?.id, profileTick]);

  async function handleSignOut() {
    const supabase = getSupabaseClient();
    await supabase.auth.signOut();
  }

  const meta = session?.user.user_metadata as
    | { display_name?: string }
    | undefined;
  const displayName =
    meta?.display_name?.trim() ||
    session?.user.email?.split("@")[0] ||
    "Utilisateur";

  const showDataLoadingOverlay =
    sessionLoading ||
    (Boolean(session?.user?.id) && !initialDataReady);

  if (showDataLoadingOverlay) {
    return <DataLoadingOverlay />;
  }

  if (!session && !isPublicAuthPath) {
    return <div className="session-auth-host" aria-hidden />;
  }

  if (!session) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/auth/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/auth/callback" element={<AuthCallbackPage />} />
        <Route path="/auth/reset-password" element={<ResetPasswordPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <DataFetchOverlayProvider>
      <SyncProgressProvider>
        <ReadingSyncProgressProvider>
          <AppShell
            displayName={displayName}
            email={session.user.email ?? null}
            avatarStoragePath={avatarPath}
            avatarRevision={profileTick}
            onSignOut={() => void handleSignOut()}
          >
            <ScrollToTop />
            <AppToastHost />
            <NautiljonImportReceptionModal />
          {renderAnimeSection && (
            <div style={{ display: isAnimeDetail ? "none" : undefined }}>
              <AnimeCollectionPage />
            </div>
          )}
          {renderReadingSection && (
            <div style={{ display: isReadingDetail ? "none" : undefined }}>
              <ReadingCollectionPage />
            </div>
          )}
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/anime" element={null} />
            <Route path="/anime/:id" element={<AnimeDetailPage />} />
            <Route path="/lectures" element={null} />
            <Route path="/lectures/:id" element={<ReadingDetailPage />} />
            <Route path="/subscriptions" element={<SubscriptionsPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/auth/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/auth/callback" element={<AuthCallbackPage />} />
            <Route path="/auth/reset-password" element={<ResetPasswordPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </AppShell>
        </ReadingSyncProgressProvider>
      </SyncProgressProvider>
    </DataFetchOverlayProvider>
  );
}

export default function App() {
  return (
    <SessionProvider>
      <HashRouter>
        <AuthModalProvider>
          <AppRoutes />
        </AuthModalProvider>
      </HashRouter>
    </SessionProvider>
  );
}
