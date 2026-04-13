import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Modal } from "@/components/common/Modal";
import {
  type LibraryEditField,
} from "@/components/modals/LibraryEditEntryModal/LibraryEditEntryModal";
import { getSupabaseClient } from "@/lib/supabaseClient";
import { createManualAnimeEntry } from "@/services/library/animeCollectionService";
import { getAnimeByMalId, searchAnime } from "@/services/jikan/animeJikanService";
import type { JikanAnimeFull, JikanAnimeSearchItem } from "@/services/jikan/jikanTypes";
import "./AddAnimeModal.css";

type AddAnimeModalProps = {
  open: boolean;
  onClose: () => void;
};

type ResultRow = {
  malId: number;
  title: string;
  subtitle?: string;
  thumb: string | null;
};

function mapSearchItem(item: JikanAnimeSearchItem): ResultRow {
  return {
    malId: item.mal_id,
    title: item.title,
    subtitle: [item.type, item.aired?.string].filter(Boolean).join(" · ") || undefined,
    thumb:
      item.images.jpg.small_image_url ||
      item.images.webp.small_image_url ||
      item.images.jpg.image_url ||
      null,
  };
}

function mapFullAnime(item: JikanAnimeFull): ResultRow {
  return {
    malId: item.mal_id,
    title: item.title,
    subtitle: [item.type, item.status].filter(Boolean).join(" · ") || undefined,
    thumb:
      item.images.jpg.small_image_url ||
      item.images.webp.small_image_url ||
      item.images.jpg.image_url ||
      null,
  };
}

/**
 * Modale de recherche Jikan (titre ou MAL id) et navigation vers la fiche détail locale.
 */
