import {
  corsHeaders,
  createUserSupabaseClient,
  jsonResponse,
  randomBase64Url,
  requireUserId,
  resolveRedirectUri,
  type Provider,
} from "../_shared/integration-helpers.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Méthode non autorisée." }, 405);
  }

  try {
    const userId = await requireUserId(req);
    const body = (await req.json().catch(() => ({}))) as { provider?: Provider };
    const provider = body.provider;
    if (provider !== "mal" && provider !== "anilist") {
      return jsonResponse({ error: "Provider invalide." }, 400);
    }

    const supabase = createUserSupabaseClient(req);
    const state = randomBase64Url(24);
    const codeVerifier = randomBase64Url(48);
    const redirectUri = resolveRedirectUri(provider, req);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const { error: insertError } = await supabase.from("oauth_connect_states").insert({
      state,
      provider,
      user_id: userId,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
      expires_at: expiresAt,
    });
    if (insertError) {
      return jsonResponse(
        { error: `Impossible d'initialiser la connexion OAuth: ${insertError.message}` },
        500
      );
    }

    let authUrl = "";
    if (provider === "mal") {
      const malClientId = Deno.env.get("MAL_CLIENT_ID");
      if (!malClientId) {
        return jsonResponse({ error: "Secret backend MAL_CLIENT_ID manquant." }, 500);
      }
      // MAL fonctionne avec PKCE "plain" (historique API officielle MAL).
      const codeChallenge = codeVerifier;
      const u = new URL("https://myanimelist.net/v1/oauth2/authorize");
      u.searchParams.set("response_type", "code");
      u.searchParams.set("client_id", malClientId);
      u.searchParams.set("state", state);
      u.searchParams.set("code_challenge", codeChallenge);
      u.searchParams.set("code_challenge_method", "plain");
      u.searchParams.set("redirect_uri", redirectUri);
      authUrl = u.toString();
    } else {
      const anilistClientId = Deno.env.get("ANILIST_CLIENT_ID");
      if (!anilistClientId) {
        return jsonResponse({ error: "Secret backend ANILIST_CLIENT_ID manquant." }, 500);
      }
      const u = new URL("https://anilist.co/api/v2/oauth/authorize");
      u.searchParams.set("client_id", anilistClientId);
      u.searchParams.set("response_type", "code");
      u.searchParams.set("state", state);
      u.searchParams.set("redirect_uri", redirectUri);
      authUrl = u.toString();
    }

    return jsonResponse({ auth_url: authUrl }, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur inconnue.";
    return jsonResponse({ error: message }, 500);
  }
});
