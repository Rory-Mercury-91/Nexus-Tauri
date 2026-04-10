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
