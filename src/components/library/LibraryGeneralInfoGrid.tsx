type LibraryGeneralInfoItem = {
  key: string;
  label: string;
  value: string;
};

type LibraryGeneralInfoGridProps = {
  title?: string;
  items: LibraryGeneralInfoItem[];
};

export function LibraryGeneralInfoGrid({ title = "Informations générales", items }: LibraryGeneralInfoGridProps) {
  const visibleItems = items.filter((item) => item.label.trim().length > 0);
  if (visibleItems.length === 0) {
    return null;
  }

  return (
    <div className="anime-detail-subsection">
      <h3 className="anime-detail-subtitle-heading">{title}</h3>
      <div className="anime-detail-info-grid">
        {visibleItems.map((item) => (
          <div key={item.key} className="anime-detail-info-card">
            <span className="anime-detail-info-label">{item.label}</span>
            <span className="anime-detail-info-value">{item.value || "—"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
