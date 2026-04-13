import type { SupabaseClient } from "@supabase/supabase-js";

/** Évite les doublons PK (volume_id, user_id) si le même UUID apparaît avec des casses différentes. */
export function normalizeOwnerUserId(raw: string): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase();
}

export type ReadingVolumeOwner = {
  userId: string;
  shareEuros: number;
};

export type ReadingVolumeRow = {
  /** Identifiant catalogue (= id dans library_manga_volume_catalog), clé stable UI */
  id: string;
  catalogVolumeId: string;
  readingId: string;
  familyId: string | null;
  volumeNumber: number;
  volumeType: string;
  imageUrl: string | null;
  releaseDateVf: string | null;
  purchaseDate: string | null;
  priceEuros: number;
  /** Perso (user_manga_volume_state) OU copropriétaire foyer (family_manga_volume_owner) pour l’utilisateur courant */
  isOwned: boolean;
  isRead: boolean;
  isMihon: boolean;
  owners: ReadingVolumeOwner[];
};

type RpcUpsertCatalogResult = string | null;

export async function fetchReadingVolumes(
  supabase: SupabaseClient,
  readingId: string,
  opts?: { familyId?: string | null; currentUserId?: string | null }
): Promise<ReadingVolumeRow[]> {
  const { data: readingRow, error: readErr } = await supabase
    .from("library_reading")
    .select("mal_manga_id")
    .eq("id", readingId)
    .single();
  if (readErr || !readingRow) {
    throw new Error(readErr?.message ?? "Fiche lecture introuvable.");
  }
  const malMangaId = Number((readingRow as { mal_manga_id?: unknown }).mal_manga_id ?? 0);
  if (!Number.isFinite(malMangaId) || malMangaId <= 0) {
    return [];
  }

  const familyId = opts?.familyId ?? null;

  const { data: catalogRows, error: catErr } = await supabase
    .from("library_manga_volume_catalog")
    .select("id, mal_manga_id, volume_number, volume_type, image_url, release_date_vf, price_euros")
    .eq("mal_manga_id", malMangaId)
    .order("volume_number", { ascending: true });
  if (catErr) {
    throw new Error(catErr.message);
  }

  const catalogList = (catalogRows ?? []) as Array<{
    id: string;
    volume_number: number;
    volume_type: string;
    image_url: string | null;
    release_date_vf: string | null;
    price_euros: number;
  }>;

  const catalogIds = catalogList.map((c) => c.id);
  const stateByCatalogId = new Map<
    string,
    {
      is_owned: boolean;
      is_read: boolean;
      is_mihon: boolean;
      purchase_date: string | null;
    }
  >();

  if (catalogIds.length > 0) {
    const { data: stateRows, error: stErr } = await supabase
      .from("user_manga_volume_state")
      .select("catalog_volume_id, is_owned, is_read, is_mihon, purchase_date")
      .eq("reading_id", readingId)
      .in("catalog_volume_id", catalogIds);
    if (stErr) {
      throw new Error(stErr.message);
    }
    for (const s of stateRows ?? []) {
      const row = s as {
        catalog_volume_id: string;
        is_owned: boolean;
        is_read: boolean;
        is_mihon: boolean;
        purchase_date: string | null;
      };
      stateByCatalogId.set(row.catalog_volume_id, {
        is_owned: Boolean(row.is_owned),
        is_read: Boolean(row.is_read),
        is_mihon: Boolean(row.is_mihon),
        purchase_date: row.purchase_date,
      });
    }
  }

  const ownersByCatalogId = new Map<string, ReadingVolumeOwner[]>();
  if (familyId && catalogIds.length > 0) {
    const { data: ownRows, error: owErr } = await supabase
      .from("family_manga_volume_owner")
      .select("catalog_volume_id, user_id, share_euros")
      .eq("family_id", familyId)
      .in("catalog_volume_id", catalogIds);
    if (owErr) {
      throw new Error(owErr.message);
    }
    const dedup = new Map<string, Map<string, number>>();
    for (const o of ownRows ?? []) {
      const row = o as { catalog_volume_id: string; user_id: string; share_euros: number };
      const cid = row.catalog_volume_id;
      const uid = normalizeOwnerUserId(row.user_id);
      if (!dedup.has(cid)) dedup.set(cid, new Map());
      dedup.get(cid)!.set(uid, Number(row.share_euros ?? 0));
    }
    for (const [cid, umap] of dedup) {
      ownersByCatalogId.set(
        cid,
        Array.from(umap.entries()).map(([userId, shareEuros]) => ({ userId, shareEuros }))
      );
    }
  }

  const uid = opts?.currentUserId ? normalizeOwnerUserId(opts.currentUserId) : "";

  return catalogList.map((c) => {
    const st = stateByCatalogId.get(c.id);
    const owners = ownersByCatalogId.get(c.id) ?? [];
    const stateOwned = Boolean(st?.is_owned);
    const coOwnerViaFamily =
      uid.length > 0 && owners.some((o) => normalizeOwnerUserId(o.userId) === uid);
    return {
      id: c.id,
      catalogVolumeId: c.id,
      readingId,
      familyId,
      volumeNumber: Number(c.volume_number ?? 0),
      volumeType: String(c.volume_type ?? "standard"),
      imageUrl: c.image_url,
      releaseDateVf: c.release_date_vf,
      purchaseDate: st?.purchase_date ?? null,
      priceEuros: Number(c.price_euros ?? 0),
      isOwned: stateOwned || coOwnerViaFamily,
      isRead: st?.is_read ?? false,
      isMihon: st?.is_mihon ?? false,
      owners,
    };
  });
}

