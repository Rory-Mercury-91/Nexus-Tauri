import { useRef, useState } from "react";
import { LibraryMediaPreviewModal } from "@/components/library/LibraryMediaPreviewModal";

type LibraryMediaGalleryProps = {
  images: string[];
  emptyMessage: string;
  title?: string;
  thumbClassName?: string;
};

export function LibraryMediaGallery({
  images,
  emptyMessage,
  title = "Galeries disponibles",
  thumbClassName,
}: LibraryMediaGalleryProps) {
  const galleryRef = useRef<HTMLDivElement | null>(null);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  function openPreview(index: number) {
    if (images.length === 0) {
      return;
    }
    const safeIndex = Math.min(Math.max(0, index), images.length - 1);
    setPreviewIndex(safeIndex);
  }

  function scrollGallery(direction: "prev" | "next") {
    const node = galleryRef.current;
    if (!node) {
      return;
    }
    const amount = Math.max(200, Math.floor(node.clientWidth * 0.7));
    node.scrollBy({
      left: direction === "next" ? amount : -amount,
      behavior: "smooth",
    });
  }

  return (
    <>
      <div className="anime-detail-subsection">
        <div className="anime-detail-subsection-head">
          <h3 className="anime-detail-subtitle-heading">{title}</h3>
          {images.length > 0 ? (
            <div className="anime-detail-carousel-actions">
              <button type="button" className="anime-detail-carousel-btn" onClick={() => scrollGallery("prev")}>
                ←
              </button>
              <button type="button" className="anime-detail-carousel-btn" onClick={() => scrollGallery("next")}>
                →
              </button>
            </div>
          ) : null}
        </div>
        {images.length > 0 ? (
          <div ref={galleryRef} className="anime-detail-gallery-carousel">
            {images.map((src, i) => (
              <button key={`${src}-${i}`} type="button" className="anime-detail-image-btn" onClick={() => openPreview(i)}>
                <img src={src} alt="" className={thumbClassName} loading="lazy" />
              </button>
            ))}
          </div>
        ) : (
          <p className="anime-detail-prose">{emptyMessage}</p>
        )}
      </div>

      <LibraryMediaPreviewModal
        open={previewIndex !== null}
        images={images}
        startIndex={previewIndex ?? 0}
        onClose={() => setPreviewIndex(null)}
      />
    </>
  );
}
