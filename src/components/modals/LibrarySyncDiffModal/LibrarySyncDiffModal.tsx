import { Modal } from "@/components/common/Modal";
import type { SyncDiffField } from "@/services/library/syncDiffService";
import "./LibrarySyncDiffModal.css";

type LibrarySyncDiffModalProps = {
  open: boolean;
  onClose: () => void;
  fields: SyncDiffField[];
  selectedFieldIds: string[];
  onToggleField: (fieldId: string, checked: boolean) => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
  onSyncMal: () => void;
  onSyncAnilist: () => void;
  onValidate?: () => void;
  syncing?: boolean;
};

export function LibrarySyncDiffModal({
  open,
  onClose,
  fields,
  selectedFieldIds,
  onToggleField,
  onSelectAll,
  onSelectNone,
  onSyncMal,
  onSyncAnilist,
  onValidate,
  syncing = false,
}: LibrarySyncDiffModalProps) {
  const hasFields = fields.length > 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Synchronisation - aperçu des modifications"
      maxWidth="min(96vw, 60rem)"
    >
      <p className="library-page-lead" style={{ marginBottom: "var(--space-2)" }}>
        Coche les champs à appliquer depuis la source.
      </p>
      <div className="library-sync-diff-head-actions">
        <button type="button" className="anime-collection-btn" onClick={onSelectAll} disabled={!hasFields}>
          Tout sélectionner
        </button>
        <button type="button" className="anime-collection-btn" onClick={onSelectNone} disabled={!hasFields}>
          Tout ignorer
        </button>
      </div>

      {hasFields ? (
        <div className="library-sync-diff-grid">
          {fields.map((field) => {
            const checked = selectedFieldIds.includes(field.id);
            return (
              <label key={field.id} className="library-sync-diff-card">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => onToggleField(field.id, e.target.checked)}
                  disabled={syncing}
                />
                <div className="library-sync-diff-card-body">
                  <strong>{field.label}</strong>
                  <div className="library-sync-diff-values-grid">
                    <div className="library-sync-diff-value-col">
                      <span className="library-sync-diff-value-label">Actuel</span>
                      <p>{field.currentValue || "—"}</p>
                    </div>
                    <div className="library-sync-diff-value-col">
                      <span className="library-sync-diff-value-label">Nouveau</span>
                      <p>{field.incomingValue || "—"}</p>
                    </div>
                  </div>
                </div>
              </label>
            );
          })}
        </div>
      ) : (
        <p className="anime-detail-prose">Aucune différence détectée entre la fiche locale et les données live.</p>
      )}

      <div className="library-sync-diff-actions">
        <button type="button" className="anime-collection-btn" onClick={onClose} disabled={syncing}>
          Annuler
        </button>
        {onValidate ? (
          <button type="button" className="anime-collection-btn" onClick={onValidate} disabled={syncing}>
            Valider
          </button>
        ) : null}
        <button type="button" className="anime-collection-btn" onClick={onSyncMal} disabled={syncing}>
          Sync MAL ({selectedFieldIds.length})
        </button>
        <button type="button" className="anime-collection-btn" onClick={onSyncAnilist} disabled={syncing}>
          Sync AniList ({selectedFieldIds.length})
        </button>
      </div>
    </Modal>
  );
}
