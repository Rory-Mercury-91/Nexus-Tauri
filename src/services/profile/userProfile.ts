import type { SupabaseClient } from "@supabase/supabase-js";

export type ProfileUpsertRow = {
  id: string;
  display_name: string;
  avatar_storage_path?: string | null;
};

/**
 * Crée ou met à jour la ligne profil pour l’utilisateur connecté.
 * Retourne silent si la table est absente (PGRST205).
 */
export async function upsertUserProfile(
  supabase: SupabaseClient,
  row: ProfileUpsertRow
): Promise<{ ok: true } | { ok: false; message: string; silent?: boolean }> {
  const { error } = await supabase.from("profiles").upsert(
    {
      id: row.id,
      display_name: row.display_name,
      ...(row.avatar_storage_path !== undefined
        ? { avatar_storage_path: row.avatar_storage_path }
        : {}),
    },
    { onConflict: "id" }
  );

  if (!error) {
    return { ok: true };
  }

  if (error.code === "PGRST205") {
    return { ok: false, message: "", silent: true };
  }

  return {
    ok: false,
    message:
      error.message ||
      "Impossible d’enregistrer le profil. Vérifiez la table « profiles » et les politiques RLS.",
  };
}
