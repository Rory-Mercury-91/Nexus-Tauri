import { useCallback, useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/common/Modal";
import { getSupabaseClient } from "@/lib/supabaseClient";
import { useSession } from "@/hooks/useSession";
import { notifyToast } from "@/lib/toastEvents";
import { listMyFamilies } from "@/services/family/familyService";
import {
  applyNautiljonImportToReading,
  createReadingEntryFromNautiljon,
  fetchReadingImportTargets,
  type NautiljonImportEnvelope,
  type ReadingImportTarget,
} from "@/services/library/nautiljonImportService";

const NEW_ENTRY_ID = "__new__";
import "./NautiljonImportReceptionModal.css";

type ImportProgressPayload = {
  status?: string;
  message?: string;
};

export function NautiljonImportReceptionModal() {
  const { session } = useSession();
  const [pending, setPending] = useState<NautiljonImportEnvelope | null>(null);
  const [targets, setTargets] = useState<ReadingImportTarget[]>([]);
  const [loadingTargets, setLoadingTargets] = useState(false);
  const [selectedTargetId, setSelectedTargetId] = useState("");
  const [query, setQuery] = useState("");
  const [applying, setApplying] = useState(false);
  const [progressMessage, setProgressMessage] = useState("");

  const refreshPendingFromTauri = useCallback(async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const envelope = await invoke<NautiljonImportEnvelope | null>("get_pending_import");
      setPending(envelope ?? null);
      if (!envelope) {
        setProgressMessage("");
      }
    } catch {
      // Hors contexte Tauri ou commande indisponible.
    }
  }, []);

  const refreshTargets = useCallback(async () => {
    setLoadingTargets(true);
    try {
      const supabase = getSupabaseClient();
      const rows = await fetchReadingImportTargets(supabase);
      setTargets(rows);
    } catch (error) {
      notifyToast({
        kind: "error",
        message:
          error instanceof Error
            ? `Impossible de charger les fiches lectures: ${error.message}`
            : "Impossible de charger les fiches lectures.",
      });
    } finally {
      setLoadingTargets(false);
    }
  }, []);

  useEffect(() => {
    void refreshPendingFromTauri();
  }, [refreshPendingFromTauri]);

  /** RLS Supabase : sans session utilisateur, library_reading renvoie 0 ligne — on recharge quand la session est prête. */
  useEffect(() => {
    if (!session?.user?.id) {
      return;
    }
    void refreshTargets();
  }, [session?.user?.id, refreshTargets]);

  useEffect(() => {
    if (!pending || !session?.user?.id) {
      return;
    }
    void refreshTargets();
  }, [pending?.received_at, pending, session?.user?.id, refreshTargets]);

  useEffect(() => {
    let unlistenProgress: (() => void) | undefined;
    let unlistenPending: (() => void) | undefined;
    (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlistenProgress = await listen<ImportProgressPayload>("nautiljon-import-progress", (event) => {
          const message = String(event.payload?.message ?? "").trim();
          if (message) {
            setProgressMessage(message);
          }
          if (event.payload?.status === "cancelled") {
            setPending(null);
          }
        });
        unlistenPending = await listen<NautiljonImportEnvelope>("nautiljon-import-pending", (event) => {
          setPending(event.payload);
          setProgressMessage("Données reçues. Sélectionne la fiche lecture à enrichir.");
        });
      } catch {
        // Hors contexte Tauri.
      }
    })();
    return () => {
      unlistenProgress?.();
      unlistenPending?.();
    };
  }, []);

  const open = Boolean(pending);
  const payloadTitle = useMemo(() => String(pending?.payload?.titre ?? "Entrée Nautiljon"), [pending]);

  const filteredTargets = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return targets;
    }
    return targets.filter((entry) => {
      const ani = entry.anilistMediaId != null ? String(entry.anilistMediaId) : "";
      if (
        entry.title.toLowerCase().includes(normalized) ||
        String(entry.malMangaId).includes(normalized) ||
        (ani.length > 0 && ani.includes(normalized))
      ) {
        return true;
      }
      // Recherche étendue sur toutes les variantes de titre (romaji, japonais, synonymes…)
      return entry.searchAliases.some((alias) => alias.toLowerCase().includes(normalized));
    });
  }, [query, targets]);

  async function clearPendingAndClose() {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("clear_pending_import");
    } catch {
      // Ignore.
    }
    setPending(null);
    setProgressMessage("");
  }

  const isNewEntry = selectedTargetId === NEW_ENTRY_ID;

  async function handleApplyImport() {
    if (!pending || !selectedTargetId || !session?.user?.id) return;
    setApplying(true);
    try {
      const supabase = getSupabaseClient();
      const families = await listMyFamilies(supabase);
      const familyId = families[0]?.id ?? null;

      if (isNewEntry) {
        const result = await createReadingEntryFromNautiljon(supabase, pending, { familyId });
        await clearPendingAndClose();
        notifyToast({
          kind: "success",
          message: result.volumesUpserted > 0
            ? `Nouvelle fiche créée (${result.volumesUpserted} tome(s) importé(s)).`
            : "Nouvelle fiche lecture créée depuis Nautiljon.",
        });
      } else {
        const result = await applyNautiljonImportToReading(supabase, selectedTargetId, pending, { familyId });
        await clearPendingAndClose();
        notifyToast({
          kind: "success",
          message: result.volumesUpserted > 0
            ? `Import VF appliqué (${result.volumesUpserted} tome(s) mis à jour).`
            : "Import VF appliqué à la fiche lecture.",
        });
      }
      window.dispatchEvent(new Event("focus"));
    } catch (error) {
      notifyToast({
        kind: "error",
        message: error instanceof Error
          ? `Échec de l'import Nautiljon : ${error.message}`
          : "Échec de l'import Nautiljon.",
      });
    } finally {
      setApplying(false);
    }
  }

  return (
    <Modal
      open={open}
      title="Réception Nautiljon (Lectures)"
      onClose={() => {
        void clearPendingAndClose();
      }}
      maxWidth="56rem"
    >
      <div className="nautiljon-import-modal">
        <p className="nautiljon-import-lead">
          {progressMessage || "Des données Nautiljon ont été reçues. Choisis la fiche lecture à enrichir."}
        </p>

        <div className="nautiljon-import-summary">
          <div>
            <span className="nautiljon-import-label">Titre source</span>
            <strong>{payloadTitle}</strong>
          </div>
          <div>
            <span className="nautiljon-import-label">Mode</span>
            <strong>{pending?.mode === "tomes_only" ? "Tomes uniquement" : "Import complet"}</strong>
          </div>
        </div>

        <div className="nautiljon-import-targets">
          {!session?.user?.id ? (
            <p className="nautiljon-import-auth-hint" role="status">
              Connecte-toi pour charger tes fiches lectures depuis la base.
            </p>
          ) : null}
          {session?.user?.id && !loadingTargets && targets.length === 0 ? (
            <p className="nautiljon-import-empty-hint" role="status">
              Aucune fiche lecture trouvée. Vérifie que tu es connecté avec le compte qui possède la collection.
            </p>
          ) : null}
          <label className="nautiljon-import-field">
            <span>Rechercher une fiche lecture</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Titre, MAL ID ou AniList ID"
              className="nautiljon-import-input"
            />
          </label>
          <label className="nautiljon-import-field">
            <span>Entrée cible</span>
            <select
              value={selectedTargetId}
              onChange={(event) => setSelectedTargetId(event.target.value)}
              className="nautiljon-import-select"
              disabled={loadingTargets || applying || !session?.user?.id}
            >
              <option value="">Sélectionner une fiche…</option>
              {/* Option création directe */}
              <option value={NEW_ENTRY_ID}>
                ✦ Créer une nouvelle fiche depuis Nautiljon
              </option>
              {filteredTargets.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {`${entry.title} (MAL ${entry.malMangaId || "—"}${entry.anilistMediaId != null ? ` · AniList ${entry.anilistMediaId}` : ""})`}
                </option>
              ))}
            </select>
          </label>
          {/* Info contextuelle selon le choix */}
          {isNewEntry ? (
            <p className="nautiljon-import-new-hint">
              Une nouvelle fiche sera créée avec un identifiant interne Nexus. Elle pourra être liée à MAL
              ou AniList ultérieurement via une synchronisation.
            </p>
          ) : null}
        </div>

        <div className="nautiljon-import-actions">
          <button type="button" className="anime-collection-btn" onClick={() => void refreshTargets()} disabled={loadingTargets || applying}>
            {loadingTargets ? "Chargement…" : "Rafraîchir les cibles"}
          </button>
          <button type="button" className="anime-collection-btn" onClick={() => void clearPendingAndClose()} disabled={applying}>
            Ignorer
          </button>
          <button
            type="button"
            className="library-add-anime-btn"
            disabled={!selectedTargetId || applying || !session?.user?.id}
            onClick={() => void handleApplyImport()}
          >
            {applying
              ? "Application…"
              : isNewEntry
                ? "Créer la fiche"
                : "Appliquer l'import VF"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