export function AddAnimeModal({ open, onClose }: AddAnimeModalProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [fullSaving, setFullSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<ResultRow[]>([]);
  const [fullExpanded, setFullExpanded] = useState(false);
  const [fullDraft, setFullDraft] = useState({
    titleFr: "",
    titleRomanized: "",
    titleOriginal: "",
    titleAlternatives: "",
    mediaType: "TV",
    status: "Not yet aired",
    rating: "",
    source: "Unknown",
    seasonLabel: "",
    episodes: 0,
    duration: "",
    synopsisOriginal: "",
    synopsisFr: "",
    userStatus: "Planifié",
    isFavorite: false,
    imageUrl: "",
    linkMal: "",
    linkNautiljon: "",
    linkAnilist: "",
    streamCrunchyroll: "",
    streamPrimeVideo: "",
    streamDisneyPlus: "",
    streamAdn: "",
    streamAnimeSama: "",
    trailerUrl: "",
    malId: "",
  });

  function resetForClose() {
    setQuery("");
    setError(null);
    setResults([]);
    setLoading(false);
    setFullSaving(false);
    setFullExpanded(false);
    setFullDraft({
      titleFr: "",
      titleRomanized: "",
      titleOriginal: "",
      titleAlternatives: "",
      mediaType: "TV",
      status: "Not yet aired",
      rating: "",
      source: "Unknown",
      seasonLabel: "",
      episodes: 0,
      duration: "",
      synopsisOriginal: "",
      synopsisFr: "",
      userStatus: "Planifié",
      isFavorite: false,
      imageUrl: "",
      linkMal: "",
      linkNautiljon: "",
      linkAnilist: "",
      streamCrunchyroll: "",
      streamPrimeVideo: "",
      streamDisneyPlus: "",
      streamAdn: "",
      streamAnimeSama: "",
      trailerUrl: "",
      malId: "",
    });
  }

  function handleClose() {
    resetForClose();
    onClose();
  }

  async function handleSearch() {
    const q = query.trim();
    setError(null);
    setResults([]);
    if (!q) {
      setError("Saisissez un titre ou un identifiant MAL.");
      return;
    }

    setLoading(true);
    try {
      if (/^\d+$/.test(q)) {
        const malId = Number(q);
        const byId = await getAnimeByMalId(malId);
        if (byId.ok) {
          setResults([mapFullAnime(byId.data.data)]);
          return;
        }
        const search = await searchAnime(q, 15);
        if (!search.ok) {
          setError(search.message);
          return;
        }
        setResults(search.data.data.map(mapSearchItem));
        if (search.data.data.length === 0) {
          setError("Aucun résultat pour cet identifiant ou ce titre.");
        }
        return;
      }

      const search = await searchAnime(q, 15);
      if (!search.ok) {
        setError(search.message);
        return;
      }
      setResults(search.data.data.map(mapSearchItem));
      if (search.data.data.length === 0) {
        setError("Aucun résultat. Essayez un autre mot-clé ou un MAL ID.");
      }
    } finally {
      setLoading(false);
    }
  }

  function handleImport(malId: number) {
    navigate(`/anime/${malId}`);
    handleClose();
  }

  const fullFields: LibraryEditField[] = [
    { key: "titleFr", label: "Titre francisé", group: "Titres", type: "text", value: fullDraft.titleFr },
    { key: "titleRomanized", label: "Titre romanisé", group: "Titres", type: "text", value: fullDraft.titleRomanized },
    { key: "titleOriginal", label: "Titre original", group: "Titres", type: "text", value: fullDraft.titleOriginal },
    { key: "titleAlternatives", label: "Titres alternatifs (|)", group: "Titres", type: "text", value: fullDraft.titleAlternatives, span2: true },
    { key: "malId", label: "MAL ID (optionnel)", group: "Métadonnées", type: "text", value: fullDraft.malId },
    { key: "mediaType", label: "Type", group: "Métadonnées", type: "text", value: fullDraft.mediaType },
    {
      key: "status",
      label: "Statut oeuvre",
      group: "Métadonnées",
      type: "select",
      value: fullDraft.status,
      options: [
        { value: "Currently Airing", label: "En cours de diffusion" },
        { value: "Finished Airing", label: "Diffusion terminée" },
        { value: "Not yet aired", label: "Pas encore diffusé" },
      ],
    },
    { key: "rating", label: "Classification", group: "Métadonnées", type: "text", value: fullDraft.rating ?? "" },
    { key: "source", label: "Source", group: "Métadonnées", type: "text", value: fullDraft.source },
    { key: "seasonLabel", label: "Saison", group: "Métadonnées", type: "text", value: fullDraft.seasonLabel ?? "" },
    { key: "episodes", label: "Épisodes", group: "Métadonnées", type: "number", value: fullDraft.episodes, min: 0 },
    { key: "duration", label: "Durée", group: "Métadonnées", type: "text", value: fullDraft.duration },
    {
      key: "userStatus",
      label: "Mon statut",
      group: "Suivi personnel",
      type: "select",
      value: fullDraft.userStatus,
      options: ["Planifié", "En cours", "En pause", "Terminé", "Abandonné"].map((value) => ({ value, label: value })),
    },
    { key: "isFavorite", label: "Favori", group: "Suivi personnel", type: "toggle", value: fullDraft.isFavorite },
    { key: "imageUrl", label: "Image URL", group: "Liens", type: "text", value: fullDraft.imageUrl, span2: true },
    { key: "linkMal", label: "Lien MAL", group: "Liens", type: "text", value: fullDraft.linkMal ?? "", span2: true },
    { key: "linkNautiljon", label: "Lien Nautiljon", group: "Liens", type: "text", value: fullDraft.linkNautiljon ?? "" },
    { key: "linkAnilist", label: "Lien AniList", group: "Liens", type: "text", value: fullDraft.linkAnilist ?? "" },
    { key: "streamCrunchyroll", label: "Crunchyroll", group: "Liens", type: "text", value: fullDraft.streamCrunchyroll ?? "" },
    { key: "streamPrimeVideo", label: "Prime Video", group: "Liens", type: "text", value: fullDraft.streamPrimeVideo ?? "" },
    { key: "streamDisneyPlus", label: "Disney+", group: "Liens", type: "text", value: fullDraft.streamDisneyPlus ?? "" },
    { key: "streamAdn", label: "ADN", group: "Liens", type: "text", value: fullDraft.streamAdn ?? "" },
    { key: "streamAnimeSama", label: "Anime-sama", group: "Liens", type: "text", value: fullDraft.streamAnimeSama ?? "" },
    { key: "trailerUrl", label: "Trailer", group: "Liens", type: "text", value: fullDraft.trailerUrl ?? "", span2: true },
    { key: "synopsisOriginal", label: "Synopsis source", group: "Synopsis", type: "textarea", value: fullDraft.synopsisOriginal, rows: 4, span2: true },
    { key: "synopsisFr", label: "Synopsis FR", group: "Synopsis", type: "textarea", value: fullDraft.synopsisFr, rows: 4, span2: true },
  ];

  async function handleFullCreate() {
    const title = fullDraft.titleFr.trim() || fullDraft.titleRomanized.trim() || fullDraft.titleOriginal.trim();
    if (!title) {
      setError("Le titre est obligatoire pour créer la fiche.");
      return;
    }
    setError(null);
    setFullSaving(true);
    try {
      const supabase = getSupabaseClient();
      const malIdValue = fullDraft.malId.trim() ? Number(fullDraft.malId.trim()) : undefined;
      const createdMalId = await createManualAnimeEntry(supabase, {
        title,
        malId: Number.isFinite(malIdValue ?? NaN) ? malIdValue : undefined,
        imageUrl: fullDraft.imageUrl.trim() || undefined,
        titleEnglish: fullDraft.titleRomanized,
        titleJapanese: fullDraft.titleOriginal,
        titleAlternatives: fullDraft.titleAlternatives.split("|").map((v) => v.trim()).filter(Boolean),
        mediaType: fullDraft.mediaType,
        workStatus: fullDraft.status,
        source: fullDraft.source,
        rating: fullDraft.rating,
        seasonLabel: fullDraft.seasonLabel,
        episodes: Number(fullDraft.episodes),
        duration: fullDraft.duration,
        synopsis: fullDraft.synopsisOriginal,
        synopsisFr: fullDraft.synopsisFr,
        linkMal: fullDraft.linkMal,
        linkNautiljon: fullDraft.linkNautiljon,
        linkAnilist: fullDraft.linkAnilist,
        streamCrunchyroll: fullDraft.streamCrunchyroll,
        streamPrimeVideo: fullDraft.streamPrimeVideo,
        streamDisneyPlus: fullDraft.streamDisneyPlus,
        streamAdn: fullDraft.streamAdn,
        streamAnimeSama: fullDraft.streamAnimeSama,
        trailerUrl: fullDraft.trailerUrl,
        userStatus: fullDraft.userStatus as "Planifié" | "En cours" | "En pause" | "Terminé" | "Abandonné",
        favorite: fullDraft.isFavorite,
      });
      navigate(`/anime/${createdMalId}`);
      handleClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Impossible de créer la fiche complète.");
    } finally {
      setFullSaving(false);
    }
  }

  const groupedFullFields = fullFields.reduce<Array<{ title: string; fields: LibraryEditField[] }>>((acc, field) => {
    const title = (field.group ?? "Général").trim() || "Général";
    const existing = acc.find((item) => item.title === title);
    if (existing) {
      existing.fields.push(field);
      return acc;
    }
    acc.push({ title, fields: [field] });
    return acc;
  }, []);

  return (
    <Modal
      open={open}
      title="Ajouter un animé (aperçu Jikan)"
      onClose={handleClose}
      maxWidth="min(96vw, 68rem)"
    >
      <p className="add-anime-hint">
        1) Import direct (MAL/Jikan)
      </p>
      <p className="add-anime-hint">
        💡 Tapez un titre ou un MAL ID → Rechercher → Sélectionnez un résultat.
      </p>

      <div className="add-anime-form">
        <div className="add-anime-input-wrap">
          <label htmlFor="add-anime-query" className="add-anime-label">
            Ex. One Piece, Naruto, ou ID MAL (85781)…
          </label>
          <input
            id="add-anime-query"
            className="add-anime-input"
            type="search"
            autoComplete="off"
            placeholder="Titre ou MAL ID…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void handleSearch();
              }
            }}
          />
        </div>
        <button
          type="button"
          className="add-anime-btn"
          disabled={loading}
          onClick={() => void handleSearch()}
        >
          Rechercher
        </button>
      </div>

      {error ? (
        <p className="add-anime-error" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="add-anime-empty" role="status">
          Recherche en cours…
        </p>
      ) : null}

      {!loading && results.length > 0 ? (
        <ul className="add-anime-results" aria-label="Résultats de recherche">
          {results.map((row, index) => (
            <li key={`${row.malId}-${row.title}-${index}`} className="add-anime-result-row">
              {row.thumb ? (
                <img
                  className="add-anime-thumb"
                  src={row.thumb}
                  alt=""
                  width={56}
                  height={80}
                />
              ) : (
                <div className="add-anime-thumb" aria-hidden />
              )}
              <div>
                <p className="add-anime-result-title">{row.title}</p>
                {row.subtitle ? (
                  <p className="add-anime-result-meta">{row.subtitle}</p>
                ) : null}
                <p className="add-anime-result-meta">MAL #{row.malId}</p>
              </div>
              <button
                type="button"
                className="add-anime-import-btn"
                onClick={() => handleImport(row.malId)}
              >
                Importer
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <hr style={{ borderColor: "rgba(255,255,255,0.15)", margin: "12px 0" }} />
      <p className="add-anime-hint" style={{ marginTop: 12 }}>2) Création complète (formulaire avancé)</p>
      <div className="add-anime-collapsible-head">
        <button type="button" className="add-anime-btn" onClick={() => setFullExpanded((prev) => !prev)}>
          {fullExpanded ? "Réduire la section" : "Ouvrir la section"}
        </button>
      </div>
      {fullExpanded ? (
        <div className="add-anime-full-inline">
          <p className="add-anime-hint">
            Statut oeuvre utilise les valeurs MAL. MAL ID est optionnel.
          </p>
          <div className="library-edit-modal-sections">
            {groupedFullFields.map((group) => (
              <section key={group.title} className="library-edit-modal-section">
                <h3 className="library-edit-modal-section-title">{group.title}</h3>
                <div className="library-edit-modal-grid">
                  {group.fields.map((field) => {
                    const wrapperClass = `library-edit-modal-field${field.span2 ? " is-span-2" : ""}`;
                    if (field.type === "toggle") {
                      return (
                        <label key={field.key} className={`${wrapperClass} is-toggle`}>
                          <span>{field.label}</span>
                          <input
                            type="checkbox"
                            checked={Boolean(field.value)}
                            onChange={(e) => setFullDraft((prev) => ({ ...prev, [field.key]: e.target.checked as never }))}
                            disabled={fullSaving}
                          />
                        </label>
                      );
                    }
                    if (field.type === "textarea") {
                      return (
                        <label key={field.key} className={wrapperClass}>
                          {field.label}
                          <textarea
                            value={String(field.value ?? "")}
                            rows={field.rows ?? 4}
                            placeholder={field.placeholder}
                            onChange={(e) => setFullDraft((prev) => ({ ...prev, [field.key]: e.target.value as never }))}
                            disabled={fullSaving}
                          />
                        </label>
                      );
                    }
                    if (field.type === "select") {
                      return (
                        <label key={field.key} className={wrapperClass}>
                          {field.label}
                          <select
                            value={String(field.value ?? "")}
                            onChange={(e) => setFullDraft((prev) => ({ ...prev, [field.key]: e.target.value as never }))}
                            disabled={fullSaving}
                          >
                            {(field.options ?? []).map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      );
                    }
                    return (
                      <label key={field.key} className={wrapperClass}>
                        {field.label}
                        <input
                          type={field.type === "number" ? "number" : "text"}
                          value={field.type === "number" ? Number(field.value ?? 0) : String(field.value ?? "")}
                          min={field.min}
                          step={field.step}
                          placeholder={field.placeholder}
                          onChange={(e) =>
                            setFullDraft((prev) => ({
                              ...prev,
                              [field.key]:
                                field.type === "number" ? (Number(e.target.value) || 0) : (e.target.value as never),
                            }))
                          }
                          disabled={fullSaving}
                        />
                      </label>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
          <div className="library-edit-modal-actions">
            <button type="button" className="anime-detail-action-btn anime-detail-action-btn-primary" onClick={() => void handleFullCreate()} disabled={fullSaving}>
              {fullSaving ? "Création..." : "Créer la fiche"}
            </button>
          </div>
        </div>
      ) : null}

    </Modal>
  );
}
