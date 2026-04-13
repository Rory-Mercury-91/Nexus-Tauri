import { useEffect, useState } from "react";
import { Modal } from "@/components/common/Modal";
import "./DeleteLibraryEntryConfirmModal.css";

export type DeleteLibraryEntryKind = "reading" | "anime";

type DeleteLibraryEntryConfirmModalProps = {
  open: boolean;
  onClose: () => void;
  entryTitle: string;
  kind: DeleteLibraryEntryKind;
  /** Id MAL valide (hors plage synthétique), sinon pas de retrait distant */
  malMediaId: number | null;
  oauthMalConnected: boolean;
  oauthAnilistConnected: boolean;
  busy?: boolean;
  onConfirm: (opts: { removeMal: boolean; removeAnilist: boolean }) => void | Promise<void>;
};

export function DeleteLibraryEntryConfirmModal({
  open,
  onClose,
  entryTitle,
  kind,
  malMediaId,
  oauthMalConnected,
  oauthAnilistConnected,
  busy = false,
  onConfirm,
}: DeleteLibraryEntryConfirmModalProps) {
  const [removeMal, setRemoveMal] = useState(true);
  const [removeAnilist, setRemoveAnilist] = useState(true);

  const localLabel = kind === "reading" ? "cette fiche lecture dans Nexus" : "cette fiche animé dans Nexus";
  const canRemote = malMediaId !== null && malMediaId > 0;
  const showMal = canRemote && oauthMalConnected;
  const showAnilist = canRemote && oauthAnilistConnected;

  useEffect(() => {
    if (open) {
      setRemoveMal(true);
      setRemoveAnilist(true);
    }
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title="Confirmer la suppression"
      maxWidth="min(92vw, 26rem)"
    >
      <div className="delete-library-entry-confirm">
        <p className="delete-library-entry-confirm-lead">
          Supprimer <strong>{entryTitle.trim() || "cette entrée"}</strong> ?
        </p>
        <ul className="delete-library-entry-confirm-list">
          <li>
            <span className="delete-library-entry-confirm-always">Toujours :</span> {localLabel}.
          </li>
          {showMal ? (
            <li className="delete-library-entry-confirm-option">
              <label>
                <input
                  type="checkbox"
                  checked={removeMal}
                  disabled={busy}
                  onChange={(e) => setRemoveMal(e.target.checked)}
                />
                Retirer aussi de ma liste <strong>MyAnimeList</strong> (mangalist / animelist).
              </label>
            </li>
          ) : null}
          {showAnilist ? (
            <li className="delete-library-entry-confirm-option">
              <label>
                <input
                  type="checkbox"
                  checked={removeAnilist}
                  disabled={busy}
                  onChange={(e) => setRemoveAnilist(e.target.checked)}
                />
                Retirer aussi de ma liste <strong>AniList</strong> (lien via id MAL).
              </label>
            </li>
          ) : null}
          {!canRemote ? (
            <li className="delete-library-entry-confirm-hint">
              Pas de retrait MAL / AniList : pas d’identifiant MAL exploitable (fiche manuelle ou invalide).
            </li>
          ) : null}
          {canRemote && !oauthMalConnected && !oauthAnilistConnected ? (
            <li className="delete-library-entry-confirm-hint">
              Comptes MAL / AniList non connectés : seule la suppression Nexus sera possible.
            </li>
          ) : null}
        </ul>
        <div className="delete-library-entry-confirm-actions">
          <button type="button" className="delete-library-entry-btn-secondary" disabled={busy} onClick={onClose}>
            Annuler
          </button>
          <button
            type="button"
            className="delete-library-entry-btn-danger"
            disabled={busy}
            onClick={() => void onConfirm({ removeMal: showMal ? removeMal : false, removeAnilist: showAnilist ? removeAnilist : false })}
          >
            {busy ? "Suppression…" : "Supprimer"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
