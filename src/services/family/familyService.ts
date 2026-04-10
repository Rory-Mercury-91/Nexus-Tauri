import type { SupabaseClient } from "@supabase/supabase-js";

export type FamilyMemberProfile = {
  id: string;
  display_name: string;
  avatar_storage_path: string | null;
};

export type FamilyMemberWithRole = FamilyMemberProfile & {
  role: "admin" | "member";
};

export type ProfileSearchRow = {
  id: string;
  display_name: string;
};

/**
 * Recherche de profils par pseudo (RPC search_profiles_for_invite côté Supabase).
 */
export async function searchProfilesForInvite(
  supabase: SupabaseClient,
  query: string
): Promise<
  { ok: true; rows: ProfileSearchRow[] } | { ok: false; error: string }
> {
  const q = query.trim();
  if (q.length < 2) {
    return { ok: false, error: "Saisis au moins 2 caractères." };
  }
  const { data, error } = await supabase.rpc("search_profiles_for_invite", {
    p_query: q,
  });
  if (error) {
    return {
      ok: false,
      error:
        error.message ||
        "Recherche indisponible. Vérifie que le script SQL search_profiles_invite.sql a été exécuté.",
    };
  }
  const rows = (data ?? []) as ProfileSearchRow[];
  return { ok: true, rows };
}

/**
 * Crée une famille et y ajoute l’utilisateur courant comme admin.
 */
export async function createFamilyForCurrentUser(
  supabase: SupabaseClient,
  name: string
): Promise<
  { ok: true; familyId: string } | { ok: false; error: string }
> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "Non connecté" };
  }
  const { data: fam, error: e1 } = await supabase
    .from("families")
    .insert({ name: name.trim() || "Foyer", created_by: user.id })
    .select("id")
    .single();
  if (e1 || !fam) {
    return { ok: false, error: e1?.message ?? "Création foyer impossible" };
  }
  const { error: e2 } = await supabase.from("family_members").insert({
    family_id: fam.id,
    user_id: user.id,
    role: "admin",
  });
  if (e2) {
    return { ok: false, error: e2.message };
  }
  return { ok: true, familyId: fam.id };
}

/**
 * Un admin ajoute un autre utilisateur au foyer (connaissance de son UUID).
 */
export async function addUserToFamilyAsAdmin(
  supabase: SupabaseClient,
  familyId: string,
  targetUserId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.from("family_members").insert({
    family_id: familyId,
    user_id: targetUserId,
    role: "member",
  });
  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/**
 * Renomme un foyer (admin uniquement, via RLS).
 */
export async function updateFamilyNameAsAdmin(
  supabase: SupabaseClient,
  familyId: string,
  familyName: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const clean = familyName.trim();
  if (!clean) {
    return { ok: false, error: "Le nom du foyer ne peut pas être vide." };
  }
  const { error } = await supabase
    .from("families")
    .update({ name: clean })
    .eq("id", familyId);
  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/**
 * Retire un membre d’un foyer (admin uniquement, via RLS).
 */
export async function removeUserFromFamilyAsAdmin(
  supabase: SupabaseClient,
  familyId: string,
  targetUserId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "Non connecté." };
  }
  if (user.id === targetUserId) {
    return {
      ok: false,
      error:
        "Tu ne peux pas te retirer toi-même depuis cet écran (laisse au moins un admin).",
    };
  }
  const { error } = await supabase
    .from("family_members")
    .delete()
    .eq("family_id", familyId)
    .eq("user_id", targetUserId);
  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/**
 * Profils des utilisateurs partageant au moins un foyer avec le courant (y compris soi).
 */
export async function listFamilyVisibleProfiles(
  supabase: SupabaseClient
): Promise<FamilyMemberProfile[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return [];
  }
  const { data: myRows } = await supabase
    .from("family_members")
    .select("family_id")
    .eq("user_id", user.id);
  const famIds = [...new Set(myRows?.map((r) => r.family_id) ?? [])];
  if (famIds.length === 0) {
    return [];
  }
  const { data: memberRows } = await supabase
    .from("family_members")
    .select("user_id")
    .in("family_id", famIds);
  const userIds = [...new Set(memberRows?.map((m) => m.user_id) ?? [])];
  if (userIds.length === 0) {
    return [];
  }
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, display_name, avatar_storage_path")
    .in("id", userIds);
  return (profiles ?? []) as FamilyMemberProfile[];
}

