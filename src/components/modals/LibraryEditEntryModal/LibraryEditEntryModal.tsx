import { useState } from "react";
import { Modal } from "@/components/common/Modal";
import { ToggleSwitch } from "@/components/common/ToggleSwitch";
import "./LibraryEditEntryModal.css";

export type LibraryEditFieldType = "text" | "number" | "textarea" | "select" | "toggle";

export type LibraryEditFieldOption = {
  value: string;
  label: string;
};

export type LibraryEditField = {
  key: string;
  label: string;
  group?: string;
  type: LibraryEditFieldType;
  value: string | number | boolean;
  placeholder?: string;
  rows?: number;
  min?: number;
  step?: number;
  span2?: boolean;
  options?: LibraryEditFieldOption[];
};

type LibraryEditEntryModalProps = {
  open: boolean;
  title: string;
  fields: LibraryEditField[];
  saving?: boolean;
  saveLabel?: string;
  translateLabel?: string;
  onTranslate?: () => void;
  translateDisabled?: boolean;
  helpTitle?: string;
  helpLines?: string[];
  onChange: (key: string, value: string | number | boolean) => void;
  onClose: () => void;
  onSave: () => void;
};

export function LibraryEditEntryModal({
  open,
  title,
  fields,
  saving = false,
  saveLabel = "Enregistrer",
  translateLabel = "Traduire",
  onTranslate,
  translateDisabled = false,
  helpTitle = "Aide",
  helpLines,
  onChange,
  onClose,
  onSave,
}: LibraryEditEntryModalProps) {
  const [helpOpen, setHelpOpen] = useState(false);
  const groupedFields = fields.reduce<Array<{ title: string; fields: LibraryEditField[] }>>((acc, field) => {
    const title = (field.group ?? "Général").trim() || "Général";
    const existing = acc.find((item) => item.title === title);
    if (existing) {
      existing.fields.push(field);
      return acc;
    }
    acc.push({ title, fields: [field] });
    return acc;
  }, []);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      maxWidth="min(96vw, 56rem)"
    >
      {helpLines && helpLines.length > 0 ? (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
          <button
            type="button"
            className="anime-detail-action-btn"
            onClick={() => setHelpOpen(true)}
            disabled={saving}
            title="Aide au remplissage"
          >
            ?
          </button>
        </div>
      ) : null}
      <div className="library-edit-modal-sections">
        {groupedFields.map((group) => (
          <section key={group.title} className="library-edit-modal-section">
            <div className="library-edit-modal-section-head">
              <h3 className="library-edit-modal-section-title">{group.title}</h3>
              {onTranslate && group.title.toLowerCase() === "synopsis" ? (
                <button
                  type="button"
                  className="anime-detail-action-btn library-edit-translate-inline-btn"
                  onClick={onTranslate}
                  disabled={saving || translateDisabled}
                >
                  {translateLabel}
                </button>
              ) : null}
            </div>
            <div className="library-edit-modal-grid">
              {group.fields.map((field) => {
                const wrapperClass = `library-edit-modal-field${field.span2 ? " is-span-2" : ""}`;
                if (field.type === "toggle") {
                  return (
                    <div key={field.key} className={`${wrapperClass} is-toggle`}>
                      <span>{field.label}</span>
                      <ToggleSwitch
                        checked={Boolean(field.value)}
                        onChange={(checked) => onChange(field.key, checked)}
                        disabled={saving}
                      />
                    </div>
                  );
                }
                if (field.type === "textarea") {
                  return (
                    <label key={field.key} className={wrapperClass}>
                      {field.label}
                      <textarea
                        value={String(field.value ?? "")}
                        placeholder={field.placeholder}
                        rows={field.rows ?? 4}
                        onChange={(e) => onChange(field.key, e.target.value)}
                        disabled={saving}
                      />
                    </label>
                  );
                }
                if (field.type === "select") {
                  return (
                    <label key={field.key} className={wrapperClass}>
                      {field.label}
                      <select
                        value={String(field.value ?? "")}
                        onChange={(e) => onChange(field.key, e.target.value)}
                        disabled={saving}
                      >
                        {(field.options ?? []).map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  );
                }
                return (
                  <label key={field.key} className={wrapperClass}>
                    {field.label}
                    <input
                      type={field.type === "number" ? "number" : "text"}
                      value={field.type === "number" ? Number(field.value ?? 0) : String(field.value ?? "")}
                      placeholder={field.placeholder}
                      min={field.min}
                      step={field.step}
                      onChange={(e) => onChange(field.key, field.type === "number" ? Number(e.target.value) || 0 : e.target.value)}
                      disabled={saving}
                    />
                  </label>
                );
              })}
            </div>
          </section>
        ))}
      </div>
      <div className="library-edit-modal-actions">
        <button type="button" className="anime-detail-action-btn" onClick={onClose} disabled={saving}>
          Annuler
        </button>
        <button type="button" className="anime-detail-action-btn anime-detail-action-btn-primary" onClick={onSave} disabled={saving}>
          {saving ? "Enregistrement..." : saveLabel}
        </button>
      </div>
      <Modal
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        title={helpTitle}
        maxWidth="min(96vw, 40rem)"
      >
        <ul style={{ margin: 0, paddingLeft: "1rem" }}>
          {(helpLines ?? []).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </Modal>
    </Modal>
  );
}
