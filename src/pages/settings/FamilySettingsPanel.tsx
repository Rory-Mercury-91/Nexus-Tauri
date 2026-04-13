import { useCallback, useEffect, useState } from "react";
import { ProfileAvatarImage } from "@/components/common/ProfileAvatarImage";
import { useDataFetchOverlay } from "@/contexts/DataFetchOverlayContext";
import { getSupabaseClient } from "@/lib/supabaseClient";
import {
  addUserToFamilyAsAdmin,
  createFamilyForCurrentUser,
  getFirstAdminFamilyId,
  listFamilyMembersWithRole,
  listMyFamilies,
  removeUserFromFamilyAsAdmin,
  searchProfilesForInvite,
  updateFamilyNameAsAdmin,
  type FamilyMemberWithRole,
  type ProfileSearchRow,
} from "@/services/family/familyService";
import { useSession } from "@/hooks/useSession";

/**
 * Gestion du foyer familial : création/édition, invitation par pseudo et membres.
 */
export function FamilySettingsPanel() {
  const { session } = useSession();
  const { beginPageDataLoad, endPageDataLoad } = useDataFetchOverlay();
  const myId = session?.user.id ?? "";

  const [adminFamilyId, setAdminFamilyId] = useState<string | null>(null);
  const [visibleFamilyId, setVisibleFamilyId] = useState<string | null>(null);
  const [members, setMembers] = useState<FamilyMemberWithRole[]>([]);
  const [familyName, setFamilyName] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ProfileSearchRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    beginPageDataLoad();
    try {
      const supabase = getSupabaseClient();
      const [firstAdminFamilyId, famRows] = await Promise.all([
        getFirstAdminFamilyId(supabase),
        listMyFamilies(supabase),
      ]);
      setAdminFamilyId(firstAdminFamilyId);
      const displayFamilyId = firstAdminFamilyId ?? famRows[0]?.id ?? null;
      setVisibleFamilyId(displayFamilyId);

      if (!displayFamilyId) {
        setMembers([]);
        setFamilyName("");
        return;
      }

      const memberRows = await listFamilyMembersWithRole(supabase, displayFamilyId);
      const selectedFamily = famRows.find((f) => f.id === displayFamilyId);
      setFamilyName(selectedFamily?.name ?? "");
      setMembers(memberRows);
    } catch {
      setAdminFamilyId(null);
      setMembers([]);
      setFamilyName("");
    } finally {
      endPageDataLoad();
    }
  }, [beginPageDataLoad, endPageDataLoad]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function handleSearchPseudo() {
    setError(null);
    setInfo(null);
    setSearchResults([]);
    beginPageDataLoad();
    setBusy(true);
    try {
      const supabase = getSupabaseClient();
      const r = await searchProfilesForInvite(supabase, searchQuery);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setSearchResults(r.rows);
      if (r.rows.length === 0) {
        setInfo("Aucun profil ne correspond à ce pseudo.");
      }
    } finally {
      setBusy(false);
      endPageDataLoad();
    }
  }

  async function inviteUserId(targetId: string): Promise<boolean> {
    setError(null);
    setInfo(null);
    if (!adminFamilyId) {
      setError("Crée d’abord un foyer pour pouvoir inviter des membres.");
      return false;
    }
    beginPageDataLoad();
    setBusy(true);
    try {
      const supabase = getSupabaseClient();
      const r = await addUserToFamilyAsAdmin(supabase, adminFamilyId, targetId);
      if (!r.ok) {
        setError(r.error);
        return false;
      }
      setInfo("Membre ajouté au foyer.");
      setSearchResults([]);
      setSearchQuery("");
      try {
        await reload();
      } catch {
        setError("Membre ajouté mais la liste n’a pas pu être rafraîchie.");
        return true;
      }
      return true;
    } finally {
      setBusy(false);
      endPageDataLoad();
    }
  }

  async function handleSaveFamily() {
    const cleanName = familyName.trim();
    if (!cleanName) {
      setError("Saisis un nom de foyer.");
      setInfo(null);
      return;
    }
    setError(null);
    setInfo(null);
    beginPageDataLoad();
    setBusy(true);
    try {
      const supabase = getSupabaseClient();
      const r = adminFamilyId
        ? await updateFamilyNameAsAdmin(supabase, adminFamilyId, cleanName)
        : await createFamilyForCurrentUser(supabase, cleanName);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      await reload();
      setInfo(adminFamilyId ? "Foyer mis à jour." : "Foyer créé.");
    } finally {
      setBusy(false);
      endPageDataLoad();
    }
  }

  async function handleRevokeMember(memberId: string) {
    if (!adminFamilyId) {
      return;
    }
    if (!window.confirm("Retirer ce membre du foyer ?")) {
      return;
    }
    setError(null);
    setInfo(null);
    beginPageDataLoad();
    setBusy(true);
    try {
      const supabase = getSupabaseClient();
      const r = await removeUserFromFamilyAsAdmin(supabase, adminFamilyId, memberId);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setInfo("Membre retiré du foyer.");
      await reload();
    } finally {
      setBusy(false);
      endPageDataLoad();
    }
  }

  return (
    <div className="family-settings">
      <section className="settings-block" aria-labelledby="family-foyer">
        <h2 id="family-foyer" className="settings-block-title">
          Foyer familial
        </h2>
        {error ? <p className="settings-error">{error}</p> : null}
        {info ? <p className="settings-success">{info}</p> : null}
        <div className="family-settings-row">
          <input
            type="text"
            className="family-settings-input"
            value={familyName}
            onChange={(ev) => setFamilyName(ev.target.value)}
            placeholder="Nom du foyer (ou vide si aucun foyer)"
            aria-label="Nom du foyer"
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleSaveFamily()}
          >
            {adminFamilyId ? "Modifier" : "Créer"}
          </button>
        </div>

        <h3 className="family-settings-subtitle">Inviter par pseudo</h3>
        <p className="settings-block-lead family-settings-tight-lead">
          Recherche un compte par son pseudo (au moins 2 caractères). Seuls les
          administrateurs d’un foyer peuvent ajouter des membres.
        </p>
        <div className="family-settings-row">
          <input
            type="search"
            className="family-settings-input"
            value={searchQuery}
            onChange={(ev) => setSearchQuery(ev.target.value)}
            onKeyDown={(ev) => {
              if (ev.key === "Enter") {
                ev.preventDefault();
                void handleSearchPseudo();
              }
            }}
            placeholder="Pseudo du membre à inviter"
            aria-label="Recherche par pseudo"
          />
          <button
            type="button"
            disabled={busy || searchQuery.trim().length < 2}
            onClick={() => void handleSearchPseudo()}
          >
            Rechercher
          </button>
        </div>

        {searchResults.length > 0 ? (
          <ul
            className="family-settings-search-results"
            aria-label="Résultats de recherche"
          >
            {searchResults.map((row) => (
              <li key={row.id} className="family-settings-search-row">
                <span className="family-settings-search-name">
                  {row.display_name?.trim() || "Sans pseudo"}
                </span>
                <button
                  type="button"
                  disabled={busy || !adminFamilyId}
                  onClick={() => void inviteUserId(row.id)}
                >
                  Inviter
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="settings-block" aria-labelledby="family-members">
        <h2 id="family-members" className="settings-block-title">
          Membres visibles (même foyer)
        </h2>
        {members.length === 0 ? (
          <p className="family-settings-muted">
            {visibleFamilyId
              ? "Aucun membre visible pour ce foyer."
              : "Aucun foyer trouvé. Rejoins ou crée un foyer."}
          </p>
        ) : (
          <ul className="family-settings-member-badges">
            {members.map((m) => (
              <li key={m.id} className="family-settings-member-badge">
                <ProfileAvatarImage
                  storagePath={m.avatar_storage_path}
                  displayName={m.display_name || m.id}
                  size={30}
                />
                <span className="family-settings-member-name">
                  {m.display_name?.trim() || m.id.slice(0, 8)}
                </span>
                {m.role === "admin" ? (
                  <span className="family-settings-role-badge">Admin</span>
                ) : null}
                {adminFamilyId && m.id !== myId ? (
                  <button
                    type="button"
                    className="family-settings-member-remove"
                    title="Retirer du foyer"
                    aria-label={`Retirer ${m.display_name?.trim() || "ce membre"} du foyer`}
                    disabled={busy}
                    onClick={() => void handleRevokeMember(m.id)}
                  >
                    x
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
