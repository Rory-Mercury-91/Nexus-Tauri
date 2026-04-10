import { useLayoutEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { scrollMainToTop } from "@/lib/collectionScroll";

/**
 * Remet le scroll en haut à chaque changement de route (avant le paint),
 * sauf retour détail → même collection (restauration gérée par la page collection).
 */
export function ScrollToTop() {
  const location = useLocation();
  const prevPathname = useRef<string | null>(null);

  useLayoutEffect(() => {
    const currentPath = location.pathname;
    const previousPath = prevPathname.current;

    const fromAnimeDetailToAnimeCollection =
      previousPath?.startsWith("/anime/") && currentPath === "/anime";
    const fromReadingDetailToReadingCollection =
      previousPath?.startsWith("/lectures/") && currentPath === "/lectures";

    const enteringAnimeCollectionNotFromDetail =
      currentPath === "/anime" && previousPath !== null && !previousPath.startsWith("/anime/");
    const enteringReadingCollectionNotFromDetail =
      currentPath === "/lectures" && previousPath !== null && !previousPath.startsWith("/lectures/");

    if (enteringAnimeCollectionNotFromDetail) {
      sessionStorage.removeItem("anime-collection:scroll-main:grid");
      sessionStorage.removeItem("anime-collection:scroll-main:list");
    }
    if (enteringReadingCollectionNotFromDetail) {
      sessionStorage.removeItem("reading-collection:scroll-main:grid");
      sessionStorage.removeItem("reading-collection:scroll-main:list");
    }

    if (fromAnimeDetailToAnimeCollection || fromReadingDetailToReadingCollection) {
      prevPathname.current = currentPath;
      return;
    }

    scrollMainToTop();
    prevPathname.current = currentPath;
  }, [location.pathname]);

  return null;
}
