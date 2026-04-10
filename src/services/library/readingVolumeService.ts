import type { SupabaseClient } from "@supabase/supabase-js";

export type ReadingVolumeOwner = {
  userId: string;
  shareEuros: number;
};

export type ReadingVolumeRow = {
  id: string;
  readingId: string;
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
};

export async function fetchReadingVolumes(
  supabase: SupabaseClient,
  readingId: string
): Promise<ReadingVolumeRow[]> {
  const { data, error } = await supabase
    .from("reading_volumes")
    .select(
      "id, reading_id, family_id, volume_number, volume_type, image_url, release_date_vf, purchase_date, price_euros, is_owned, is_read, is_mihon, reading_volume_owners(user_id, share_euros)"
    )
    .eq("reading_id", readingId)
    .order("volume_number", { ascending: true });
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []).map((row) => {
    const ownersRaw = Array.isArray((row as { reading_volume_owners?: unknown }).reading_volume_owners)
      ? ((row as { reading_volume_owners: Array<Record<string, unknown>> }).reading_volume_owners ?? [])
      : [];
    return {
      id: String(row.id),
      readingId: String(row.reading_id),
      familyId: (row.family_id as string | null) ?? null,
      volumeNumber: Number(row.volume_number ?? 0),
      volumeType: String(row.volume_type ?? "standard"),
      imageUrl: (row.image_url as string | null) ?? null,
      releaseDateVf: (row.release_date_vf as string | null) ?? null,
      purchaseDate: (row.purchase_date as string | null) ?? null,
      priceEuros: Number(row.price_euros ?? 0),
      isOwned: Boolean(row.is_owned),
      isRead: Boolean(row.is_read),
      isMihon: Boolean(row.is_mihon),
      owners: ownersRaw.map((owner) => ({
        userId: String(owner.user_id ?? ""),
        shareEuros: Number(owner.share_euros ?? 0),
      })),
    };
  });
}

export async function upsertReadingVolume(
  supabase: SupabaseClient,
  input: Omit<ReadingVolumeRow, "id"> & { id?: string }
): Promise<void> {
  const payload = {
    id: input.id,
    reading_id: input.readingId,
    family_id: input.familyId,
    volume_number: input.volumeNumber,
    volume_type: input.volumeType,
    image_url: input.imageUrl,
    release_date_vf: input.releaseDateVf,
    purchase_date: input.purchaseDate,
    price_euros: input.priceEuros,
    is_owned: input.isOwned,
    is_read: input.isRead,
    is_mihon: input.isMihon,
  };
  const { data, error } = await supabase
    .from("reading_volumes")
    .upsert(payload, { onConflict: "reading_id,volume_number" })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(error?.message ?? "Impossible d'enregistrer le tome.");
  }
  const volumeId = String(data.id);
  const { error: deleteError } = await supabase
    .from("reading_volume_owners")
    .delete()
    .eq("volume_id", volumeId);
  if (deleteError) {
    throw new Error(deleteError.message);
  }
  if (input.owners.length > 0) {
    const rows = input.owners.map((owner) => ({
      volume_id: volumeId,
      user_id: owner.userId,
      family_id: input.familyId,
      share_euros: owner.shareEuros,
    }));
    const { error: ownerError } = await supabase.from("reading_volume_owners").insert(rows);
    if (ownerError) {
      throw new Error(ownerError.message);
    }
  }
  
  // Mettre à jour le snapshot MAL avec le nombre total de volumes lus
  await syncMalSnapshotVolumesRead(supabase, input.readingId);
}

/**
 * Synchronise le compteur num_volumes_read dans le snapshot MAL
 * en comptant les volumes marqués comme lus dans reading_volumes
 */
async function syncMalSnapshotVolumesRead(
  supabase: SupabaseClient,
  readingId: string
): Promise<void> {
  // Compter les volumes lus
  const { data: volumes } = await supabase
    .from("reading_volumes")
    .select("is_read")
    .eq("reading_id", readingId);
  
  const volumesReadCount = (volumes ?? []).filter((v) => v.is_read === true).length;
  
  // Récupérer le snapshot MAL actuel
  const { data: reading } = await supabase
    .from("library_reading")
    .select("mal_official_snapshot")
    .eq("id", readingId)
    .single();
  
  if (!reading) return;
  
  const baseSnapshot = (reading.mal_official_snapshot ?? {}) as Record<string, unknown>;
  const listEntry = (baseSnapshot.list_entry ?? {}) as Record<string, unknown>;
  const listStatus = (listEntry.list_status ?? {}) as Record<string, unknown>;
  
  // Mettre à jour le snapshot avec le nouveau compteur
  const updatedSnapshot = {
    ...baseSnapshot,
    list_entry: {
      ...listEntry,
      list_status: {
        ...listStatus,
        num_volumes_read: volumesReadCount,
      },
    },
  };
  
  await supabase
    .from("library_reading")
    .update({
      mal_official_snapshot: updatedSnapshot,
      updated_at: new Date().toISOString(),
    })
    .eq("id", readingId);
}
