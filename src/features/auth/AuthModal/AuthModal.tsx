import { type MouseEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  AuthPanel,
  type AuthTab,
} from "@/features/auth/AuthPanel/AuthPanel";
import "./AuthModal.css";

type AuthModalProps = {
  open: boolean;
  initialTab: AuthTab;
  onClose: () => void;
  /** Si true : pas de fermeture (auth obligatoire, session absente). */
  mandatory?: boolean;
};

export function AuthModal({
  open,
  initialTab,
  onClose,
  mandatory = false,
}: AuthModalProps) {
  const navigate = useNavigate();

  if (!open) {
    return null;
  }

  function handleSuccess() {
    onClose();
    navigate("/", { replace: true });
  }

  function handleBackdropMouseDown(ev: MouseEvent<HTMLDivElement>) {
    if (mandatory) {
      return;
    }
    if (ev.target === ev.currentTarget) {
      onClose();
    }
  }

  return (
    <div
      className="auth-modal-backdrop"
      role="presentation"
      onMouseDown={handleBackdropMouseDown}
    >
      <div
        className="auth-modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-modal-title"
        onMouseDown={(ev) => ev.stopPropagation()}
      >
        {!mandatory ? (
          <button
            type="button"
            className="auth-modal-close"
            aria-label="Fermer la fenêtre"
            onClick={onClose}
          >
            ×
          </button>
        ) : null}
        <h2 id="auth-modal-title" className="visually-hidden">
          Compte Nexus
        </h2>
        <AuthPanel initialTab={initialTab} onSuccess={handleSuccess} />
      </div>
    </div>
  );
}
