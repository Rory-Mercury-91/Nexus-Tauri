import { type FormEvent, useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useDataFetchOverlay } from "@/contexts/DataFetchOverlayContext";
import {
  readReadingListDiagnosticsCache,
  writeReadingListDiagnosticsCache,
} from "@/lib/settingsPanelsCache";
import { FilePickField } from "@/components/common/FilePickField";
import { ProfileAvatarImage } from "@/components/common/ProfileAvatarImage";
import { notifyProfileChanged } from "@/lib/profileEvents";
import { getSupabaseClient } from "@/lib/supabaseClient";
import { isDebugModeEnabled, setDebugModeEnabled } from "@/lib/debugTools";
import {
  changeUserEmail,
  changePasswordWithVerification,
  updateUserDisplayName,
} from "@/services/auth/accountActions";
import { clearLocalCachesAndSignOut } from "@/services/app/localAppCacheService";
import {
  fetchIntegrationStatus,
  type IntegrationConnectionStatus,
  type IntegrationProvider,
} from "@/services/integrations/integrationService";
import {
  loadFullReadingDiagnostics,
  type FullReadingDiagnosticsResult,
} from "@/services/library/readingListDiagnosticsService";
import { updateProfileAvatarPath } from "@/services/profile/updateAvatarPath";
import { uploadUserAvatarObject } from "@/services/storage/avatarStorage";
import { useSession } from "@/hooks/useSession";
import { FamilySettingsPanel } from "./FamilySettingsPanel";
import { IntegrationsSettingsPanel } from "./IntegrationsSettingsPanel";
import { ReadingListsComparePanel } from "./ReadingListsComparePanel";
import { MihonSettingsPanel } from "./MihonSettingsPanel";
import { SecurityLogsPanel } from "./SecurityLogsPanel";
import { DebugJsonDiffPanel } from "./DebugJsonDiffPanel";
import "./SettingsPage.css";

const DEFAULT_INTEGRATION_STATUS: IntegrationConnectionStatus = {
  connected: false,
  accountLabel: null,
  expiresAt: null,
};

type IntegrationSlot = { status: IntegrationConnectionStatus; error: string | null };

type SettingsTab =
  | "profile"
  | "security"
  | "family"
  | "integrations"
  | "reading-lists"
  | "mihon"
  | "logs"
  | "debug";

/**
 * Paramètres en onglets : profil, sécurité, foyer, intégrations, listes manga, Mihon, logs, débug.
 */
