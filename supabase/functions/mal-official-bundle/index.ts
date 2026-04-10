import {
  corsHeaders,
  createUserSupabaseClient,
  jsonResponse,
  envOrThrow,
  requireUserId,
} from "../_shared/integration-helpers.ts";

const MAL_API = "https://api.myanimelist.net/v2";

/** Champs documentés pour GET /anime/{id} (exemple officiel MAL API v2). */
const ANIME_DETAIL_FIELDS =
  "id,title,main_picture,alternative_titles,start_date,end_date,synopsis,mean,rank," +
  "popularity,num_list_users,num_scoring_users,nsfw,created_at,updated_at,media_type," +
  "status,genres,my_list_status,num_episodes,start_season,broadcast,source," +
  "average_episode_duration,rating,pictures,background,related_anime,related_manga," +
  "recommendations,studios,statistics";

const USER_ME_FIELDS =
  "id,name,picture,anime_statistics,manga_statistics,is_supporter,time_zone,gender,birthday,location,joined_at";

type MalPartResult =
  | { ok: true; data: unknown }
  | { ok: false; status: number; body: string };

async function malGetJson(
  accessToken: string,
  url: string
): Promise<MalPartResult> {
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const text = await resp.text();
  if (!resp.ok) {
    return { ok: false, status: resp.status, body: text.slice(0, 4000) };
  }
  try {
    return { ok: true, data: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, status: resp.status, body: text.slice(0, 4000) };
  }
}

async function refreshMalAccessToken(
  refreshToken: string
): Promise<{
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
}> {
  const clientId = envOrThrow("MAL_CLIENT_ID");
  const clientSecret = Deno.env.get("MAL_CLIENT_SECRET");
  const body = new URLSearchParams();
  body.set("grant_type", "refresh_token");
  body.set("refresh_token", refreshToken);
  body.set("client_id", clientId);
  if (clientSecret) {
    body.set("client_secret", clientSecret);
  }
  const tokenResp = await fetch("https://myanimelist.net/v1/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!tokenResp.ok) {
    const errText = await tokenResp.text();
    throw new Error(`Refresh MAL HTTP ${tokenResp.status} — ${errText.slice(0, 500)}`);
  }
  const tokenData = (await tokenResp.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!tokenData.access_token) {
    throw new Error("Réponse refresh MAL sans access_token.");
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Méthode non autorisée." }, 405);
  }

  try {
    const userId = await requireUserId(req);
    const body = (await req.json().catch(() => ({}))) as { mal_id?: number };
    const malId = body.mal_id;
    if (typeof malId !== "number" || !Number.isFinite(malId) || malId <= 0) {
      return jsonResponse({ error: "mal_id invalide." }, 400);
    }

    const supabase = createUserSupabaseClient(req);
    const { data: conn, error: connErr } = await supabase
      .from("oauth_connections")
      .select("id, access_token, refresh_token, expires_at")
      .eq("user_id", userId)
      .eq("provider", "mal")
      .maybeSingle();

    if (connErr) {
      return jsonResponse(
        { ok: false, code: "db_error", message: connErr.message },
        500
      );
    }
    if (!conn?.access_token) {
      return jsonResponse(
        {
          ok: false,
          code: "not_connected",
          message:
            "Aucun compte MyAnimeList connecté. Paramètres → Intégrations.",
        },
        200
      );
    }

    let accessToken = conn.access_token;
    const expiresMs = conn.expires_at
      ? Date.parse(conn.expires_at)
      : Number.NaN;
    const needsRefresh =
      !Number.isFinite(expiresMs) || expiresMs < Date.now() + 60_000;
    if (needsRefresh && conn.refresh_token) {
      try {
        const refreshed = await refreshMalAccessToken(conn.refresh_token);
        accessToken = refreshed.accessToken;
        await supabase
          .from("oauth_connections")
          .update({
            access_token: refreshed.accessToken,
            refresh_token: refreshed.refreshToken ?? conn.refresh_token,
            expires_at: refreshed.expiresAt,
            updated_at: new Date().toISOString(),
          })
          .eq("id", conn.id);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "refresh_inconnu";
        return jsonResponse(
          {
            ok: false,
            code: "token_expired",
            message: `Token MAL expiré ou refresh impossible : ${msg}`,
          },
          200
        );
      }
    } else if (needsRefresh && !conn.refresh_token) {
      return jsonResponse(
        {
          ok: false,
          code: "token_expired",
          message:
            "Token MAL expiré et pas de refresh token : reconnecte le compte MAL.",
        },
        200
      );
    }

    const animeUrl = new URL(`${MAL_API}/anime/${malId}`);
    animeUrl.searchParams.set("fields", ANIME_DETAIL_FIELDS);
    animeUrl.searchParams.set("nsfw", "true");

    const userUrl = new URL(`${MAL_API}/users/@me`);
    userUrl.searchParams.set("fields", USER_ME_FIELDS);

    const suggestionsUrl = new URL(`${MAL_API}/anime/suggestions`);
    suggestionsUrl.searchParams.set("limit", "10");
    suggestionsUrl.searchParams.set("fields", "id,title,main_picture,mean,media_type");
    suggestionsUrl.searchParams.set("nsfw", "true");

    const animelistUrl = new URL(`${MAL_API}/users/@me/animelist`);
    animelistUrl.searchParams.set("fields", "list_status,node{id,title,main_picture,mean}");
    animelistUrl.searchParams.set("limit", "8");
    animelistUrl.searchParams.set("offset", "0");
    animelistUrl.searchParams.set("sort", "list_updated_at");
    animelistUrl.searchParams.set("nsfw", "true");

    const rankingUrl = new URL(`${MAL_API}/anime/ranking`);
    rankingUrl.searchParams.set("ranking_type", "all");
    rankingUrl.searchParams.set("limit", "5");
    rankingUrl.searchParams.set("offset", "0");
    rankingUrl.searchParams.set("fields", "ranking,node{id,title,main_picture,mean}");
    rankingUrl.searchParams.set("nsfw", "true");

    const [userMe, animeDetail, suggestions, animelistSample, rankingSample] =
      await Promise.all([
        malGetJson(accessToken, userUrl.toString()),
        malGetJson(accessToken, animeUrl.toString()),
        malGetJson(accessToken, suggestionsUrl.toString()),
        malGetJson(accessToken, animelistUrl.toString()),
        malGetJson(accessToken, rankingUrl.toString()),
      ]);

    return jsonResponse({
      ok: true,
      mal_id: malId,
      fetched_at: new Date().toISOString(),
      parts: {
        user_me: userMe,
        anime_detail: animeDetail,
        anime_suggestions: suggestions,
        animelist_recent: animelistSample,
        anime_ranking_top_sample: rankingSample,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur inconnue.";
    return jsonResponse({ ok: false, code: "error", message }, 500);
  }
});
