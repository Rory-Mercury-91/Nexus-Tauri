import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  envOrThrow,
  resolveFrontendReturnUrl,
  type Provider,
} from "../_shared/integration-helpers.ts";

function redirectWithQuery(baseUrl: string, params: Record<string, string>): Response {
  const u = new URL(baseUrl);
  for (const [k, v] of Object.entries(params)) {
    u.searchParams.set(k, v);
  }
  return Response.redirect(u.toString(), 302);
}

async function exchangeMalCode(
  code: string,
  redirectUri: string,
  codeVerifier: string
): Promise<{
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
}> {
  const clientId = envOrThrow("MAL_CLIENT_ID");
  const clientSecret = Deno.env.get("MAL_CLIENT_SECRET");
  const body = new URLSearchParams();
  body.set("grant_type", "authorization_code");
  body.set("client_id", clientId);
  if (clientSecret) {
    body.set("client_secret", clientSecret);
  }
  body.set("code", code);
  body.set("code_verifier", codeVerifier);
  body.set("redirect_uri", redirectUri);

  const tokenResp = await fetch("https://myanimelist.net/v1/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!tokenResp.ok) {
    const errText = await tokenResp.text();
    throw new Error(`MAL token exchange HTTP ${tokenResp.status} - ${errText}`);
  }
  const tokenData = (await tokenResp.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!tokenData.access_token) {
    throw new Error("Token MAL manquant dans la réponse.");
  }
  const expiresAt =
    typeof tokenData.expires_in === "number"
      ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
      : null;
  return {
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token ?? null,
    expiresAt,
  };
}

async function fetchMalAccountLabel(accessToken: string): Promise<string | null> {
  const resp = await fetch("https://api.myanimelist.net/v2/users/@me", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!resp.ok) {
    return null;
  }
  const data = (await resp.json()) as { name?: string };
  return data.name ?? null;
}

async function exchangeAniListCode(
  code: string,
  redirectUri: string
): Promise<{
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
}> {
  const clientId = envOrThrow("ANILIST_CLIENT_ID");
  const clientSecret = envOrThrow("ANILIST_CLIENT_SECRET");
  const tokenResp = await fetch("https://anilist.co/api/v2/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      code,
    }),
  });
  if (!tokenResp.ok) {
    const errText = await tokenResp.text();
    throw new Error(`AniList token exchange HTTP ${tokenResp.status} - ${errText}`);
  }
  const tokenData = (await tokenResp.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!tokenData.access_token) {
    throw new Error("Token AniList manquant dans la réponse.");
  }
  const expiresAt =
    typeof tokenData.expires_in === "number"
      ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
      : null;
  return {
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token ?? null,
    expiresAt,
  };
}

async function fetchAniListAccountLabel(accessToken: string): Promise<string | null> {
  const resp = await fetch("https://graphql.anilist.co", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      query: "query { Viewer { name } }",
    }),
  });
  if (!resp.ok) {
    return null;
  }
  const data = (await resp.json()) as {
    data?: { Viewer?: { name?: string } };
  };
  return data.data?.Viewer?.name ?? null;
}

Deno.serve(async (req) => {
  if (req.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }

  const frontendReturnUrl = resolveFrontendReturnUrl();

  let provider: Provider = "mal";
  try {
    const url = new URL(req.url);
    const parts = url.pathname.split("/").filter(Boolean);
    const providerCandidate = parts[parts.length - 1] as Provider;
    provider =
      providerCandidate === "mal" || providerCandidate === "anilist"
        ? providerCandidate
        : "mal";

    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const oauthError = url.searchParams.get("error");

    if (oauthError) {
      return redirectWithQuery(frontendReturnUrl, {
        integration_oauth: "error",
        integration_oauth_reason: oauthError,
        provider,
      });
    }
    if (!code || !state) {
      return redirectWithQuery(frontendReturnUrl, {
        integration_oauth: "missing_code_or_state",
        provider,
      });
    }

    const supabaseUrl = envOrThrow("SUPABASE_URL");
    const serviceRole = envOrThrow("SUPABASE_SERVICE_ROLE_KEY");
    const adminClient = createClient(supabaseUrl, serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: stateRow, error: stateError } = await adminClient
      .from("oauth_connect_states")
      .select("state, provider, user_id, code_verifier, redirect_uri, expires_at")
      .eq("state", state)
      .maybeSingle();

    if (stateError || !stateRow) {
      console.error("OAuth callback invalid_state", { provider, state, stateError });
      return redirectWithQuery(frontendReturnUrl, {
        integration_oauth: "invalid_state",
        provider,
      });
    }

    if (stateRow.provider !== provider) {
      console.error("OAuth callback provider_mismatch", {
        expected: stateRow.provider,
        got: provider,
      });
      return redirectWithQuery(frontendReturnUrl, {
        integration_oauth: "provider_mismatch",
        provider,
      });
    }

    if (new Date(stateRow.expires_at).getTime() < Date.now()) {
      console.error("OAuth callback state_expired", {
        provider,
        expiresAt: stateRow.expires_at,
      });
      await adminClient.from("oauth_connect_states").delete().eq("state", state);
      return redirectWithQuery(frontendReturnUrl, {
        integration_oauth: "state_expired",
        provider,
      });
    }

    let accessToken = "";
    let refreshToken: string | null = null;
    let expiresAt: string | null = null;
    let accountLabel: string | null = null;

    if (provider === "mal") {
      const mal = await exchangeMalCode(code, stateRow.redirect_uri, stateRow.code_verifier);
      accessToken = mal.accessToken;
      refreshToken = mal.refreshToken;
      expiresAt = mal.expiresAt;
      accountLabel = await fetchMalAccountLabel(accessToken);
    } else {
      const anilist = await exchangeAniListCode(code, stateRow.redirect_uri);
      accessToken = anilist.accessToken;
      refreshToken = anilist.refreshToken;
      expiresAt = anilist.expiresAt;
      accountLabel = await fetchAniListAccountLabel(accessToken);
    }

    const { error: upsertError } = await adminClient
      .from("oauth_connections")
      .upsert(
        {
          user_id: stateRow.user_id,
          provider,
          access_token: accessToken,
          refresh_token: refreshToken,
          expires_at: expiresAt,
          account_label: accountLabel,
          metadata: {},
        },
        { onConflict: "user_id,provider" }
      );
    if (upsertError) {
      throw new Error(`Upsert oauth_connections impossible: ${upsertError.message}`);
    }

    await adminClient.from("oauth_connect_states").delete().eq("state", state);

    return redirectWithQuery(frontendReturnUrl, {
      integration_oauth: "success",
      provider,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    console.error("OAuth callback error", { provider, message });
    return redirectWithQuery(frontendReturnUrl, {
      integration_oauth: "error",
      integration_oauth_reason: message,
      provider,
    });
  }
});
