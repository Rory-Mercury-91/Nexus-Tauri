import {
  corsHeaders,
  createUserSupabaseClient,
  jsonResponse,
  requireUserId,
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
    const { data, error } = await supabase
      .from("oauth_connections")
      .select("account_label, expires_at")
      .eq("user_id", userId)
      .eq("provider", provider)
      .maybeSingle();

    if (error) {
      return jsonResponse(
        { error: `Impossible de lire l'état OAuth: ${error.message}` },
        500
      );
    }

    if (!data) {
      return jsonResponse(
        { connected: false, account_label: null, expires_at: null },
        200
      );
    }

    return jsonResponse(
      {
        connected: true,
        account_label: data.account_label ?? null,
        expires_at: data.expires_at ?? null,
      },
      200
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur inconnue.";
    return jsonResponse({ error: message }, 500);
  }
});
