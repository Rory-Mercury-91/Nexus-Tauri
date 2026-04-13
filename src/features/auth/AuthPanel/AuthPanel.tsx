import { type FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { notifyProfileChanged } from "@/lib/profileEvents";
import {
  signInWithEmailPassword,
  signUpWithEmailPassword,
} from "@/services/auth/authActions";
import "./AuthPanel.css";

export type AuthTab = "login" | "register";

type AuthPanelProps = {
  initialTab: AuthTab;
  onSuccess?: () => void;
};

export function AuthPanel({ initialTab, onSuccess }: AuthPanelProps) {
  const [tab, setTab] = useState<AuthTab>(initialTab);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [pseudo, setPseudo] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      const result = await signInWithEmailPassword(email, password);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onSuccess?.();
    } finally {
      setLoading(false);
    }
  }

  async function handleRegister(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    if (password !== passwordConfirm) {
      setError("Les deux mots de passe ne correspondent pas.");
      return;
    }
    setLoading(true);
    try {
      const result = await signUpWithEmailPassword(email, password, pseudo);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (!result.hasSession) {
        setInfo(
          "Compte créé. Si la confirmation e-mail est activée sur Supabase, ouvre le lien reçu puis connecte-toi."
        );
        return;
      }
      notifyProfileChanged();
      onSuccess?.();
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="auth-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "login"}
          className={tab === "login" ? "auth-tab auth-tab-active" : "auth-tab"}
          onClick={() => {
            setTab("login");
            setError(null);
            setInfo(null);
            setPasswordConfirm("");
          }}
        >
          Connexion
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "register"}
          className={
            tab === "register" ? "auth-tab auth-tab-active" : "auth-tab"
          }
          onClick={() => {
            setTab("register");
            setError(null);
            setInfo(null);
            setPasswordConfirm("");
          }}
        >
          Créer un compte
        </button>
      </div>

      {tab === "login" ? (
        <>
          <h1 className="auth-panel-title">Connexion</h1>
          {error ? <div className="auth-error">{error}</div> : null}
          {info ? <div className="auth-info">{info}</div> : null}
          <form onSubmit={handleLogin}>
            <div className="auth-field">
              <label htmlFor="panel-login-email">Email</label>
              <input
                id="panel-login-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(ev) => setEmail(ev.target.value)}
              />
            </div>
            <div className="auth-field">
              <label htmlFor="panel-login-password">Mot de passe</label>
              <input
                id="panel-login-password"
                type="password"
                autoComplete="current-password"
                required
                minLength={6}
                value={password}
                onChange={(ev) => setPassword(ev.target.value)}
              />
            </div>
            <div className="auth-actions">
              <button type="submit" disabled={loading}>
                {loading ? "Connexion…" : "Se connecter"}
              </button>
              <Link to="/auth/forgot-password">Mot de passe oublié ?</Link>
            </div>
          </form>
        </>
      ) : (
        <>
          <h1 className="auth-panel-title">Créer un compte</h1>
          {error ? <div className="auth-error">{error}</div> : null}
          {info ? <div className="auth-info">{info}</div> : null}
          <form onSubmit={handleRegister}>
            <div className="auth-field">
              <label htmlFor="panel-reg-email">Email *</label>
              <input
                id="panel-reg-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(ev) => setEmail(ev.target.value)}
              />
            </div>
            <div className="auth-field">
              <label htmlFor="panel-reg-password">
                Mot de passe * (min. 6 caractères)
              </label>
              <input
                id="panel-reg-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={6}
                value={password}
                onChange={(ev) => setPassword(ev.target.value)}
              />
            </div>
            <div className="auth-field">
              <label htmlFor="panel-reg-password-confirm">
                Confirmation du mot de passe *
              </label>
              <input
                id="panel-reg-password-confirm"
                type="password"
                autoComplete="new-password"
                required
                minLength={6}
                value={passwordConfirm}
                onChange={(ev) => setPasswordConfirm(ev.target.value)}
              />
            </div>
            <p className="auth-section-title">Informations du profil</p>
            <div className="auth-field">
              <label htmlFor="panel-reg-pseudo">Pseudo *</label>
              <input
                id="panel-reg-pseudo"
                type="text"
                autoComplete="nickname"
                required
                minLength={2}
                value={pseudo}
                onChange={(ev) => setPseudo(ev.target.value)}
              />
            </div>
            <div className="auth-actions">
              <button type="submit" disabled={loading}>
                {loading ? "Création…" : "Créer le compte"}
              </button>
            </div>
          </form>
        </>
      )}
    </>
  );
}
