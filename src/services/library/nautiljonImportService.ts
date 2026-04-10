import type { SupabaseClient } from "@supabase/supabase-js";
import { upsertReadingVolume } from "@/services/library/readingVolumeService";

export type NautiljonImportEnvelope = {
  kind: string;
  mode: "full" | "tomes_only";
  payload: Record<string, unknown>;
  received_at: number;
};

export type ReadingImportTarget = {
  id: string;
  malMangaId: number;
  title: string;
};

type NautiljonVolumePayload = {
  numero?: unknown;
  couverture_url?: unknown;
  date_sortie?: unknown;
  prix?: unknown;
};

function toStringValue(value: unknown): string {
  return String(value ?? "").trim();
}

function toNumberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  const parsed = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeDate(value: unknown): string | null {
  const raw = toStringValue(value);
  if (!raw) {
    return null;
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

function normalizeStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => toStringValue(entry)).filter(Boolean);
  }
  const raw = toStringValue(value);
  if (!raw) {
    return [];
  }
  return raw
    .split(/[|,]/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function mergeLockedFields(base: unknown, additions: string[]): string[] {
  const initial = Array.isArray(base) ? base.map((entry) => toStringValue(entry)).filter(Boolean) : [];
  return Array.from(new Set([...initial, ...additions]));
}

function normalizeVolumes(value: unknown): NautiljonVolumePayload[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry) => entry && typeof entry === "object") as NautiljonVolumePayload[];
}

export async function fetchReadingImportTargets(supabase: SupabaseClient): Promise<ReadingImportTarget[]> {
  const { data, error } = await supabase
    .from("library_reading")
    .select("id, mal_manga_id, title")
    .order("title", { ascending: true });
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []).map((row) => ({
    id: String(row.id),
    malMangaId: Number(row.mal_manga_id ?? 0),
    title: String(row.title ?? "—"),
  }));
}

