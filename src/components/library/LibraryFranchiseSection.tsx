import { Link } from "react-router-dom";

export type LibraryFranchiseItem = {
  key: string;
  to: string;
  title: string;
  meta: string;
  isCurrent?: boolean;
  isFavorite?: boolean;
  imageUrl?: string;
};

type LibraryFranchiseSectionProps = {
  items: LibraryFranchiseItem[];
};

export function LibraryFranchiseSection({ items }: LibraryFranchiseSectionProps) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className="anime-detail-subsection">
      <h3 className="anime-detail-subtitle-heading">Franchise liée</h3>
      <ul className="anime-detail-franchise-list">
        {items.map((entry) => (
          <li key={entry.key}>
            <Link to={entry.to} className={`anime-detail-franchise-link${entry.isCurrent ? " is-current" : ""}`}>
              {entry.imageUrl ? (
                <img className="anime-detail-franchise-thumb" src={entry.imageUrl} alt="" loading="lazy" />
              ) : (
                <span className="anime-detail-franchise-thumb anime-detail-relation-thumb-placeholder" aria-hidden />
              )}
              <span className="anime-detail-franchise-main">
                {entry.isFavorite ? <span className="anime-detail-franchise-fav">❤</span> : null}
                <span className="anime-detail-franchise-title">{entry.title}</span>
                <span className="anime-detail-franchise-meta">{entry.meta}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
