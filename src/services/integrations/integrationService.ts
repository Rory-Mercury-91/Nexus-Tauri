import type { SupabaseClient } from "@supabase/supabase-js";
import { invokeEdgeFunction } from "@/services/supabase/edgeFunctionInvoke";

export type IntegrationProvider = "mal" | "anilist";

export type IntegrationConnectionStatus = {
  connected: boolean;
  accountLabel: string | null;
  expiresAt: string | null;
};

type StatusFunctionResponse = {
  connected?: boolean;
  account_label?: string | null;
  accountLabel?: string | null;
  expires_at?: string | null;
  expiresAt?: string | null;
};

type StartConnectFunctionResponse = {
  auth_url?: string;
  authUrl?: string;
};

/** En-têtes Authorization + apikey pour invoquer les Edge Functions avec la session courante. */
export async function getInvokeAuthHeaders(
  supabase: SupabaseClient
): Promise<Record<string, string> | null> {
  async function readValidSession(): Promise<string | null> {
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      return null;
    }
    let session = data.session ?? null;
    // Évite d'envoyer un JWT expiré à la gateway Edge Functions (cause fréquente de 401).
    if (!session || (session.expires_at && session.expires_at * 1000 <= Date.now() + 60_000)) {
      const refreshed = await supabase.auth.refreshSession();
      if (refreshed.error) {
        return null;
      }
      session = refreshed.data.session ?? null;
    }
    const accessToken = session?.access_token ?? "";
    if (!accessToken) {
      return null;
    }
    return accessToken;
  }

  const accessToken = await readValidSession();
  if (!accessToken) {
    return null;
  }

  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!anonKey) {
    return null;
  }
  return {
    Authorization: `Bearer ${accessToken}`,
    apikey: anonKey,
  };
}

/**
 * Récupère l’état de connexion OAuth pour un provider.
 */
export async function fetchIntegrationStatus(
  supabase: SupabaseClient,
  provider: IntegrationProvider
): Promise<
  { ok: true; status: IntegrationConnectionStatus } | { ok: false; error: string }
> {
  try {
    const payload = await invokeEdgeFunction<StatusFunctionResponse>(
      supabase,
      "integration-connection-status",
      { provider }
    );
    return {
      ok: true,
      status: {
        connected: Boolean(payload.connected),
        accountLabel: payload.account_label ?? payload.accountLabel ?? null,
        expiresAt: payload.expires_at ?? payload.expiresAt ?? null,
      },
    };
  } catch (e) {
    return {
      ok: false,
      error:
        e instanceof Error
          ? e.message
          : `Impossible de récupérer le statut de connexion (${provider}).`,
    };
  }
}

/**
 * Démarre le flow OAuth et renvoie l’URL d’autorisation à ouvrir.
 */
export async function startIntegrationConnect(
  supabase: SupabaseClient,
  provider: IntegrationProvider
): Promise<{ ok: true; authUrl: string } | { ok: false; error: string }> {
  try {
    const payload = await invokeEdgeFunction<StartConnectFunctionResponse>(
      supabase,
      "integration-start-connect",
      { provider }
    );
    const authUrl = payload.auth_url ?? payload.authUrl ?? "";
    if (!authUrl) {
      return {
        ok: false,
        error:
          "La fonction backend n’a pas renvoyé d’URL d’autorisation. Vérifie la configuration Edge Functions.",
      };
    }
    return { ok: true, authUrl };
  } catch (e) {
    return {
      ok: false,
      error:
        e instanceof Error
          ? e.message
          : `Impossible de démarrer la connexion OAuth (${provider}).`,
    };
  }
}

/**
 * Déconnecte le provider pour l’utilisateur courant.
 */
export async function disconnectIntegration(
  supabase: SupabaseClient,
  provider: IntegrationProvider
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await invokeEdgeFunction(supabase, "integration-disconnect", { provider });
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error:
        e instanceof Error
          ? e.message
          : `Impossible de déconnecter l’intégration (${provider}).`,
    };
  }
}