export function SettingsPage() {
  const navigate = useNavigate();
  const { beginPageDataLoad, endPageDataLoad } = useDataFetchOverlay();
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
  const [nextEmail, setNextEmail] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cacheClearBusy, setCacheClearBusy] = useState(false);
  const [debugModeEnabled, setDebugModeState] = useState<boolean>(() => isDebugModeEnabled());

  const [integrationByProvider, setIntegrationByProvider] = useState<
    Record<IntegrationProvider, IntegrationSlot>
  >({
    mal: { status: DEFAULT_INTEGRATION_STATUS, error: null },
    anilist: { status: DEFAULT_INTEGRATION_STATUS, error: null },
  });
  const [readingDiagnostics, setReadingDiagnostics] = useState<FullReadingDiagnosticsResult | null>(
    null
  );
  const [readingDiagLoading, setReadingDiagLoading] = useState(false);
  const [readingDiagError, setReadingDiagError] = useState<string | null>(null);
  const [readingDiagAt, setReadingDiagAt] = useState<number | null>(null);

  const refreshIntegrationStatuses = useCallback(async () => {
    const supabase = getSupabaseClient();
    const [mal, ani] = await Promise.all([
      fetchIntegrationStatus(supabase, "mal"),
      fetchIntegrationStatus(supabase, "anilist"),
    ]);
    setIntegrationByProvider({
      mal: mal.ok
        ? { status: mal.status, error: null }
        : { status: DEFAULT_INTEGRATION_STATUS, error: mal.error },
      anilist: ani.ok
        ? { status: ani.status, error: null }
        : { status: DEFAULT_INTEGRATION_STATUS, error: ani.error },
    });
  }, []);

  const runReadingDiagnostics = useCallback(
    async (opts?: { withPageOverlay?: boolean }) => {
      const withPageOverlay = opts?.withPageOverlay !== false;
      if (!userId) return;
      setReadingDiagError(null);
      setReadingDiagLoading(true);
      if (withPageOverlay) beginPageDataLoad();
      try {
        const supabase = getSupabaseClient();
        const data = await loadFullReadingDiagnostics(supabase);
        setReadingDiagnostics(data);
        const at = Date.now();
        setReadingDiagAt(at);
        writeReadingListDiagnosticsCache(userId, data);
      } catch (e) {
        setReadingDiagError(e instanceof Error ? e.message : "Diagnostic impossible.");
      } finally {
        setReadingDiagLoading(false);
        if (withPageOverlay) endPageDataLoad();
      }
    },
    [userId, beginPageDataLoad, endPageDataLoad]
  );

  useEffect(() => {
    setPseudo(initialPseudo);
  }, [initialPseudo]);

  useEffect(() => {
    if (!userId) return;
    void refreshIntegrationStatuses();
    const cached = readReadingListDiagnosticsCache(userId);
    if (cached) {
      setReadingDiagnostics(cached.payload);
      setReadingDiagAt(cached.cachedAt);
    }
  }, [userId, refreshIntegrationStatuses]);

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

  async function handleClearLocalCacheAndSignOut() {
    if (
      !window.confirm(
        "Effacer tout le cache local (collections, accueil, préférences d’affichage, journaux client) et te déconnecter ? Cette action est irréversible sur cet appareil."
      )
    ) {
      return;
    }
    clearFeedback();
    setCacheClearBusy(true);
    try {
      const supabase = getSupabaseClient();
      await clearLocalCachesAndSignOut(supabase);
      navigate("/login", { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Impossible de vider le cache.");
    } finally {
      setCacheClearBusy(false);
    }
  }

  function handleToggleDebugMode(enabled: boolean) {
    setDebugModeState(enabled);
    setDebugModeEnabled(enabled);
    setMessage(enabled ? "Mode debug activé." : "Mode debug désactivé.");
    setError(null);
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

  async function handleEmailSubmit(e: FormEvent) {
    e.preventDefault();
    clearFeedback();
    if (!email) {
      setError("Email de session introuvable.");
      return;
    }
    setBusy(true);
    try {
      const r = await changeUserEmail(email, nextEmail);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setNextEmail("");
      setMessage(
        "Demande envoyée. Confirme la nouvelle adresse via l’email reçu."
      );
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
          aria-selected={tab === "reading-lists"}
          className={
            tab === "reading-lists" ? "settings-tab settings-tab-active" : "settings-tab"
          }
          onClick={() => {
            setTab("reading-lists");
            clearFeedback();
          }}
        >
          Listes manga
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
        <button
          type="button"
          role="tab"
          aria-selected={tab === "logs"}
          className={
            tab === "logs"
              ? "settings-tab settings-tab-active"
              : "settings-tab"
          }
          onClick={() => {
            setTab("logs");
            clearFeedback();
          }}
        >
          Logs
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "debug"}
          className={
            tab === "debug"
              ? "settings-tab settings-tab-active"
              : "settings-tab"
          }
          onClick={() => {
            setTab("debug");
            clearFeedback();
          }}
        >
          Débug
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
          <IntegrationsSettingsPanel onIntegrationStatusChanged={refreshIntegrationStatuses} />
        </div>
      ) : tab === "reading-lists" ? (
        <div className="settings-tab-panel" role="tabpanel">
          <ReadingListsComparePanel
            integrationByProvider={integrationByProvider}
            readingDiagnostics={readingDiagnostics}
            readingDiagLoading={readingDiagLoading}
            readingDiagError={readingDiagError}
            diagnosticsCachedAt={readingDiagAt}
            onRunDiagnostics={runReadingDiagnostics}
          />
        </div>
      ) : tab === "mihon" ? (
        <div className="settings-tab-panel" role="tabpanel">
          <MihonSettingsPanel />
        </div>
      ) : tab === "logs" ? (
        <div className="settings-tab-panel" role="tabpanel">
          <SecurityLogsPanel />
        </div>
      ) : tab === "debug" ? (
        <div className="settings-tab-panel" role="tabpanel">
          <section className="settings-block" aria-labelledby="settings-debug">
            <h2 id="settings-debug" className="settings-block-title">
              Mode debug
            </h2>
            <p className="settings-block-lead">
              Active les outils de diagnostic avancés (bouton « Exporter JSON » sur les fiches anime et lecture).
            </p>
            <div className="settings-debug-row">
              <label htmlFor="settings-debug-toggle">Activer le mode debug</label>
              <input
                id="settings-debug-toggle"
                type="checkbox"
                checked={debugModeEnabled}
                onChange={(ev) => handleToggleDebugMode(ev.target.checked)}
              />
            </div>
          </section>
          <DebugJsonDiffPanel />
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
          <section className="settings-block" aria-labelledby="settings-local-cache">
            <h2 id="settings-local-cache" className="settings-block-title">
              Données locales
            </h2>
            <p className="settings-block-lead">
              Supprime les caches de listes (anime / lectures), l’accueil mis en session, les positions de défilement,
              les préférences d’affichage stockées sur cet appareil et les journaux client, puis déconnecte ton compte.
            </p>
            <div className="settings-actions">
              <button
                type="button"
                className="settings-security-cache-clear-btn"
                disabled={cacheClearBusy || busy}
                onClick={() => void handleClearLocalCacheAndSignOut()}
              >
                {cacheClearBusy ? "Nettoyage…" : "Effacer le cache local et se déconnecter"}
              </button>
            </div>
          </section>

          <section className="settings-block" aria-labelledby="settings-email">
            <h2 id="settings-email" className="settings-block-title">
              Adresse email
            </h2>
            <p className="settings-block-lead">
              Un email de confirmation sera envoyé à la nouvelle adresse pour
              valider le changement.
            </p>
            <form className="settings-form" onSubmit={handleEmailSubmit}>
              <div className="settings-field">
                <label htmlFor="settings-current-email">Adresse actuelle</label>
                <input
                  id="settings-current-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  disabled
                />
              </div>
              <div className="settings-field">
                <label htmlFor="settings-next-email">Nouvelle adresse</label>
                <input
                  id="settings-next-email"
                  type="email"
                  autoComplete="email"
                  required
                  value={nextEmail}
                  onChange={(ev) => setNextEmail(ev.target.value)}
                  disabled={busy}
                />
              </div>
              <div className="settings-actions">
                <button type="submit" disabled={busy}>
                  {busy ? "Envoi…" : "Changer l’adresse email"}
                </button>
              </div>
            </form>
          </section>

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
