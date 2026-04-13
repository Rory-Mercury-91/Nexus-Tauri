import {
  BookOpen,
  CreditCard,
  LayoutDashboard,
  LogOut,
  Minimize2,
  Settings,
  Tv,
} from "lucide-react";
import { type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { NexusLogo } from "@/components/common/NexusLogo";
import { ProfileAvatarImage } from "@/components/common/ProfileAvatarImage";
import { SyncProgressSidebar } from "@/components/layout/SyncProgressSidebar";
import { useReadingSyncProgress } from "@/contexts/ReadingSyncProgressContext";
import { useSyncProgress } from "@/contexts/SyncProgressContext";
import { closeMainWindow, minimizeMainWindow } from "@/lib/tauriWindow";
import "./AppShell.css";

type AppShellProps = {
  children: ReactNode;
  displayName: string;
  email: string | null;
  avatarStoragePath: string | null;
  /** Compteur pour forcer le rechargement de l’avatar (après upload). */
  avatarRevision: number;
  onSignOut: () => void;
};

export function AppShell({
  children,
  displayName,
  email,
  avatarStoragePath,
  avatarRevision,
  onSignOut,
}: AppShellProps) {
  const { activeRun: animeRun, recentRuns: animeRuns } = useSyncProgress();
  const { activeRun: readingRun, recentRuns: readingRuns } = useReadingSyncProgress();
  const animeLastSync = animeRuns.find((run) => run.status === "completed")?.finished_at ?? null;
  const readingLastSync = readingRuns.find((run) => run.status === "completed")?.finished_at ?? null;
  const animeInProgress = Boolean(animeRun && (animeRun.status === "queued" || animeRun.status === "running"));
  const readingInProgress = Boolean(readingRun && (readingRun.status === "queued" || readingRun.status === "running"));

  function freshnessStatus(lastSyncIso: string | null, inProgress: boolean): "running" | "fresh" | "stale" {
    if (inProgress) return "running";
    if (!lastSyncIso) return "stale";
    const delta = Date.now() - new Date(lastSyncIso).getTime();
    return delta <= 70 * 60 * 1000 ? "fresh" : "stale";
  }

  function freshnessLabel(status: "running" | "fresh" | "stale"): string {
    if (status === "running") return "Sync en cours";
    if (status === "fresh") return "A jour";
    return "Mise a jour en attente";
  }

  const animeFreshness = freshnessStatus(animeLastSync, animeInProgress);
  const readingFreshness = freshnessStatus(readingLastSync, readingInProgress);
  const animeLastSyncLabel = animeLastSync
    ? new Date(animeLastSync).toLocaleString("fr-FR")
    : "Aucune synchronisation terminee";
  const readingLastSyncLabel = readingLastSync
    ? new Date(readingLastSync).toLocaleString("fr-FR")
    : "Aucune synchronisation terminee";
  const readingNautiljonAutoLabel = (() => {
    const raw = localStorage.getItem("nautiljon:auto:last-run:reading");
    const ms = Number(raw ?? 0);
    if (!Number.isFinite(ms) || ms <= 0) {
      return "Jamais controle";
    }
    return new Date(ms).toLocaleString("fr-FR");
  })();

  return (
    <div className="app-shell">
      <aside className="app-shell-sidebar" aria-label="Navigation principale">
        <div className="app-shell-logo">
          <NexusLogo height={36} />
        </div>

        <div className="app-shell-user">
          <div
            className="app-shell-avatar"
            aria-label={`Avatar de ${displayName}`}
          >
            <ProfileAvatarImage
              storagePath={avatarStoragePath}
              displayName={displayName}
              size={48}
              revision={avatarRevision}
            />
          </div>
          <div className="app-shell-user-meta">
            <span className="app-shell-user-text">{displayName}</span>
            {email ? (
              <span className="app-shell-user-secondary" title={email}>
                {email}
              </span>
            ) : null}
            <button
              type="button"
              className="app-shell-signout"
              onClick={onSignOut}
            >
              Déconnexion
            </button>
          </div>
        </div>
        <div className="app-shell-freshness" aria-label="Etat des synchronisations">
          <div className={`app-shell-freshness-badge is-${animeFreshness}`}>
            <span className="app-shell-freshness-text">Anime: {freshnessLabel(animeFreshness)}</span>
            <span className="app-shell-freshness-tooltip" role="tooltip">
              Derniere sync anime: {animeLastSyncLabel}
            </span>
          </div>
          <div className={`app-shell-freshness-badge is-${readingFreshness}`}>
            <span className="app-shell-freshness-text">Lecture: {freshnessLabel(readingFreshness)}</span>
            <span className="app-shell-freshness-tooltip" role="tooltip">
              Derniere sync lecture: {readingLastSyncLabel}
              <br />
              Dernier controle Nautiljon auto: {readingNautiljonAutoLabel}
            </span>
          </div>
        </div>

        <nav className="app-shell-nav">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              `app-shell-nav-link${isActive ? " app-shell-nav-link-active" : ""}`
            }
          >
            <LayoutDashboard size={18} aria-hidden />
            Tableau de bord
          </NavLink>
          <NavLink
            to="/anime"
            className={({ isActive }) =>
              `app-shell-nav-link${isActive ? " app-shell-nav-link-active" : ""}`
            }
          >
            <Tv size={18} aria-hidden />
            Animés
          </NavLink>
          <NavLink
            to="/lectures"
            className={({ isActive }) =>
              `app-shell-nav-link${isActive ? " app-shell-nav-link-active" : ""}`
            }
          >
            <BookOpen size={18} aria-hidden />
            Lectures
          </NavLink>
          <NavLink
            to="/subscriptions"
            className={({ isActive }) =>
              `app-shell-nav-link${isActive ? " app-shell-nav-link-active" : ""}`
            }
          >
            <CreditCard size={18} aria-hidden />
            Abonnements
          </NavLink>
        </nav>

        <SyncProgressSidebar />

        <div className="app-shell-footer">
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              `app-shell-footer-btn app-shell-footer-link${isActive ? " app-shell-footer-link-active" : ""}`
            }
            title="Paramètres"
          >
            <Settings size={18} />
          </NavLink>
          <button
            type="button"
            className="app-shell-footer-btn app-shell-footer-btn-minimize"
            title="Réduire"
            onClick={() => void minimizeMainWindow()}
          >
            <Minimize2 size={18} />
          </button>
          <button
            type="button"
            className="app-shell-footer-btn app-shell-footer-btn-danger"
            title="Quitter"
            onClick={() => void closeMainWindow()}
          >
            <LogOut size={18} />
          </button>
        </div>
      </aside>

      <main className="app-shell-main" id="app-scroll-container">
        {children}
      </main>
    </div>
  );
}
