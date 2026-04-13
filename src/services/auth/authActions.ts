import { getSupabaseClient } from "@/lib/supabaseClient";
import { mapSupabaseAuthError } from "@/services/auth/mapSupabaseAuthError";
import { getAuthRedirectUrl } from "@/services/auth/authRedirectService";
import { upsertUserProfile } from "@/services/profile/userProfile";

export async function signInWithEmailPassword(
  email: string,
  password: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) {
      return { ok: false, error: mapSupabaseAuthError(error.message) };
    }
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erreur inconnue";
    return { ok: false, error: mapSupabaseAuthError(msg) };
  }
}

export type SignUpOutcome =
  | { ok: true; hasSession: true; userId: string }
  | { ok: true; hasSession: false }
  | { ok: false; error: string };

export async function signUpWithEmailPassword(
  email: string,
  password: string,
  displayName: string
): Promise<SignUpOutcome> {
  try {
    const supabase = getSupabaseClient();
    const name = displayName.trim();
    const { data, error: signError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: { display_name: name },
        emailRedirectTo: getAuthRedirectUrl(),
      },
    });
    if (signError) {
      return { ok: false, error: mapSupabaseAuthError(signError.message) };
    }
    const user = data.user;
    if (data.session && user) {
      const profileResult = await upsertUserProfile(supabase, {
        id: user.id,
        display_name: name,
      });
      if (!profileResult.ok && !profileResult.silent) {
        return { ok: false, error: profileResult.message };
      }
      return { ok: true, hasSession: true, userId: user.id };
    }
    return { ok: true, hasSession: false };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erreur inconnue";
    return { ok: false, error: mapSupabaseAuthError(msg) };
  }
}

export async function sendPasswordRecoveryEmail(
  email: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: getAuthRedirectUrl(),
    });
    if (error) {
      return { ok: false, error: mapSupabaseAuthError(error.message) };
    }
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erreur inconnue";
    return { ok: false, error: mapSupabaseAuthError(msg) };
  }
}
