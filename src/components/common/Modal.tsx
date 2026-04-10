import { type MouseEvent, type ReactNode } from "react";
import "./Modal.css";

type ModalProps = {
  open: boolean;
  title: string;
  titleId?: string;
  children: ReactNode;
  onClose: () => void;
  /** Largeur max du dialogue (ex. 32rem). */
  maxWidth?: string;
  hideHeader?: boolean;
  ariaLabel?: string;
};

export function Modal({
  open,
  title,
  titleId = "nexus-modal-title",
  children,
  onClose,
  maxWidth = "28rem",
  hideHeader = false,
  ariaLabel = "Fenêtre modale",
}: ModalProps) {
  if (!open) {
    return null;
  }

  function handleBackdropMouseDown(ev: MouseEvent<HTMLDivElement>) {
    if (ev.target === ev.currentTarget) {
      onClose();
    }
  }

  return (
    <div
      className="nexus-modal-backdrop"
      role="presentation"
      onMouseDown={handleBackdropMouseDown}
    >
      <div
        className="nexus-modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={hideHeader ? undefined : titleId}
        aria-label={hideHeader ? ariaLabel : undefined}
        style={{ maxWidth }}
        onMouseDown={(ev) => ev.stopPropagation()}
      >
        {hideHeader ? null : (
          <div className="nexus-modal-header">
            <h2 id={titleId} className="nexus-modal-title">
              {title}
            </h2>
            <button
              type="button"
              className="nexus-modal-close"
              aria-label="Fermer"
              onClick={onClose}
            >
              ×
            </button>
          </div>
        )}
        <div className="nexus-modal-body">{children}</div>
      </div>
    </div>
  );
}
