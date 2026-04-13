import {
  corsHeaders,
  createUserSupabaseClient,
  jsonResponse,
  requireUserId,
} from "../_shared/integration-helpers.ts";

const MAL_API = "https://api.myanimelist.net/v2";

type Body = {
  provider?: string;
  mal_manga_id?: unknown;
  /** "manga" (défaut) ou "anime" — chemins API MAL et type liste AniList. */
  media_catalog?: unknown;
};

async function graphqlAnilist(
  accessToken: string,
  query: string,
  variables?: Record<string, unknown>
): Promise<unknown> {
  const resp = await fetch("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ query, variables }),
  });
  const text = await resp.text();
  let json: { data?: unknown; errors?: Array<{ message?: string }> };
  try {
    json = JSON.parse(text) as typeof json;
  } catch {
    throw new Error(`Réponse AniList invalide (${resp.status}).`);
  }
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} ${text.slice(0, 280)}`);
  }
  if (json.errors?.length) {
    const msg = json.errors.map((e) => e.message ?? "?").join("; ");
    throw new Error(msg || "Erreur GraphQL AniList.");
  }
  return json.data;
}

async function getAnilistViewerId(accessToken: string): Promise<number> {
  const data = (await graphqlAnilist(accessToken, "query { Viewer { id } }")) as {
    Viewer?: { id?: number };
  };
  const id = Number(data?.Viewer?.id);
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error("Impossible de récupérer le profil AniList.");
  }
  return id;
}

async function findAnilistMediaListEntryId(
  accessToken: string,
  malMediaId: number,
  mediaType: "MANGA" | "ANIME"
): Promise<number | null> {
  const userId = await getAnilistViewerId(accessToken);
  const query = `
    query ($userId: Int, $type: MediaType) {
      MediaListCollection(type: $type, userId: $userId) {
        lists {
          entries {
            id
            media { idMal }
          }
        }
      }
    }
  `;
  const data = (await graphqlAnilist(accessToken, query, { userId, type: mediaType })) as {
    MediaListCollection?: { lists?: Array<{ entries?: Array<Record<string, unknown>> }> };
  };
  const lists = data?.MediaListCollection?.lists ?? [];
  const entries = lists.flatMap((l) => l.entries ?? []);
  for (const entry of entries) {
    const media = entry.media as Record<string, unknown> | undefined;
    const idMal = media?.idMal != null ? Number(media.idMal) : NaN;
    if (Number.isFinite(idMal) && idMal === malMediaId) {
      const entryId = Number(entry.id);
      if (Number.isFinite(entryId) && entryId > 0) {
        return entryId;
      }
    }
  }
  return null;
}

async function deleteMalListEntry(
  accessToken: string,
  malMediaId: number,
  catalog: "manga" | "anime"
): Promise<void> {
  const url = `${MAL_API}/${catalog}/${malMediaId}/my_list_status`;
  const resp = await fetch(url, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (resp.status === 404) {
    return;
  }
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} ${text.slice(0, 280)}`);
  }
}

async function deleteAnilistListEntry(accessToken: string, mediaListEntryId: number): Promise<void> {
  const mutation = `
    mutation ($id: Int) {
      DeleteMediaListEntry(id: $id) {
        deleted
      }
    }
  `;
  await graphqlAnilist(accessToken, mutation, { id: mediaListEntryId });
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
    const supabase = createUserSupabaseClient(req);

    let body: Body;
    try {
      body = (await req.json()) as Body;
    } catch {
      return jsonResponse({ error: "Corps JSON invalide." }, 400);
    }

    const provider = body.provider === "mal" || body.provider === "anilist" ? body.provider : null;
    const malMangaId = Number(body.mal_manga_id);
    const catalogRaw = body.media_catalog;
    const catalog: "manga" | "anime" =
      catalogRaw === "anime" || catalogRaw === "manga" ? catalogRaw : "manga";
    if (!provider) {
      return jsonResponse({ error: "Paramètre provider invalide (mal ou anilist)." }, 400);
    }
    if (!Number.isFinite(malMangaId) || malMangaId <= 0) {
      return jsonResponse({ error: "mal_manga_id invalide." }, 400);
    }

    const providerKey = provider === "mal" ? "mal" : "anilist";
    const { data: conn, error: connErr } = await supabase
      .from("oauth_connections")
      .select("access_token")
      .eq("user_id", userId)
      .eq("provider", providerKey)
      .maybeSingle();

    if (connErr) {
      return jsonResponse({ error: connErr.message }, 500);
    }
    const token = conn?.access_token;
    if (!token) {
      return jsonResponse(
        { error: `Aucun jeton ${provider === "mal" ? "MyAnimeList" : "AniList"} — connecte le compte.` },
        400
      );
    }

    const anilistMediaType = catalog === "anime" ? "ANIME" : "MANGA";

    if (provider === "mal") {
      await deleteMalListEntry(token, malMangaId, catalog);
    } else {
      const entryId = await findAnilistMediaListEntryId(token, malMangaId, anilistMediaType);
      if (entryId == null) {
        // Idempotent : déjà absent de la liste AniList
        return jsonResponse({ ok: true }, 200);
      }
      await deleteAnilistListEntry(token, entryId);
    }

    return jsonResponse({ ok: true }, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur inconnue.";
    return jsonResponse({ error: message }, 500);
  }
});