export async function upsertReadingVolume(
  supabase: SupabaseClient,
  input: {
    readingId: string;
    malMangaId: number;
    familyId: string | null;
    volumeNumber: number;
    volumeType: string;
    imageUrl: string | null;
    releaseDateVf: string | null;
    purchaseDate: string | null;
    priceEuros: number;
    isOwned: boolean;
    isRead: boolean;
    isMihon: boolean;
    owners: ReadingVolumeOwner[];
  }
): Promise<void> {
  const { data: rpcData, error: rpcError } = await supabase.rpc("upsert_manga_volume_catalog_row", {
    p_mal_manga_id: input.malMangaId,
    p_volume_number: input.volumeNumber,
    p_volume_type: input.volumeType,
    p_image_url: input.imageUrl,
    p_release_date_vf: input.releaseDateVf,
    p_price_euros: input.priceEuros,
    p_source: "app",
    p_import_payload: null,
  });
  if (rpcError) {
    throw new Error(rpcError.message);
  }
  const catalogVolumeId = String((rpcData as RpcUpsertCatalogResult) ?? "").trim();
  if (!catalogVolumeId) {
    throw new Error("Identifiant catalogue tome manquant.");
  }

  const { error: stError } = await supabase.from("user_manga_volume_state").upsert(
    {
      reading_id: input.readingId,
      catalog_volume_id: catalogVolumeId,
      is_owned: input.isOwned,
      is_read: input.isRead,
      is_mihon: input.isMihon,
      purchase_date: input.purchaseDate,
    },
    { onConflict: "reading_id,catalog_volume_id" }
  );
  if (stError) {
    throw new Error(stError.message);
  }

  const ownerByUserId = new Map<string, number>();
  input.owners.forEach((owner) => {
    const userId = normalizeOwnerUserId(String(owner.userId ?? ""));
    if (!userId) return;
    ownerByUserId.set(userId, Number(owner.shareEuros ?? 0));
  });

  if (input.familyId) {
    await supabase
      .from("family_manga_volume_owner")
      .delete()
      .eq("family_id", input.familyId)
      .eq("catalog_volume_id", catalogVolumeId);

    if (ownerByUserId.size > 0) {
      const rows = Array.from(ownerByUserId.entries()).map(([user_id, share_euros]) => ({
        family_id: input.familyId,
        catalog_volume_id: catalogVolumeId,
        user_id,
        share_euros,
      }));
      const { error: ownErr } = await supabase.from("family_manga_volume_owner").insert(rows);
      if (ownErr) {
        throw new Error(ownErr.message);
      }
    }
  }
}
