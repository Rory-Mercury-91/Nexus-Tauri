import type { SupabaseClient } from "@supabase/supabase-js";

export async function updateProfileAvatarPath(
  supabase: SupabaseClient,
  userId: string,
  storagePath: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await supabase
    .from("profiles")
    .update({ avatar_storage_path: storagePath })
    .eq("id", userId);
  if (error) {
    return { ok: false, message: error.message };
  }
  return { ok: true };
}
