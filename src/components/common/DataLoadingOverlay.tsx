import "./DataLoadingOverlay.css";

type DataLoadingOverlayProps = {
  /** Texte principal sous le spinner */
  title?: string;
  /** Ligne secondaire optionnelle */
  hint?: string;
};

/**
 * Overlay bloquant affiché pendant le chargement initial des données (session, profil, etc.).
 */
export function DataLoadingOverlay({
  title = "Chargement des données",
  hint = "Connexion à Supabase et préparation de l’interface…",
}: DataLoadingOverlayProps) {
  return (
    <div
      className="data-loading-overlay"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="data-loading-overlay-inner">
        <div className="data-loading-overlay-spinner" aria-hidden />
        <p className="data-loading-overlay-title">{title}</p>
        {hint ? (
          <p className="data-loading-overlay-hint">{hint}</p>
        ) : null}
      </div>
    </div>
  );
}
