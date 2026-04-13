import { useLayoutEffect } from "react";
import { useLocation } from "react-router-dom";
import { scrollMainToTop } from "@/lib/collectionScroll";

const ANIME_SCROLL_KEYS = [
  "anime-collection:scroll-main:grid",
  "anime-collection:scroll-main:list",
];
const READING_SCROLL_KEYS = [
  "reading-collection:scroll-main:grid",
  "reading-collection:scroll-main:list",
];
const PREV_PATH_KEY = "app:scroll:last-pathname";
const RETURN_TO_COLLECTION_KEY = "app:scroll:return-to-collection";

function clearKeys(keys: string[]) {
  keys.forEach((key) => sessionStorage.removeItem(key));
}

/**
 * Remet le scroll en haut à chaque changement de route (avant le paint),
 * sauf retour détail → même collection (restauration gérée par la page collection).
 */
export function ScrollToTop() {
  const location = useLocation();

  useLayoutEffect(() => {
    const currentPath = location.pathname;
    const previousPath = sessionStorage.getItem(PREV_PATH_KEY);
    const isAnimeDetail = /^\/anime\/\d+/.test(currentPath);
    const isReadingDetail = /^\/lectures\/\d+/.test(currentPath);

    const isAnimeCollection = currentPath === "/anime";
    const isReadingCollection = currentPath === "/lectures";
    const returnToCollection = sessionStorage.getItem(RETURN_TO_COLLECTION_KEY);
    const fromAnimeDetailToAnimeCollection = Boolean(
      (previousPath?.startsWith("/anime/") && isAnimeCollection) ||
        (returnToCollection === "anime" && isAnimeCollection)
    );
    const fromReadingDetailToReadingCollection = Boolean(
      (previousPath?.startsWith("/lectures/") && isReadingCollection) ||
        (returnToCollection === "lectures" && isReadingCollection)
    );

    // Sur toutes les entrées de collection hors retour détail->même collection :
    // on force le reset de la position mémorisée pour repartir du haut.
    if (isAnimeCollection && !fromAnimeDetailToAnimeCollection) {
      clearKeys(ANIME_SCROLL_KEYS);
    }
    if (isReadingCollection && !fromReadingDetailToReadingCollection) {
      clearKeys(READING_SCROLL_KEYS);
    }

    if (
      fromAnimeDetailToAnimeCollection ||
      fromReadingDetailToReadingCollection
    ) {
      sessionStorage.removeItem(RETURN_TO_COLLECTION_KEY);
      sessionStorage.setItem(PREV_PATH_KEY, currentPath);
      return;
    }

    // Les pages détail gèrent déjà leur propre reset de scroll en haut
    // (avec raf + timeout), on évite ici d'écraser la position sauvegardée
    // de la collection juste avant la navigation.
    if (isAnimeDetail || isReadingDetail) {
      sessionStorage.setItem(PREV_PATH_KEY, currentPath);
      return;
    }

    scrollMainToTop();
    sessionStorage.setItem(PREV_PATH_KEY, currentPath);
  }, [location.pathname]);

  return null;
}