export async function applyNautiljonImportToReading(
  supabase: SupabaseClient,
  targetReadingId: string,
  envelope: NautiljonImportEnvelope
): Promise<{ volumesUpserted: number }> {
  const { data: existingRow, error: existingError } = await supabase
    .from("library_reading")
    .select("id, title, mal_official_snapshot, jikan_snapshot")
    .eq("id", targetReadingId)
    .single();
  if (existingError || !existingRow) {
    throw new Error(existingError?.message ?? "Fiche lecture introuvable.");
  }

  const payload = envelope.payload;
  const baseMalSnapshot = ((existingRow.mal_official_snapshot ?? {}) as Record<string, unknown>);
  const baseJikanSnapshot = ((existingRow.jikan_snapshot ?? {}) as Record<string, unknown>);
  const baseFull = ((baseJikanSnapshot.full ?? {}) as Record<string, unknown>);
  const baseManualOverrides =
    (((baseMalSnapshot.manual_overrides ?? {}) as Record<string, unknown>));

  const titleFr = toStringValue(payload.titre);
  const synopsisFr = toStringValue(payload.description);
  const titreOriginal = toStringValue(payload.titre_original);
  const titreAlternatif = toStringValue(payload.titre_alternatif);
  const nautiljonUrl = toStringValue(payload.nautiljon_url || payload._url);
  const workStatus = toStringValue(payload.statut_publication || payload.statut);
  const type = toStringValue(payload.type_contenu || payload.type_volume || baseFull.type);
  const genres = normalizeStringList(payload.genres);
  const themes = normalizeStringList(payload._themes);
  const demographic = toStringValue(payload.demographie);
  const chapters = toNumberValue(payload.nb_chapitres);
  const volumesCount = toNumberValue(payload.nb_volumes);
  const coverUrl = toStringValue(payload.couverture_url);
  const editeurVf = toStringValue(payload.editeur_vf);
  const editeurVo = toStringValue(payload.editeur_vo);
  const anneeVf = toStringValue(payload.annee_vf);
  const anneeVo = toStringValue(payload.annee_vo);
  const traducteur = toStringValue(payload._traducteur);
  const scenarist = toStringValue(payload._scenarist);
  const dessinateur = toStringValue(payload._dessinateur);
  const ageConseille = toStringValue(payload._age_conseille);
  const groupe = toStringValue(payload._groupe);
  const prepublie = toStringValue(payload._prepublie);

  // Fusionner les titres alternatifs intelligemment
  const existingTitleSynonyms = Array.isArray(baseFull.title_synonyms)
    ? (baseFull.title_synonyms as unknown[]).map((v) => toStringValue(v)).filter(Boolean)
    : [];
  
  const newTitleSynonyms: string[] = [];
  if (titreAlternatif) {
    newTitleSynonyms.push(titreAlternatif);
  }
  
  // Dédupliquer les titres alternatifs
  const allSynonyms = Array.from(new Set([...existingTitleSynonyms, ...newTitleSynonyms]));

  const nextFull: Record<string, unknown> = {
    ...baseFull,
    ...(type ? { type } : {}),
    ...(workStatus ? { status: workStatus } : {}),
    ...(chapters !== null ? { chapters } : {}),
    ...(allSynonyms.length > 0 ? { title_synonyms: allSynonyms } : {}),
    // NE PAS écraser volumes ici - on stocke volumes_vf dans manual_overrides
    ...(coverUrl ? { images: { ...(baseFull.images as Record<string, unknown> | undefined), jpg: { image_url: coverUrl, large_image_url: coverUrl } } } : {}),
    ...(genres.length ? { genres: genres.map((name) => ({ name })) } : {}),
    ...(themes.length ? { themes: themes.map((name) => ({ name })) } : {}),
    ...(demographic ? { demographics: [{ name: demographic }] } : {}),
  };

  const nextManualOverrides: Record<string, unknown> = {
    ...baseManualOverrides,
    ...(titleFr ? { title_fr: titleFr } : {}),
    ...(synopsisFr ? { synopsis_fr: synopsisFr } : {}),
    ...(titreOriginal ? { titre_original: titreOriginal } : {}),
    ...(volumesCount !== null ? { volumes_vf: volumesCount } : {}),
    ...(editeurVf ? { editeur_vf: editeurVf } : {}),
    ...(editeurVo ? { editeur_vo: editeurVo } : {}),
    ...(anneeVf ? { annee_vf: anneeVf } : {}),
    ...(anneeVo ? { annee_vo: anneeVo } : {}),
    ...(traducteur ? { traducteur: traducteur } : {}),
    ...(scenarist ? { scenarist: scenarist } : {}),
    ...(dessinateur ? { dessinateur: dessinateur } : {}),
    ...(ageConseille ? { age_conseille: ageConseille } : {}),
    ...(groupe ? { groupe: groupe } : {}),
    ...(prepublie ? { prepublie: prepublie } : {}),
    links: {
      ...(((baseManualOverrides.links ?? {}) as Record<string, unknown>)),
      ...(nautiljonUrl ? { nautiljon: nautiljonUrl } : {}),
    },
    locked_field_ids: mergeLockedFields(baseManualOverrides.locked_field_ids, [
      "title",
      "synopsis",
      "status",
      "genres",
      "themes",
      "demographic",
      "chapters",
    ]),
  };

  const nextMalSnapshot: Record<string, unknown> = {
    ...baseMalSnapshot,
    manual_overrides: nextManualOverrides,
  };

  const { error: updateError } = await supabase
    .from("library_reading")
    .update({
      title: titleFr || existingRow.title,
      main_picture_url: coverUrl || undefined,
      jikan_snapshot: { ...baseJikanSnapshot, full: nextFull },
      mal_official_snapshot: nextMalSnapshot,
      updated_at: new Date().toISOString(),
    })
    .eq("id", targetReadingId);
  if (updateError) {
    throw new Error(updateError.message);
  }

  const payloadVolumes = normalizeVolumes(payload.volumes);
  let volumesUpserted = 0;
  for (const rawVolume of payloadVolumes) {
    const volumeNumber = toNumberValue(rawVolume.numero);
    if (!volumeNumber || volumeNumber <= 0) {
      continue;
    }
    await upsertReadingVolume(supabase, {
      readingId: targetReadingId,
      familyId: null,
      volumeNumber,
      volumeType: toStringValue(payload.type_volume) || "standard",
      imageUrl: toStringValue(rawVolume.couverture_url) || null,
      releaseDateVf: normalizeDate(rawVolume.date_sortie),
      purchaseDate: null,
      priceEuros: toNumberValue(rawVolume.prix) ?? 0,
      isOwned: false,
      isRead: false,
      isMihon: false,
      owners: [],
    });
    volumesUpserted += 1;
  }

  return { volumesUpserted };
}
