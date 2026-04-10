import { useEffect, useState } from "react";
import { Modal } from "@/components/common/Modal";

type LibraryMediaPreviewModalProps = {
  open: boolean;
  images: string[];
  startIndex?: number;
  onClose: () => void;
};

export function LibraryMediaPreviewModal({
  open,
  images,
  startIndex = 0,
  onClose,
}: LibraryMediaPreviewModalProps) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!open) {
      return;
    }
    const safe = Math.min(Math.max(0, startIndex), Math.max(0, images.length - 1));
    setIndex(safe);
  }, [open, startIndex, images.length]);

  function showPrev() {
    if (images.length <= 1) {
      return;
    }
    setIndex((prev) => (prev === 0 ? images.length - 1 : prev - 1));
  }

  function showNext() {
    if (images.length <= 1) {
      return;
    }
    setIndex((prev) => (prev === images.length - 1 ? 0 : prev + 1));
  }

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        onClose();
        return;
      }
      if (ev.key === "ArrowLeft") {
        showPrev();
        return;
      }
      if (ev.key === "ArrowRight") {
        showNext();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, images.length]);

  const current = images[index] ?? "";

  return (
    <Modal
      open={open}
      title=""
      onClose={onClose}
      maxWidth="min(96vw, 72rem)"
      hideHeader
      ariaLabel="Aperçu galerie"
    >
      {current ? (
        <div className="anime-detail-preview-wrap">
          {images.length > 1 ? (
            <button
              type="button"
              className="anime-detail-preview-nav is-left"
              onClick={showPrev}
              aria-label="Image précédente"
            >
              ←
            </button>
          ) : null}
          <img className="anime-detail-preview-image" src={current} alt="" />
          {images.length > 1 ? (
            <button
              type="button"
              className="anime-detail-preview-nav is-right"
              onClick={showNext}
              aria-label="Image suivante"
            >
              →
            </button>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}
