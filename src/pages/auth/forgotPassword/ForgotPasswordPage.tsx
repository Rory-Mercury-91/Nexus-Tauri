import { type FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { sendPasswordRecoveryEmail } from "@/services/auth/authActions";
import "@/pages/auth/authFlow/AuthFlowPage.css";

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSuccess(null);
    const result = await sendPasswordRecoveryEmail(email);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSuccess("Email envoyé. Ouvre le lien reçu pour choisir un nouveau mot de passe.");
  }

  return (
    <div className="auth-flow-page">
      <div className="auth-flow-card">
        <h1 className="auth-flow-title">Mot de passe oublié</h1>
        <p className="auth-flow-message">
          Renseigne ton email: un lien sécurisé sera envoyé pour définir un nouveau mot de passe.
        </p>
        <form className="auth-flow-form" onSubmit={handleSubmit}>
          <label htmlFor="forgot-email">Email</label>
          <input
            id="forgot-email"
            type="email"
            value={email}
            required
            autoComplete="email"
            onChange={(event) => setEmail(event.target.value)}
          />
          {error ? <p className="auth-flow-error">{error}</p> : null}
          {success ? <p className="auth-flow-success">{success}</p> : null}
          <div className="auth-flow-actions">
            <button type="submit" disabled={busy}>
              {busy ? "Envoi…" : "Envoyer le lien"}
            </button>
            <Link to="/login">Retour connexion</Link>
          </div>
        </form>
      </div>
    </div>
  );
}
