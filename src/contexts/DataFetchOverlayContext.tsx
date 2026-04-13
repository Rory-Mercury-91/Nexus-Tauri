import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { DataLoadingOverlay } from "@/components/common/DataLoadingOverlay";

type DataFetchOverlayContextValue = {
  /** À appeler avant une requête réseau (pages / données). Équilibrer avec `endPageDataLoad`. */
  beginPageDataLoad: () => void;
  /** À appeler après la requête (succès ou erreur), typiquement dans `finally`. */
  endPageDataLoad: () => void;
};

const DataFetchOverlayContext =
  createContext<DataFetchOverlayContextValue | null>(null);

/**
 * Compteur de chargements imbriqués : l’overlay reste tant qu’au moins une requête est en cours.
 */
export function DataFetchOverlayProvider({ children }: { children: ReactNode }) {
  const [depth, setDepth] = useState(0);

  const beginPageDataLoad = useCallback(() => {
    setDepth((d) => d + 1);
  }, []);

  const endPageDataLoad = useCallback(() => {
    setDepth((d) => Math.max(0, d - 1));
  }, []);

  const value = useMemo(
    () => ({ beginPageDataLoad, endPageDataLoad }),
    [beginPageDataLoad, endPageDataLoad]
  );

  return (
    <DataFetchOverlayContext.Provider value={value}>
      {children}
      {depth > 0 ? (
        <DataLoadingOverlay title="Chargement des données" />
      ) : null}
    </DataFetchOverlayContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useDataFetchOverlay(): DataFetchOverlayContextValue {
  const ctx = useContext(DataFetchOverlayContext);
  if (!ctx) {
    throw new Error(
      "useDataFetchOverlay doit être utilisé dans un DataFetchOverlayProvider."
    );
  }
  return ctx;
}
