import { getSupabaseClient } from "@/lib/supabaseClient";
import { getAuthRedirectUrl } from "@/services/auth/authRedirectService";
import { mapSupabaseAuthError } from "@/services/auth/mapSupabaseAuthError";

/**
 * Vérifie le mot de passe actuel (reconnexion) puis applique le nouveau.
 */
export async function changePasswordWithVerification(
  email: string,
  currentPassword: string,
  newPassword: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (newPassword.length < 6) {
    return {
      ok: false,
      error: "Le nouveau mot de passe doit contenir au moins 6 caractères.",
    };
  }
  const supabase = getSupabaseClient();
  const { error: verifyErr } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password: currentPassword,
  });
  if (verifyErr) {
    return { ok: false, error: "Mot de passe actuel incorrect." };
  }
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) {
    return { ok: false, error: mapSupabaseAuthError(error.message) };
  }
  return { ok: true };
}

/**
 * Met à jour le pseudo (métadonnées auth + table profiles).
 */
export async function updateUserDisplayName(
  displayName: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const name = displayName.trim();
  if (name.length < 2) {
    return { ok: false, error: "Le pseudo doit contenir au moins 2 caractères." };
  }
  const supabase = getSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "Non connecté." };
  }
  const { error: authErr } = await supabase.auth.updateUser({
    data: { display_name: name },
  });
  if (authErr) {
    return { ok: false, error: mapSupabaseAuthError(authErr.message) };
  }
  const { error: profErr } = await supabase
    .from("profiles")
    .update({ display_name: name })
    .eq("id", user.id);
  if (profErr) {
    return {
      ok: false,
      error:
        profErr.message ||
        "Impossible de mettre à jour le profil (table profiles / RLS).",
    };
  }
  return { ok: true };
}

/**
 * Lance la procédure de changement d'email avec confirmation.
 */
export async function changeUserEmail(
  currentEmail: string,
  nextEmail: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const newEmail = nextEmail.trim().toLowerCase();
  const oldEmail = currentEmail.trim().toLowerCase();
  if (!newEmail) {
    return { ok: false, error: "Veuillez saisir une nouvelle adresse e-mail." };
  }
  if (newEmail === oldEmail) {
    return {
      ok: false,
      error: "La nouvelle adresse e-mail doit être différente de l’actuelle.",
    };
  }

  const supabase = getSupabaseClient();
  const { error } = await supabase.auth.updateUser(
    { email: newEmail },
    { emailRedirectTo: getAuthRedirectUrl() }
  );
  if (error) {
    return { ok: false, error: mapSupabaseAuthError(error.message) };
  }
  return { ok: true };
}
