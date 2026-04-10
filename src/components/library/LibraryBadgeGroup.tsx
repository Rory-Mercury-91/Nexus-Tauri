type LibraryBadgeItem = {
  key: string;
  label: string;
  toneClass?: string;
};

type LibraryBadgeGroupProps = {
  items: LibraryBadgeItem[];
  small?: boolean;
};

export function LibraryBadgeGroup({ items, small = false }: LibraryBadgeGroupProps) {
  const uniqueItems = items.filter(
    (item, index, list) =>
      list.findIndex((entry) => entry.label.trim().toLowerCase() === item.label.trim().toLowerCase()) === index
  );

  if (uniqueItems.length === 0) {
    return null;
  }

  const baseChipClass = small ? "anime-detail-chip anime-detail-chip-small" : "anime-detail-chip";

  return (
    <div className={`anime-detail-meta-chips${small ? " anime-detail-meta-chips-small" : ""}`}>
      {uniqueItems.map((item) => (
        <span key={item.key} className={`${baseChipClass} ${item.toneClass ?? "anime-detail-chip-info"}`}>
          {item.label}
        </span>
      ))}
    </div>
  );
}
