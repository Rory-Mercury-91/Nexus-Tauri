import { Link } from "react-router-dom";

type LibraryDetailStickyHeaderProps = {
  backTo: string;
  backLabel: string;
  backState?: unknown;
  onSync: () => void;
  onEdit: () => void;
  onRefresh: () => void;
  onDelete?: () => void;
  deleting?: boolean;
  editLabel?: string;
  syncTitle?: string;
  refreshTitle?: string;
  onExportJson?: () => void;
  exportBusy?: boolean;
};

export function LibraryDetailStickyHeader({
  backTo,
  backLabel,
  backState,
  onSync,
  onEdit,
  onRefresh,
  onDelete,
  deleting = false,
  editLabel = "Modifier la fiche",
  syncTitle,
  refreshTitle,
  onExportJson,
  exportBusy = false,
}: LibraryDetailStickyHeaderProps) {
  return (
    <div className="anime-detail-sticky-header">
      <Link
        to={backTo}
        state={backState}
        className="anime-detail-action-btn anime-detail-sticky-back-btn"
      >
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
        {onExportJson ? (
          <button
            type="button"
            className="anime-detail-action-btn"
            onClick={onExportJson}
            disabled={exportBusy}
            title="Exporter toutes les données brutes de cette fiche"
          >
            {exportBusy ? "Export..." : "Exporter JSON"}
          </button>
        ) : null}
        {onDelete ? (
          <button
            type="button"
            className="anime-detail-action-btn anime-detail-action-btn-danger"
            onClick={onDelete}
            disabled={deleting}
            title="Supprimer cette fiche locale"
          >
            {deleting ? "Suppression..." : "Supprimer"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
