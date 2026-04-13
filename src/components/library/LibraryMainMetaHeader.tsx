type LibraryMainMetaChip = {
  key: string;
  label: string;
  toneClass?: string;
};

type LibraryMainMetaHeaderProps = {
  title: string;
  titleTag?: "h1" | "h2";
  subtitles?: string[];
  chips: LibraryMainMetaChip[];
};

function normalizeDisplayValue(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[[\]【】(){}"'`«»]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function LibraryMainMetaHeader({
  title,
  titleTag = "h1",
  subtitles = [],
  chips,
}: LibraryMainMetaHeaderProps) {
  const TitleTag = titleTag;
  const normalizedTitle = normalizeDisplayValue(title);
  const visibleSubtitles = subtitles
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .filter((item) => normalizeDisplayValue(item) !== normalizedTitle)
    .filter(
      (item, index, list) =>
        list.findIndex((entry) => normalizeDisplayValue(entry) === normalizeDisplayValue(item)) === index
    );

  return (
    <div className="library-main-meta-header">
      <TitleTag className="library-page-title library-main-meta-title">
        {title}
      </TitleTag>
      {visibleSubtitles.map((subtitle) => (
        <p key={subtitle} className="anime-detail-subtitle library-main-meta-subtitle">
          {subtitle}
        </p>
      ))}
      <div className="anime-detail-meta-chips library-main-meta-chips">
        {chips.map((chip) => (
          <span key={chip.key} className={`anime-detail-chip ${chip.toneClass ?? "anime-detail-chip-info"}`}>
            {chip.label}
          </span>
        ))}
      </div>
    </div>
  );
}
