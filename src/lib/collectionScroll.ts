/**
 * Gestion du scroll pour les pages collection / détail dans le shell principal.
 * Toujours lire/écrire sur .app-shell-main quand il existe (évite window.scrollY = 0 en SPA).
 */

const MAIN_SELECTOR = ".app-shell-main";

export function getMainScrollContainer(): HTMLElement | null {
  return document.querySelector(MAIN_SELECTOR);
}

/** Force le scroll du conteneur principal en haut (à utiliser au changement de route ou sur les détails). */
export function scrollMainToTop(): void {
  const container = getMainScrollContainer();
  if (container) {
    container.scrollTop = 0;
    return;
  }
  window.scrollTo({ top: 0 });
}

/**
 * Lit la position verticale du scroll : priorité au conteneur principal s'il existe.
 * Ne pas utiliser la heuristique « scrollable » : tant que le nœud existe, scrollTop est la source de vérité.
 */
export function readMainScrollTop(container: HTMLElement | null): number {
  if (container) {
    return container.scrollTop;
  }
  return window.scrollY;
}

export function writeMainScrollTop(container: HTMLElement | null, y: number): void {
  if (container) {
    container.scrollTop = y;
    return;
  }
  window.scrollTo({ top: y });
}
