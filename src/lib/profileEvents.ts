/** Événement global pour rafraîchir l’avatar / profil dans la coquille. */
export const NEXUS_PROFILE_CHANGED_EVENT = "nexus-profile-changed";

export function notifyProfileChanged(): void {
  window.dispatchEvent(new CustomEvent(NEXUS_PROFILE_CHANGED_EVENT));
}
