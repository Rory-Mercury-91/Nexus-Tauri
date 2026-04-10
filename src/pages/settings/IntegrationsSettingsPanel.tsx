import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useDataFetchOverlay } from "@/contexts/DataFetchOverlayContext";
import { getSupabaseClient } from "@/lib/supabaseClient";
import { openExternalUrl } from "@/lib/tauriWindow";
import {
  disconnectIntegration,
  fetchIntegrationStatus,
  startIntegrationConnect,
  type IntegrationConnectionStatus,
  type IntegrationProvider,
} from "@/services/integrations/integrationService";

type ProviderState = {
  status: IntegrationConnectionStatus;
  busy: boolean;
  error: string | null;
};

const DEFAULT_STATUS: IntegrationConnectionStatus = {
  connected: false,
  accountLabel: null,
  expiresAt: null,
};

/**
 * Onglet "Intégrations" : connexion OAuth MAL et AniList.
 */
export function IntegrationsSettingsPanel() {
  const { beginPageDataLoad, endPageDataLoad } = useDataFetchOverlay();
  const [stateByProvider, setStateByProvider] = useState<
    Record<IntegrationProvider, ProviderState>
  >({
    mal: { status: DEFAULT_STATUS, busy: false, error: null },
    anilist: { status: DEFAULT_STATUS, busy: false, error: null },
  });
  const [globalInfo, setGlobalInfo] = useState<string | null>(null);

  const setProviderState = useCallback(
    (provider: IntegrationProvider, patch: Partial<ProviderState>) => {
      setStateByProvider((prev) => ({
        ...prev,
        [provider]: {
          ...prev[provider],
          ...patch,
        },
      }));
    },
    []
  );

  const loadProviderStatus = useCallback(
    async (provider: IntegrationProvider) => {
      const supabase = getSupabaseClient();
      const result = await fetchIntegrationStatus(supabase, provider);
      if (!result.ok) {
        setProviderState(provider, { error: result.error });
        return;
      }
      setProviderState(provider, { status: result.status, error: null });
    },
    [setProviderState]
  );

  const loadAllStatuses = useCallback(async () => {
    beginPageDataLoad();
    try {
      await Promise.all([loadProviderStatus("mal"), loadProviderStatus("anilist")]);
    } finally {
      endPageDataLoad();
    }
  }, [beginPageDataLoad, endPageDataLoad, loadProviderStatus]);

  useEffect(() => {
    void loadAllStatuses();
  }, [loadAllStatuses]);

  useEffect(() => {
    const url = new URL(window.location.href);
    const oauthResult = url.searchParams.get("integration_oauth");
    const oauthProvider = url.searchParams.get("provider") as
      | IntegrationProvider
      | null;
    const oauthReason = url.searchParams.get("integration_oauth_reason");
    if (!oauthResult || !oauthProvider) {
      return;
    }

    const reasonText = oauthReason ? ` (${oauthReason})` : "";
    if (oauthResult === "success") {
      setGlobalInfo(
        `Connexion ${oauthProvider.toUpperCase()} réussie. Statut rafraîchi.`
      );
      setProviderState(oauthProvider, { error: null });
      void loadProviderStatus(oauthProvider);
    } else {
      setProviderState(oauthProvider, {
        error: `Connexion ${oauthProvider.toUpperCase()} échouée: ${oauthResult}${reasonText}`,
      });
    }

    url.searchParams.delete("integration_oauth");
    url.searchParams.delete("integration_oauth_reason");
    url.searchParams.delete("provider");
    window.history.replaceState({}, "", url.toString());
  }, [loadProviderStatus, setProviderState]);

  const handleConnect = useCallback(
    async (provider: IntegrationProvider) => {
      setProviderState(provider, { busy: true, error: null });
      beginPageDataLoad();
      try {
        const supabase = getSupabaseClient();
        const result = await startIntegrationConnect(supabase, provider);
        if (!result.ok) {
          setProviderState(provider, { error: result.error });
          return;
        }
        // Priorité: navigateur système via Tauri shell plugin.
        // Fallback: redirection navigateur courant (mode web hors Tauri).
        const openedExternally = await openExternalUrl(result.authUrl);
        if (!openedExternally) {
          window.location.assign(result.authUrl);
        }
      } finally {
        setProviderState(provider, { busy: false });
        endPageDataLoad();
      }
    },
    [beginPageDataLoad, endPageDataLoad, setProviderState]
  );

  const handleDisconnect = useCallback(
    async (provider: IntegrationProvider) => {
      setProviderState(provider, { busy: true, error: null });
      beginPageDataLoad();
      try {
        const supabase = getSupabaseClient();
        const result = await disconnectIntegration(supabase, provider);
        if (!result.ok) {
          setProviderState(provider, { error: result.error });
          return;
        }
        await loadProviderStatus(provider);
      } finally {
        setProviderState(provider, { busy: false });
        endPageDataLoad();
      }
    },
    [beginPageDataLoad, endPageDataLoad, loadProviderStatus, setProviderState]
  );

  const handleRefresh = useCallback(
    async (provider: IntegrationProvider) => {
      setProviderState(provider, { busy: true, error: null });
      beginPageDataLoad();
      try {
        await loadProviderStatus(provider);
      } finally {
        setProviderState(provider, { busy: false });
        endPageDataLoad();
      }
    },
    [beginPageDataLoad, endPageDataLoad, loadProviderStatus, setProviderState]
  );

  const cards = useMemo<
    Array<{ provider: IntegrationProvider; title: string; lead: string }>
  >(
    () => [
      {
        provider: "mal",
        title: "MyAnimeList",
        lead: "Connexion OAuth officielle pour récupérer ton suivi personnel (watching/completed, progression, score).",
      },
      {
        provider: "anilist",
        title: "AniList",
        lead: "Connexion OAuth AniList pour synchroniser ton suivi, tes statuts et tes notes utilisateur.",
      },
    ],
    []
  );

  const tampermonkeyGuideUrl = useMemo(
    () => new URL("/tampermonkey/INSTALLATION.html", window.location.origin).toString(),
    []
  );
  const tampermonkeyScriptUrl = useMemo(
    () =>
      new URL(
        "/tampermonkey/Nautiljon%20Extractor.user.js",
        window.location.origin
      ).toString(),
    []
  );

  const openTampermonkeyGuide = useCallback(async () => {
    const openedExternally = await openExternalUrl(tampermonkeyGuideUrl);
    if (!openedExternally) {
      window.open(tampermonkeyGuideUrl, "_blank", "noopener,noreferrer");
    }
  }, [tampermonkeyGuideUrl]);

  const openTampermonkeyScript = useCallback(async () => {
    const openedExternally = await openExternalUrl(tampermonkeyScriptUrl);
    if (!openedExternally) {
      window.open(tampermonkeyScriptUrl, "_blank", "noopener,noreferrer");
    }
  }, [tampermonkeyScriptUrl]);

  return (
    <div className="integrations-settings">
      {globalInfo ? <p className="settings-success">{globalInfo}</p> : null}
      {cards.map((card) => {
        const providerState = stateByProvider[card.provider];
        const status = providerState.status;
        return (
          <section
            key={card.provider}
            className="settings-block integrations-settings-block"
            aria-labelledby={`integrations-${card.provider}`}
          >
            <h2 id={`integrations-${card.provider}`} className="settings-block-title">
              {card.title}
            </h2>
            <p className="settings-block-lead">{card.lead}</p>

            <p
              className={
                status.connected
                  ? "integrations-status integrations-status-connected"
                  : "integrations-status integrations-status-disconnected"
              }
            >
              {status.connected
                ? `Connecté${status.accountLabel ? ` : ${status.accountLabel}` : ""}`
                : "Non connecté"}
            </p>
            {providerState.error ? (
              <p className="settings-error">{providerState.error}</p>
            ) : null}

            <div className="integrations-actions">
              {status.connected ? (
                <button
                  type="button"
                  className="integrations-disconnect-btn"
                  disabled={providerState.busy}
                  onClick={() => void handleDisconnect(card.provider)}
                >
                  {providerState.busy ? "Déconnexion…" : "Se déconnecter"}
                </button>
              ) : (
                <button
                  type="button"
                  className="integrations-connect-btn"
                  disabled={providerState.busy}
                  onClick={() => void handleConnect(card.provider)}
                >
                  {providerState.busy ? "Connexion…" : "Se connecter"}
                </button>
              )}
              <button
                type="button"
                title="Actualiser l'état"
                aria-label={`Actualiser l'état ${card.title}`}
                className="family-settings-btn-secondary integrations-refresh-btn"
                disabled={providerState.busy}
                onClick={() => void handleRefresh(card.provider)}
              >
                <RefreshCw size={16} />
              </button>
            </div>
          </section>
        );
      })}
      <section
        className="settings-block integrations-settings-block"
        aria-labelledby="integrations-tampermonkey"
      >
        <h2 id="integrations-tampermonkey" className="settings-block-title">
          Tampermonkey (Nautiljon)
        </h2>
        <p className="settings-block-lead">
          Installe le script Nautiljon directement depuis l’application pour enrichir les fiches
          lectures (VF prioritaire).
        </p>
        <div className="integrations-actions integrations-tampermonkey-actions">
          <button
            type="button"
            className="integrations-connect-btn"
            onClick={() => void openTampermonkeyGuide()}
          >
            Ouvrir le guide
          </button>
          <button
            type="button"
            className="family-settings-btn-secondary"
            onClick={() => void openTampermonkeyScript()}
          >
            Télécharger / Installer le script
          </button>
        </div>
      </section>
    </div>
  );
}
