import {
  corsHeaders,
  createUserSupabaseClient,
  jsonResponse,
  requireUserId,
} from "../_shared/integration-helpers.ts";

const MAL_API = "https://api.myanimelist.net/v2";
const IMPORT_PAGE_SIZE = 100;

async function fetchJson(url: string, init?: RequestInit) {
  const resp = await fetch(url, init);
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} ${text.slice(0, 280)}`);
  }
  return JSON.parse(text) as unknown;
}

async function fetchAllMalMangaIds(accessToken: string): Promise<number[]> {
  const ids: number[] = [];
  let offset = 0;
  for (;;) {
    const url = new URL(`${MAL_API}/users/@me/mangalist`);
    url.searchParams.set("limit", String(IMPORT_PAGE_SIZE));
    url.searchParams.set("offset", String(offset));
    url.searchParams.set(
      "fields",
      "list_status,node{id,title,main_picture,alternative_titles}"
    );
    url.searchParams.set("nsfw", "true");
    const json = (await fetchJson(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    })) as { data?: Array<Record<string, unknown>>; paging?: { next?: string } };
    const rows = json.data ?? [];
    for (const row of rows) {
      const node = row.node as Record<string, unknown> | undefined;
      const id = Number(node?.id);
      if (Number.isFinite(id) && id > 0) {
        ids.push(id);
      }
    }
    const hasNext = Boolean(json.paging?.next) && rows.length > 0;
    if (!hasNext) {
      break;
    }
    offset += IMPORT_PAGE_SIZE;
  }
  return ids;
}

type AnilistMalEntry = {
  anilist_media_id: number;
  mal_id: number;
  list_status: string;
};

type AnilistOrphan = {
  anilist_media_id: number;
  title: string;
};

async function fetchAnilistMangaByMalId(
  accessToken: string
): Promise<{ byMalId: AnilistMalEntry[]; orphans: AnilistOrphan[] }> {
  const viewerJson = (await fetchJson("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ query: "query { Viewer { id } }" }),
  })) as { data?: { Viewer?: { id?: number } } };
  const viewerId = Number(viewerJson.data?.Viewer?.id);
  if (!Number.isFinite(viewerId) || viewerId <= 0) {
    throw new Error("Impossible de récupérer le profil AniList.");
  }

  const query = `
    query ($userId: Int) {
      MediaListCollection(type: MANGA, userId: $userId) {
        lists {
          entries {
            status
            progress
            media {
              id
              idMal
              title { romaji english }
            }
          }
        }
      }
    }
  `;
  const json = (await fetchJson("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ query, variables: { userId: viewerId } }),
  })) as {
    data?: {
      MediaListCollection?: { lists?: Array<{ entries?: Array<Record<string, unknown>> }> };
    };
  };
  const lists = json.data?.MediaListCollection?.lists ?? [];
  const entries = lists.flatMap((l) => l.entries ?? []);

  const byMalId: AnilistMalEntry[] = [];
  const orphans: AnilistOrphan[] = [];

  for (const entry of entries) {
    const media = entry.media as Record<string, unknown> | undefined;
    const anilistMediaId = Number(media?.id);
    const idMal = media?.idMal != null ? Number(media.idMal) : NaN;
    const titleEn = (media?.title as Record<string, unknown> | undefined)?.english;
    const titleRo = (media?.title as Record<string, unknown> | undefined)?.romaji;
    const title = String(titleEn ?? titleRo ?? "").trim() || "—";
    const listStatus = String(entry.status ?? "");

    if (!Number.isFinite(anilistMediaId) || anilistMediaId <= 0) {
      continue;
    }
    if (Number.isFinite(idMal) && idMal > 0) {
      byMalId.push({
        anilist_media_id: anilistMediaId,
        mal_id: idMal,
        list_status: listStatus,
      });
    } else {
      orphans.push({ anilist_media_id: anilistMediaId, title });
    }
  }

  return { byMalId, orphans };
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

    const { data: malConn, error: malErr } = await supabase
      .from("oauth_connections")
      .select("access_token")
      .eq("user_id", userId)
      .eq("provider", "mal")
      .maybeSingle();

    const { data: aniConn, error: aniErr } = await supabase
      .from("oauth_connections")
      .select("access_token")
      .eq("user_id", userId)
      .eq("provider", "anilist")
      .maybeSingle();

    const errors: { mal: string | null; anilist: string | null } = {
      mal: malErr ? malErr.message : null,
      anilist: aniErr ? aniErr.message : null,
    };

    let mal_manga_ids: number[] = [];
    if (malConn?.access_token) {
      try {
        mal_manga_ids = await fetchAllMalMangaIds(malConn.access_token);
      } catch (e) {
        errors.mal = e instanceof Error ? e.message : String(e);
      }
    }

    let anilist_by_mal_id: Record<string, { anilist_media_id: number; list_status: string }> = {};
    let anilist_entries_without_mal: AnilistOrphan[] = [];
    if (aniConn?.access_token) {
      try {
        const { byMalId, orphans } = await fetchAnilistMangaByMalId(aniConn.access_token);
        anilist_entries_without_mal = orphans;
        const map: Record<string, { anilist_media_id: number; list_status: string }> = {};
        for (const e of byMalId) {
          map[String(e.mal_id)] = {
            anilist_media_id: e.anilist_media_id,
            list_status: e.list_status,
          };
        }
        anilist_by_mal_id = map;
      } catch (e) {
        errors.anilist = e instanceof Error ? e.message : String(e);
      }
    }

    return jsonResponse(
      {
        mal_manga_ids,
        anilist_by_mal_id,
        anilist_entries_without_mal,
        errors,
      },
      200
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur inconnue.";
    return jsonResponse({ error: message }, 500);
  }
});
