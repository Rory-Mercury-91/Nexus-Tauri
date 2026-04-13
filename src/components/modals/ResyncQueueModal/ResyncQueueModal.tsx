import { useState, useEffect } from "react";
import { Modal } from "@/components/common/Modal";
import type { ResyncQueueEntry } from "@/services/library/resyncQueueService";
import "./ResyncQueueModal.css";

type ResyncQueueModalProps = {
  open: boolean;
  onClose: () => void;
  queue: ResyncQueueEntry[];
  currentIndex: number;
  onNext: () => void;
  onPrevious: () => void;
  onApply: (entryId: string, selectedFieldIds: string[]) => Promise<void>;
  onSkip: () => void;
  onApplyAll: () => Promise<void>;
  processing?: boolean;
};

export function ResyncQueueModal({
  open,
  onClose,
  queue,
  currentIndex,
  onNext,
  onPrevious,
  onApply,
  onSkip,
  onApplyAll,
  processing = false,
}: ResyncQueueModalProps) {
  const [selectedFieldIds, setSelectedFieldIds] = useState<string[]>([]);
  
  const currentEntry = queue[currentIndex] ?? null;
  const hasNext = currentIndex < queue.length - 1;
  const hasPrevious = currentIndex > 0;
  
  useEffect(() => {
    if (currentEntry) {
      // Par défaut, sélectionner tous les champs
      setSelectedFieldIds(currentEntry.fields.map((f) => f.id));
    }
  }, [currentEntry]);
  
  if (!currentEntry) {
    return null;
  }
  
  function toggleField(fieldId: string, checked: boolean) {
    setSelectedFieldIds((prev) =>
      checked ? [...prev, fieldId] : prev.filter((id) => id !== fieldId)
    );
  }
  
  function selectAll() {
    setSelectedFieldIds(currentEntry.fields.map((f) => f.id));
  }
  
  function selectNone() {
    setSelectedFieldIds([]);
  }
  
  async function handleApply() {
    await onApply(currentEntry.id, selectedFieldIds);
  }
  
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Resynchronisation - Modifications détectées"
      maxWidth="min(96vw, 64rem)"
    >
      <div className="resync-queue-header">
        <div className="resync-queue-progress">
          <strong>
            Entrée {currentIndex + 1} / {queue.length}
          </strong>
          <span className="resync-queue-title">{currentEntry.title}</span>
        </div>
        <div className="resync-queue-nav">
          <button
            type="button"
            className="anime-collection-btn"
            onClick={onPrevious}
            disabled={!hasPrevious || processing}
          >
            ‹ Précédent
          </button>
          <button
            type="button"
            className="anime-collection-btn"
            onClick={onNext}
            disabled={!hasNext || processing}
          >
            Suivant ›
          </button>
        </div>
      </div>
      
      <p className="library-page-lead" style={{ marginBottom: "var(--space-2)" }}>
        Sélectionne les champs à mettre à jour depuis la source externe.
      </p>
      
      <div className="library-sync-diff-head-actions">
        <button
          type="button"
          className="anime-collection-btn"
          onClick={selectAll}
          disabled={processing}
        >
          Tout sélectionner
        </button>
        <button
          type="button"
          className="anime-collection-btn"
          onClick={selectNone}
          disabled={processing}
        >
          Tout désélectionner
        </button>
      </div>
      
      {currentEntry.fields.length > 0 ? (
        <div className="library-sync-diff-grid">
          {currentEntry.fields.map((field) => {
            const checked = selectedFieldIds.includes(field.id);
            return (
              <label key={field.id} className="library-sync-diff-card">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => toggleField(field.id, e.target.checked)}
                  disabled={processing}
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
        <p className="library-page-lead">Aucune différence détectée pour cette entrée.</p>
      )}
      
      <div className="resync-queue-actions">
        <button
          type="button"
          className="anime-collection-btn resync-queue-btn-skip"
          onClick={onSkip}
          disabled={processing}
        >
          Ignorer cette entrée
        </button>
        <button
          type="button"
          className="anime-collection-btn resync-queue-btn-apply"
          onClick={handleApply}
          disabled={processing || selectedFieldIds.length === 0}
        >
          {processing ? "Application..." : "Appliquer les changements"}
        </button>
        <button
          type="button"
          className="anime-collection-btn resync-queue-btn-all"
          onClick={onApplyAll}
          disabled={processing}
        >
          Tout appliquer pour toutes les entrées
        </button>
      </div>
      
      <div className="resync-queue-footer">
        <small>
          {queue.length - currentIndex - 1} entrée{queue.length - currentIndex - 1 > 1 ? "s" : ""} restante{queue.length - currentIndex - 1 > 1 ? "s" : ""}
        </small>
      </div>
    </Modal>
  );
}
