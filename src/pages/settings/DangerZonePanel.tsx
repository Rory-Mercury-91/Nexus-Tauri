import { useState } from "react";
import { getSupabaseClient } from "@/lib/supabaseClient";
import {
  resetUserData,
  resetScopeLabel,
  resetScopeTables,
  type ResetScope,
} from "@/services/app/resetUserDataService";

type ResetAction = {
  scope: ResetScope;
  confirmText: string;
};

const RESET_ACTIONS: ResetAction[] = [
  {
    scope: "anime",
    confirmText:
      "Cette action supprimera définitivement tous tes animés (library_anime). " +
      "Tape CONFIRMER pour continuer.",
  },
  {
    scope: "reading",
    confirmText:
      "Cette action supprimera définitivement toutes tes lectures (library_reading, " +
      "reading_mihon_presence, reading_volume_owners). Tape CONFIRMER pour continuer.",
  },
  {
    scope: "sync",
    confirmText:
      "Cette action supprimera définitivement tout l'historique de synchronisation " +
      "(sync_runs, sync_progress, sync_jobs). Tape CONFIRMER pour continuer.",
  },
  {
    scope: "all",
    confirmText:
      "⚠ ATTENTION — Cette action supprimera TOUTES tes données : animés, lectures, " +
      "volumes, présence Mihon, historique de synchronisation. " +
      "Cette opération est IRRÉVERSIBLE. Tape CONFIRMER pour continuer.",
  },
];

type ConfirmState = {
  scope: ResetScope;
  inputValue: string;
};

type ResultEntry = {
  scope: ResetScope;
  deleted: Record<string, number>;
  ts: number;
};

export function DangerZonePanel() {
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<ResultEntry[]>([]);

  function openConfirm(scope: ResetScope) {
    setError(null);
    setConfirm({ scope, inputValue: "" });
  }

  function closeConfirm() {
    setConfirm(null);
  }

  async function handleConfirm() {
    if (!confirm) return;
    if (confirm.inputValue.trim().toUpperCase() !== "CONFIRMER") {
      setError("Saisis exactement CONFIRMER pour valider.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const supabase = getSupabaseClient();
      const result = await resetUserData(supabase, confirm.scope);
      setResults((prev) => [{ scope: result.scope, deleted: result.deleted, ts: Date.now() }, ...prev]);
      setConfirm(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inconnue.");
    } finally {
      setBusy(false);
    }
  }

  const currentAction = RESET_ACTIONS.find((a) => a.scope === confirm?.scope);

  return (
    <section className="settings-block danger-zone-block" aria-labelledby="danger-zone-title">
      <h2 id="danger-zone-title" className="settings-block-title danger-zone-title">
        Zone dangereuse
      </h2>
      <p className="settings-block-lead">
        Ces actions suppriment définitivement les données côté serveur. Elles n'affectent pas ton
        compte ni tes identifiants — uniquement le contenu de ta bibliothèque.
      </p>

      <div className="danger-zone-actions">
        {RESET_ACTIONS.map((action) => (
          <div key={action.scope} className={`danger-zone-row${action.scope === "all" ? " is-critical" : ""}`}>
            <div className="danger-zone-row-info">
              <strong className="danger-zone-row-label">{resetScopeLabel(action.scope)}</strong>
              <span className="danger-zone-row-tables">{resetScopeTables(action.scope)}</span>
            </div>
            <button
              type="button"
              className={`danger-zone-btn${action.scope === "all" ? " is-critical" : ""}`}
              onClick={() => openConfirm(action.scope)}
              disabled={busy || confirm !== null}
            >
              Réinitialiser
            </button>
          </div>
        ))}
      </div>

      {/* Résultats des opérations passées */}
      {results.length > 0 && (
        <div className="danger-zone-results">
          <p className="danger-zone-results-title">Opérations effectuées</p>
          {results.map((r) => (
            <div key={r.ts} className="danger-zone-result-entry">
              <span className="danger-zone-result-scope">{resetScopeLabel(r.scope)}</span>
              <span className="danger-zone-result-time">
                {new Date(r.ts).toLocaleTimeString("fr-FR")}
              </span>
              <span className="danger-zone-result-counts">
                {Object.entries(r.deleted)
                  .map(([table, n]) => `${table} : ${n} ligne(s)`)
                  .join(" · ")}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Modale de confirmation inline */}
      {confirm && currentAction && (
        <div className="danger-zone-overlay" role="dialog" aria-modal="true" aria-labelledby="dz-confirm-title">
          <div className="danger-zone-dialog">
            <h3 id="dz-confirm-title" className="danger-zone-dialog-title">
              Confirmer : {resetScopeLabel(confirm.scope)}
            </h3>
            <p className="danger-zone-dialog-body">{currentAction.confirmText}</p>

            <label className="danger-zone-confirm-label">
              <span>Confirmation</span>
              <input
                type="text"
                className="danger-zone-confirm-input"
                placeholder="CONFIRMER"
                value={confirm.inputValue}
                onChange={(e) => {
                  setError(null);
                  setConfirm((prev) => prev ? { ...prev, inputValue: e.target.value } : null);
                }}
                autoFocus
                disabled={busy}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleConfirm();
                  if (e.key === "Escape") closeConfirm();
                }}
              />
            </label>

            {error && <p className="settings-error danger-zone-dialog-error">{error}</p>}

            <div className="danger-zone-dialog-actions">
              <button
                type="button"
                className="family-settings-btn-secondary"
                onClick={closeConfirm}
                disabled={busy}
              >
                Annuler
              </button>
              <button
                type="button"
                className={`danger-zone-btn${confirm.scope === "all" ? " is-critical" : ""}`}
                onClick={() => void handleConfirm()}
                disabled={busy || confirm.inputValue.trim().toUpperCase() !== "CONFIRMER"}
              >
                {busy ? "Suppression…" : "Confirmer la réinitialisation"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
