import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getSupabaseClient } from "@/lib/supabaseClient";
import "@/pages/auth/authFlow/AuthFlowPage.css";

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    if (password.length < 6) {
      setError("Le mot de passe doit contenir au moins 6 caractères.");
      return;
    }
    if (password !== confirm) {
      setError("Les mots de passe ne correspondent pas.");
      return;
    }
    setBusy(true);
    const supabase = getSupabaseClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setSuccess("Mot de passe mis à jour.");
    window.setTimeout(() => navigate("/", { replace: true }), 900);
  }

  return (
    <div className="auth-flow-page">
      <div className="auth-flow-card">
        <h1 className="auth-flow-title">Nouveau mot de passe</h1>
        <p className="auth-flow-message">
          Choisis un nouveau mot de passe pour terminer la récupération du compte.
        </p>
        <form className="auth-flow-form" onSubmit={handleSubmit}>
          <label htmlFor="reset-password">Nouveau mot de passe</label>
          <input
            id="reset-password"
            type="password"
            required
            minLength={6}
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <label htmlFor="reset-password-confirm">Confirmation</label>
          <input
            id="reset-password-confirm"
            type="password"
            required
            minLength={6}
            autoComplete="new-password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
          />
          {error ? <p className="auth-flow-error">{error}</p> : null}
          {success ? <p className="auth-flow-success">{success}</p> : null}
          <div className="auth-flow-actions">
            <button type="submit" disabled={busy}>
              {busy ? "Enregistrement…" : "Enregistrer"}
            </button>
            <Link to="/login">Retour connexion</Link>
          </div>
        </form>
      </div>
    </div>
  );
}
