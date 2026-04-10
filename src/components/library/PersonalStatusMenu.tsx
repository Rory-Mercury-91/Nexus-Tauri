import { useEffect } from "react";
import { createPortal } from "react-dom";

export type StatusOption = "Planifié" | "En cours" | "En pause" | "Terminé" | "Abandonné";

type PersonalStatusMenuProps = {
  open: boolean;
  anchorRect: DOMRect | null;
  selected: StatusOption;
  favorite: boolean;
  onSelect: (status: StatusOption) => void;
  onToggleFavorite: () => void;
  onClose: () => void;
};

const STATUS_OPTIONS: StatusOption[] = ["Planifié", "En cours", "En pause", "Terminé", "Abandonné"];

export function PersonalStatusMenu({
  open,
  anchorRect,
  selected,
  favorite,
  onSelect,
  onToggleFavorite,
  onClose,
}: PersonalStatusMenuProps) {
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open || !anchorRect) {
    return null;
  }

  const style = {
    position: "fixed" as const,
    top: anchorRect.bottom + 6,
    left: Math.max(8, anchorRect.right - 220),
    width: 220,
    zIndex: 1300,
  };

  return createPortal(
    <div className="anime-collection-menu-backdrop" onMouseDown={onClose} role="presentation">
      <div className="anime-collection-menu" style={style} onMouseDown={(ev) => ev.stopPropagation()}>
        <button
          type="button"
          className={`anime-collection-menu-item${favorite ? " is-selected" : ""}`}
          onClick={() => {
            onToggleFavorite();
            onClose();
          }}
        >
          {favorite ? "Retirer des favoris" : "Ajouter aux favoris"}
        </button>
        {STATUS_OPTIONS.map((status) => (
          <button
            key={status}
            type="button"
            className={`anime-collection-menu-item${selected === status ? " is-selected" : ""}`}
            onClick={() => {
              onSelect(status);
              onClose();
            }}
          >
            {status}
          </button>
        ))}
      </div>
    </div>,
    document.body
  );
}
