import { type FormEvent, useEffect, useState } from "react";
import { FilePickField } from "@/components/common/FilePickField";
import { ProfileAvatarImage } from "@/components/common/ProfileAvatarImage";
import { notifyProfileChanged } from "@/lib/profileEvents";
import { getSupabaseClient } from "@/lib/supabaseClient";
import {
  changePasswordWithVerification,
  updateUserDisplayName,
} from "@/services/auth/accountActions";
import { updateProfileAvatarPath } from "@/services/profile/updateAvatarPath";
import { uploadUserAvatarObject } from "@/services/storage/avatarStorage";
import { useSession } from "@/hooks/useSession";
import { FamilySettingsPanel } from "./FamilySettingsPanel";
import { IntegrationsSettingsPanel } from "./IntegrationsSettingsPanel";
import { MihonSettingsPanel } from "./MihonSettingsPanel";
import "./SettingsPage.css";

type SettingsTab = "profile" | "security" | "family" | "integrations" | "mihon";

/**
 * Paramètres en onglets : profil (pseudo + photo) et sécurité (mot de passe).
 */
export function SettingsPage() {
  const { session } = useSession();
  const email = session?.user.email ?? "";
  const userId = session?.user.id ?? "";

  const meta = session?.user.user_metadata as
    | { display_name?: string }
    | undefined;
  const initialPseudo = meta?.display_name?.trim() ?? "";

  const [tab, setTab] = useState<SettingsTab>("profile");

  const [pseudo, setPseudo] = useState(initialPseudo);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPath, setAvatarPath] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPseudo(initialPseudo);
  }, [initialPseudo]);

  useEffect(() => {
    async function loadAvatarPath() {
      if (!userId) return;
      const supabase = getSupabaseClient();
      const { data } = await supabase
        .from("profiles")
        .select("avatar_storage_path")
        .eq("id", userId)
        .single();
      if (data?.avatar_storage_path) {
        setAvatarPath(data.avatar_storage_path);
      }
    }
    void loadAvatarPath();
  }, [userId]);

  function clearFeedback() {
    setError(null);
    setMessage(null);
  }

  async function handlePseudoSubmit(e: FormEvent) {
    e.preventDefault();
    clearFeedback();
    setBusy(true);
    try {
      const r = await updateUserDisplayName(pseudo);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      notifyProfileChanged();
      setMessage("Pseudo enregistré.");
    } finally {
      setBusy(false);
    }
  }

  async function handleAvatarSubmit(e: FormEvent) {
    e.preventDefault();
    clearFeedback();
    if (!avatarFile) {
      setError("Choisis une image.");
      return;
    }
    setBusy(true);
    try {
      const supabase = getSupabaseClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setError("Session invalide.");
        return;
      }
      const uploaded = await uploadUserAvatarObject(supabase, user.id, avatarFile);
      if (!uploaded.ok) {
        setError(uploaded.error);
        return;
      }
      const saved = await updateProfileAvatarPath(
        supabase,
        user.id,
        uploaded.path
      );
      if (!saved.ok) {
        setError(saved.message);
        return;
      }
      setAvatarPath(uploaded.path);
      notifyProfileChanged();
      setAvatarFile(null);
      setMessage("Photo de profil mise à jour.");
    } finally {
      setBusy(false);
    }
  }

  async function handlePasswordSubmit(e: FormEvent) {
    e.preventDefault();
    clearFeedback();
    if (!email) {
      setError("Email de session introuvable.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("La confirmation ne correspond pas au nouveau mot de passe.");
      return;
    }
    setBusy(true);
    try {
      const r = await changePasswordWithVerification(
        email,
        currentPassword,
        newPassword
      );
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setMessage("Mot de passe mis à jour.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings-page">
      <h1 className="settings-page-title">Paramètres</h1>

      <div className="settings-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "profile"}
          className={
            tab === "profile" ? "settings-tab settings-tab-active" : "settings-tab"
          }
          onClick={() => {
            setTab("profile");
            clearFeedback();
          }}
        >
          Profil
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "security"}
          className={
            tab === "security"
              ? "settings-tab settings-tab-active"
              : "settings-tab"
          }
          onClick={() => {
            setTab("security");
            clearFeedback();
          }}
        >
          Sécurité
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "family"}
          className={
            tab === "family" ? "settings-tab settings-tab-active" : "settings-tab"
          }
          onClick={() => {
            setTab("family");
            clearFeedback();
          }}
        >
          Foyer
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "integrations"}
          className={
            tab === "integrations"
              ? "settings-tab settings-tab-active"
              : "settings-tab"
          }
          onClick={() => {
            setTab("integrations");
            clearFeedback();
          }}
        >
          Intégrations
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "mihon"}
          className={
            tab === "mihon"
              ? "settings-tab settings-tab-active"
              : "settings-tab"
          }
          onClick={() => {
            setTab("mihon");
            clearFeedback();
          }}
        >
          Mihon
        </button>
      </div>

      {error ? <p className="settings-error">{error}</p> : null}
      {message ? <p className="settings-success">{message}</p> : null}

      {tab === "family" ? (
        <div className="settings-tab-panel" role="tabpanel">
          <FamilySettingsPanel />
        </div>
      ) : tab === "integrations" ? (
        <div className="settings-tab-panel" role="tabpanel">
          <IntegrationsSettingsPanel />
        </div>
      ) : tab === "mihon" ? (
        <div className="settings-tab-panel" role="tabpanel">
          <MihonSettingsPanel />
        </div>
      ) : tab === "profile" ? (
        <div className="settings-tab-panel" role="tabpanel">
          <section className="settings-block" aria-labelledby="settings-pseudo">
            <h2 id="settings-pseudo" className="settings-block-title">
              Pseudo
            </h2>
            <form className="settings-form" onSubmit={handlePseudoSubmit}>
              <div className="settings-field">
                <input
                  id="settings-pseudo-input"
                  type="text"
                  autoComplete="nickname"
                  minLength={2}
                  required
                  value={pseudo}
                  onChange={(ev) => setPseudo(ev.target.value)}
                  disabled={busy}
                />
              </div>
              <div className="settings-actions">
                <button type="submit" disabled={busy}>
                  {busy ? "Enregistrement…" : "Enregistrer le pseudo"}
                </button>
              </div>
            </form>
          </section>

          <section className="settings-block" aria-labelledby="settings-photo">
            <h2 id="settings-photo" className="settings-block-title">
              Photo de profil
            </h2>
            {avatarPath && (
              <div className="settings-avatar-preview">
                <span className="settings-field-label">Photo actuelle</span>
                <ProfileAvatarImage 
                  size={100} 
                  storagePath={avatarPath}
                  displayName={pseudo || "Profil"}
                />
              </div>
            )}
            <form className="settings-form" onSubmit={handleAvatarSubmit}>
              <div className="settings-field">
                <span className="settings-field-label">Nouvelle image</span>
                <FilePickField
                  accept="image/*"
                  buttonLabel="Choisir un fichier"
                  selectedLabel={avatarFile?.name ?? null}
                  onFileChange={(f) => setAvatarFile(f ?? null)}
                  disabled={busy}
                />
              </div>
              <div className="settings-actions">
                <button type="submit" disabled={busy}>
                  {busy ? "Envoi…" : "Enregistrer la photo"}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : (
        <div className="settings-tab-panel" role="tabpanel">
          <section className="settings-block" aria-labelledby="settings-password">
            <h2 id="settings-password" className="settings-block-title">
              Mot de passe
            </h2>
            <form className="settings-form" onSubmit={handlePasswordSubmit}>
              <div className="settings-field">
                <label htmlFor="settings-current-pw">Mot de passe actuel</label>
                <input
                  id="settings-current-pw"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={currentPassword}
                  onChange={(ev) => setCurrentPassword(ev.target.value)}
                  disabled={busy}
                />
              </div>
              <div className="settings-field">
                <label htmlFor="settings-new-pw">Nouveau mot de passe</label>
                <input
                  id="settings-new-pw"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={6}
                  value={newPassword}
                  onChange={(ev) => setNewPassword(ev.target.value)}
                  disabled={busy}
                />
              </div>
              <div className="settings-field">
                <label htmlFor="settings-confirm-pw">
                  Confirmation du mot de passe
                </label>
                <input
                  id="settings-confirm-pw"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={6}
                  value={confirmPassword}
                  onChange={(ev) => setConfirmPassword(ev.target.value)}
                  disabled={busy}
                />
              </div>
              <div className="settings-actions">
                <button type="submit" disabled={busy}>
                  {busy ? "Mise à jour…" : "Changer le mot de passe"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
