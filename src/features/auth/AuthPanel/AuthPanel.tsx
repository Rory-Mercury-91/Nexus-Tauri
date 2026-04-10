import { type FormEvent, useEffect, useState } from "react";
import { FilePickField } from "@/components/common/FilePickField";
import { notifyProfileChanged } from "@/lib/profileEvents";
import { getSupabaseClient } from "@/lib/supabaseClient";
import {
  signInWithEmailPassword,
  signUpWithEmailPassword,
} from "@/services/auth/authActions";
import { updateProfileAvatarPath } from "@/services/profile/updateAvatarPath";
import { uploadUserAvatarObject } from "@/services/storage/avatarStorage";
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
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  function handleAvatarChange(file: File | undefined) {
    setAvatarFile(file ?? null);
    setAvatarPreview(null);
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setAvatarPreview(reader.result);
      }
    };
    reader.readAsDataURL(file);
  }

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
          avatarFile
            ? "Compte créé : sans session immédiate (souvent confirmation e-mail), la photo n’a pas été envoyée. Après la première connexion, ajoute-la dans Paramètres."
            : "Si la confirmation e-mail est activée sur Supabase, ouvrez le lien reçu par mail puis connectez-vous. Sinon, essayez de vous connecter."
        );
        return;
      }
      if (avatarFile) {
        const supabase = getSupabaseClient();
        await supabase.auth.getSession();
        const uploaded = await uploadUserAvatarObject(
          supabase,
          result.userId,
          avatarFile
        );
        if (!uploaded.ok) {
          setError(uploaded.error);
          return;
        }
        const saved = await updateProfileAvatarPath(
          supabase,
          result.userId,
          uploaded.path
        );
        if (!saved.ok) {
          setError(saved.message);
          return;
        }
        notifyProfileChanged();
      }
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
            <div className="auth-field">
              <span className="auth-field-label">Image</span>
              <FilePickField
                accept="image/*"
                buttonLabel="Choisir un fichier"
                selectedLabel={avatarFile?.name ?? null}
                onFileChange={handleAvatarChange}
                disabled={loading}
              />
              {avatarPreview ? (
                <img
                  className="auth-preview"
                  src={avatarPreview}
                  alt="Aperçu avatar"
                />
              ) : null}
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
