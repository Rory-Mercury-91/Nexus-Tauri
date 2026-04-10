import { Link } from "react-router-dom";

type LibraryDetailStickyHeaderProps = {
  backTo: string;
  backLabel: string;
  onSync: () => void;
  onEdit: () => void;
  onRefresh: () => void;
  editLabel?: string;
  syncTitle?: string;
  refreshTitle?: string;
};

export function LibraryDetailStickyHeader({
  backTo,
  backLabel,
  onSync,
  onEdit,
  onRefresh,
  editLabel = "Modifier la fiche",
  syncTitle,
  refreshTitle,
}: LibraryDetailStickyHeaderProps) {
  return (
    <div className="anime-detail-sticky-header">
      <Link to={backTo} className="anime-detail-action-btn anime-detail-sticky-back-btn">
        {backLabel}
      </Link>
      <div className="anime-detail-toolbar">
        <button type="button" className="anime-detail-action-btn" onClick={onSync} title={syncTitle}>
          Synchroniser
        </button>
        <button type="button" className="anime-detail-action-btn" onClick={onEdit}>
          {editLabel}
        </button>
        <button
          type="button"
          className="anime-detail-action-btn anime-detail-action-btn-primary"
          onClick={onRefresh}
          title={refreshTitle}
        >
          Rafraîchir la fiche
        </button>
      </div>
    </div>
  );
}
