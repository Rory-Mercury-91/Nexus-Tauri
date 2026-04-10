type LibrarySynopsisSectionProps = {
  synopsis?: string | null;
  fallback?: string;
  title?: string;
};

export function LibrarySynopsisSection({
  synopsis,
  fallback = "Aucun synopsis disponible.",
  title = "Synopsis",
}: LibrarySynopsisSectionProps) {
  const content = synopsis?.trim() || fallback;
  if (!content) {
    return null;
  }

  return (
    <div className="anime-detail-subsection">
      <h3 className="anime-detail-subtitle-heading">{title}</h3>
      <p className="anime-detail-prose">{content}</p>
    </div>
  );
}
