import "./LibraryPersonalProgressSection.css";

export type PersonalProgressStatus =
  | "Planifié"
  | "En cours"
  | "En pause"
  | "Terminé"
  | "Abandonné";

type PersonalProgressItem = {
  id: string;
  label: string;
  current: number;
  total: number;
  percent: number;
};

type LibraryPersonalProgressSectionProps = {
  status: PersonalProgressStatus;
  onStatusChange: (next: PersonalProgressStatus) => void;
  statusDisabled?: boolean;
  favorite: boolean;
  onToggleFavorite: () => void;
  favoriteDisabled?: boolean;
  favoriteLabel?: string;
  progressItems: PersonalProgressItem[];
};

const STATUS_OPTIONS: PersonalProgressStatus[] = [
  "Planifié",
  "En cours",
  "En pause",
  "Terminé",
  "Abandonné",
];

export function LibraryPersonalProgressSection({
  status,
  onStatusChange,
  statusDisabled = false,
  favorite,
  onToggleFavorite,
  favoriteDisabled = false,
  favoriteLabel = "Favoris",
  progressItems,
}: LibraryPersonalProgressSectionProps) {
  const visibleItems = progressItems.filter((item) => item.total > 0);

  return (
    <div className="anime-detail-subsection">
      <h3 className="anime-detail-subtitle-heading">Suivi personnel et progression</h3>
      <div className="library-personal-progress-wrap">
        <label className="reading-status-select-inline">
          <span>Statut:</span>
          <select
            value={status}
            disabled={statusDisabled}
            onChange={(e) => onStatusChange(e.target.value as PersonalProgressStatus)}
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
        </label>

        <div className="library-favorite-inline">
          <span>{favoriteLabel}:</span>
          <button
            type="button"
            className={`library-favorite-heart-btn${favorite ? " is-active" : ""}`}
            onClick={onToggleFavorite}
            disabled={favoriteDisabled}
            aria-label={favorite ? "Retirer des favoris" : "Ajouter aux favoris"}
            title={favoriteLabel}
          >
            {favorite ? "❤" : "♡"}
          </button>
        </div>

        {visibleItems.map((item) => (
          <div key={item.id}>
            <p className="anime-detail-prose">
              {item.label}: {item.current}/{item.total}
            </p>
            <div className={`anime-collection-progress${item.percent === 100 ? " is-completed" : ""}`}>
              <div style={{ width: `${item.percent}%` }} />
            </div>
            <small className="anime-collection-progress-meta">
              <span>{item.percent}%</span>
            </small>
          </div>
        ))}
      </div>
    </div>
  );
}
