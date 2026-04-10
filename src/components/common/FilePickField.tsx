import { useId, useRef, type ChangeEvent } from "react";
import "./FilePickField.css";

type FilePickFieldProps = {
  accept: string;
  buttonLabel: string;
  /** Texte si aucun fichier (ex. « Aucun fichier choisi »). */
  emptyHint?: string;
  /** Nom du fichier sélectionné (affichage contrôlé). */
  selectedLabel?: string | null;
  onFileChange: (file: File | undefined) => void;
  disabled?: boolean;
  className?: string;
};

/**
 * Bouton stylé + champ fichier masqué (cohérent avec le thème de l’app).
 */
export function FilePickField({
  accept,
  buttonLabel,
  emptyHint = "Aucun fichier choisi",
  selectedLabel,
  onFileChange,
  disabled = false,
  className = "",
}: FilePickFieldProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  function handleChange(ev: ChangeEvent<HTMLInputElement>) {
    onFileChange(ev.target.files?.[0]);
  }

  function handlePickClick() {
    inputRef.current?.click();
  }

  const showName = selectedLabel?.trim() || emptyHint;

  return (
    <div className={`file-pick-field ${className}`.trim()}>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        className="file-pick-field-native"
        accept={accept}
        onChange={handleChange}
        disabled={disabled}
        aria-label={buttonLabel}
      />
      <button
        type="button"
        className="file-pick-field-btn"
        onClick={handlePickClick}
        disabled={disabled}
      >
        {buttonLabel}
      </button>
      <span className="file-pick-field-name" title={showName}>
        {showName}
      </span>
    </div>
  );
}
