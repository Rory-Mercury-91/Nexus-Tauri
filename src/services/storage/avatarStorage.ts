import type { SupabaseClient } from "@supabase/supabase-js";

export const AVATARS_BUCKET = "avatars";

/**
 * Construit le chemin Storage : `{userId}/avatar.{ext}` (ext dérivée du fichier).
 */
export function buildAvatarObjectPath(userId: string, file: File): string {
  const raw = file.name.split(".").pop() ?? "jpg";
  const ext = /^[a-z0-9]+$/i.test(raw) ? raw.toLowerCase() : "jpg";
  return `${userId}/avatar.${ext}`;
}

export type UploadAvatarResult =
  | { ok: true; path: string }
  | { ok: false; error: string };

/**
 * Envoie l’image dans le dossier de l’utilisateur (upsert).
 */
export async function uploadUserAvatarObject(
  supabase: SupabaseClient,
  userId: string,
  file: File
): Promise<UploadAvatarResult> {
  const path = buildAvatarObjectPath(userId, file);
  const { error } = await supabase.storage
    .from(AVATARS_BUCKET)
    .upload(path, file, {
      upsert: true,
      contentType: file.type || "application/octet-stream",
    });
  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true, path };
}

/**
 * URL signée pour afficher un avatar (bucket privé).
 */
export async function createAvatarSignedUrl(
  supabase: SupabaseClient,
  storagePath: string,
  expiresInSeconds = 3600
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const { data, error } = await supabase.storage
    .from(AVATARS_BUCKET)
    .createSignedUrl(storagePath, expiresInSeconds);
  if (error || !data?.signedUrl) {
    return {
      ok: false,
      error: error?.message ?? "URL signée indisponible",
    };
  }
  return { ok: true, url: data.signedUrl };
}
