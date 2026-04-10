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
    const { error } = await supabase
      .from("oauth_connections")
      .delete()
      .eq("user_id", userId)
      .eq("provider", provider);
    if (error) {
      return jsonResponse(
        { error: `Impossible de supprimer la connexion: ${error.message}` },
        500
      );
    }

    return jsonResponse({ success: true }, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur inconnue.";
    return jsonResponse({ error: message }, 500);
  }
});