/**
 * Première famille dont l’utilisateur est admin (pour ajout de membres).
 */
export type FamilySummary = {
  id: string;
  name: string;
};

/**
 * Foyers dont l’utilisateur courant est membre.
 */
export async function listMyFamilies(
  supabase: SupabaseClient
): Promise<FamilySummary[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return [];
  }
  const { data: memberRows, error: e1 } = await supabase
    .from("family_members")
    .select("family_id")
    .eq("user_id", user.id);
  if (e1 || !memberRows?.length) {
    return [];
  }
  const ids = [...new Set(memberRows.map((r) => r.family_id))];
  const { data: families, error: e2 } = await supabase
    .from("families")
    .select("id, name")
    .in("id", ids);
  if (e2 || !families) {
    return [];
  }
  return families as FamilySummary[];
}

/**
 * Membres d’un foyer (profils) — uniquement si l’utilisateur est membre du foyer.
 */
export async function listFamilyMembersProfiles(
  supabase: SupabaseClient,
  familyId: string
): Promise<FamilyMemberProfile[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return [];
  }
  const { data: me } = await supabase
    .from("family_members")
    .select("family_id")
    .eq("user_id", user.id)
    .eq("family_id", familyId)
    .maybeSingle();
  if (!me) {
    return [];
  }
  const { data: memberRows } = await supabase
    .from("family_members")
    .select("user_id")
    .eq("family_id", familyId);
  const userIds = [...new Set(memberRows?.map((m) => m.user_id) ?? [])];
  if (userIds.length === 0) {
    return [];
  }
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, display_name, avatar_storage_path")
    .in("id", userIds);
  return (profiles ?? []) as FamilyMemberProfile[];
}

/**
 * Membres d’un foyer avec rôle (admin/member), uniquement si l’utilisateur est membre.
 */
export async function listFamilyMembersWithRole(
  supabase: SupabaseClient,
  familyId: string
): Promise<FamilyMemberWithRole[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return [];
  }
  const { data: me } = await supabase
    .from("family_members")
    .select("family_id")
    .eq("user_id", user.id)
    .eq("family_id", familyId)
    .maybeSingle();
  if (!me) {
    return [];
  }
  const { data: memberRows } = await supabase
    .from("family_members")
    .select("user_id, role")
    .eq("family_id", familyId);
  const rows = (memberRows ?? []) as { user_id: string; role: "admin" | "member" }[];
  const userIds = [...new Set(rows.map((m) => m.user_id))];
  if (userIds.length === 0) {
    return [];
  }
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, display_name, avatar_storage_path")
    .in("id", userIds);
  const byId = new Map<string, FamilyMemberProfile>();
  for (const p of (profiles ?? []) as FamilyMemberProfile[]) {
    byId.set(p.id, p);
  }
  return rows.map((r) => {
    const pr = byId.get(r.user_id);
    return {
      id: r.user_id,
      display_name: pr?.display_name ?? "",
      avatar_storage_path: pr?.avatar_storage_path ?? null,
      role: r.role,
    };
  });
}

export async function getFirstAdminFamilyId(
  supabase: SupabaseClient
): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return null;
  }
  const { data } = await supabase
    .from("family_members")
    .select("family_id")
    .eq("user_id", user.id)
    .eq("role", "admin")
    .limit(1)
    .maybeSingle();
  return data?.family_id ?? null;
}
