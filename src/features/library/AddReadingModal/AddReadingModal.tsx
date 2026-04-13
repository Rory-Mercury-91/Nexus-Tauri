import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Modal } from "@/components/common/Modal";
import {
  type LibraryEditField,
} from "@/components/modals/LibraryEditEntryModal/LibraryEditEntryModal";
import { getSupabaseClient } from "@/lib/supabaseClient";
import { createManualReadingEntry } from "@/services/library/readingCollectionService";
import {
  getReadingByMalId,
  searchReading,
  type JikanMangaFull,
  type JikanMangaSearchItem,
} from "@/services/jikan/readingJikanService";
import "@/features/library/AddAnimeModal/AddAnimeModal.css";

type AddReadingModalProps = {
  open: boolean;
  onClose: () => void;
};

type ResultRow = {
  malId: number;
  title: string;
  subtitle?: string;
  thumb: string | null;
};

function mapSearchItem(item: JikanMangaSearchItem): ResultRow {
  return {
    malId: item.mal_id,
    title: item.title,
    subtitle:
      [item.type, item.status, item.published?.string].filter(Boolean).join(" · ") || undefined,
    thumb:
      item.images.jpg.small_image_url ||
      item.images.webp.small_image_url ||
      item.images.jpg.image_url ||
      null,
  };
}

function mapFullItem(item: JikanMangaFull): ResultRow {
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

export function AddReadingModal({ open, onClose }: AddReadingModalProps) {
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
    mediaType: "Manga",
    status: "Publishing",
    score: 0,
    authors: "",
    scenarist: "",
    dessinateur: "",
    traducteur: "",
    serializations: "",
    prepublie: "",
    editeurVf: "",
    editeurVo: "",
    publishedString: "",
    anneeVf: "",
    anneeVo: "",
    chapters: 0,
    volumes: 0,
    volumesVf: 0,
    ageConseille: "",
    groupe: "",
    synopsisOriginal: "",
    synopsisFr: "",
    userStatus: "Planifié",
    isFavorite: false,
    imageUrl: "",
    linkMal: "",
    linkNautiljon: "",
    linkAnilist: "",
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
      mediaType: "Manga",
      status: "Publishing",
      score: 0,
      authors: "",
      scenarist: "",
      dessinateur: "",
      traducteur: "",
      serializations: "",
      prepublie: "",
      editeurVf: "",
      editeurVo: "",
      publishedString: "",
      anneeVf: "",
      anneeVo: "",
      chapters: 0,
      volumes: 0,
      volumesVf: 0,
      ageConseille: "",
      groupe: "",
      synopsisOriginal: "",
      synopsisFr: "",
      userStatus: "Planifié",
      isFavorite: false,
      imageUrl: "",
      linkMal: "",
      linkNautiljon: "",
      linkAnilist: "",
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
        const byId = await getReadingByMalId(malId);
        if (byId.ok) {
          setResults([mapFullItem(byId.data.data)]);
          return;
        }
      }
      const search = await searchReading(q, 15);
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
    navigate(`/lectures/${malId}`);
    handleClose();
  }

  const fullFields: LibraryEditField[] = [
    { key: "titleFr", label: "Titre VF", group: "Titres", type: "text", value: fullDraft.titleFr },
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
        { value: "Publishing", label: "En publication" },
        { value: "Finished", label: "Terminé" },
        { value: "On Hiatus", label: "En pause" },
        { value: "Discontinued", label: "Arrêté" },
        { value: "Not yet published", label: "Pas encore publié" },
      ],
    },
    { key: "score", label: "Score", group: "Métadonnées", type: "number", value: fullDraft.score, min: 0, step: 0.01 },
    { key: "authors", label: "Auteurs (séparateur ,)", group: "Métadonnées", type: "text", value: fullDraft.authors, span2: true },
    { key: "scenarist", label: "Scénariste", group: "Métadonnées", type: "text", value: fullDraft.scenarist },
    { key: "dessinateur", label: "Dessinateur", group: "Métadonnées", type: "text", value: fullDraft.dessinateur },
    { key: "traducteur", label: "Traducteur", group: "Métadonnées", type: "text", value: fullDraft.traducteur },
    { key: "serializations", label: "Magazines (séparateur ,)", group: "Métadonnées", type: "text", value: fullDraft.serializations, span2: true },
    { key: "prepublie", label: "Prépublié dans", group: "Métadonnées", type: "text", value: fullDraft.prepublie },
    { key: "editeurVf", label: "Éditeur VF", group: "Métadonnées", type: "text", value: fullDraft.editeurVf },
    { key: "editeurVo", label: "Éditeur VO", group: "Métadonnées", type: "text", value: fullDraft.editeurVo },
    { key: "publishedString", label: "Publication", group: "Métadonnées", type: "text", value: fullDraft.publishedString, span2: true },
    { key: "anneeVf", label: "Année VF", group: "Métadonnées", type: "text", value: fullDraft.anneeVf },
    { key: "anneeVo", label: "Année VO", group: "Métadonnées", type: "text", value: fullDraft.anneeVo },
    { key: "chapters", label: "Chapitres", group: "Métadonnées", type: "number", value: fullDraft.chapters, min: 0 },
    { key: "volumes", label: "Volumes", group: "Métadonnées", type: "number", value: fullDraft.volumes, min: 0 },
    { key: "volumesVf", label: "Volumes VF", group: "Métadonnées", type: "number", value: fullDraft.volumesVf, min: 0 },
    { key: "ageConseille", label: "Âge conseillé", group: "Métadonnées", type: "text", value: fullDraft.ageConseille },
    { key: "groupe", label: "Groupe / Franchise", group: "Métadonnées", type: "text", value: fullDraft.groupe },
    {
      key: "userStatus",
      label: "Mon statut",
      group: "Suivi personnel",
      type: "select",
      value: fullDraft.userStatus,
      options: ["Planifié", "En cours", "En pause", "Terminé", "Abandonné"].map((value) => ({ value, label: value })),
    },
    { key: "isFavorite", label: "Favori", group: "Suivi personnel", type: "toggle", value: fullDraft.isFavorite },
    { key: "imageUrl", label: "Image principale", group: "Liens", type: "text", value: fullDraft.imageUrl, span2: true },
    { key: "linkMal", label: "Lien MAL", group: "Liens", type: "text", value: fullDraft.linkMal, span2: true },
    { key: "linkNautiljon", label: "Lien Nautiljon", group: "Liens", type: "text", value: fullDraft.linkNautiljon },
    { key: "linkAnilist", label: "Lien AniList", group: "Liens", type: "text", value: fullDraft.linkAnilist },
    { key: "synopsisOriginal", label: "Synopsis source", group: "Synopsis", type: "textarea", value: fullDraft.synopsisOriginal, rows: 4, span2: true },
    { key: "synopsisFr", label: "Synopsis FR", group: "Synopsis", type: "textarea", value: fullDraft.synopsisFr, rows: 4, span2: true },
  ];

  async function handleFullCreate() {
    const title =
      fullDraft.titleFr.trim() ||
      fullDraft.titleRomanized.trim() ||
      fullDraft.titleOriginal.trim();
    if (!title) {
      setError("Le titre est obligatoire pour créer la fiche.");
      return;
    }
    setError(null);
    setFullSaving(true);
    try {
      const supabase = getSupabaseClient();
      const malIdValue = fullDraft.malId.trim() ? Number(fullDraft.malId.trim()) : undefined;
      const createdMalId = await createManualReadingEntry(supabase, {
        title,
        malId: Number.isFinite(malIdValue ?? NaN) ? malIdValue : undefined,
        imageUrl: fullDraft.imageUrl.trim() || undefined,
        titleEnglish: fullDraft.titleRomanized,
        titleJapanese: fullDraft.titleOriginal,
        titleAlternatives: fullDraft.titleAlternatives
          .split("|")
          .map((v) => v.trim())
          .filter(Boolean),
        mediaType: fullDraft.mediaType,
        workStatus: fullDraft.status,
        score: Number(fullDraft.score),
        authors: fullDraft.authors,
        scenarist: fullDraft.scenarist,
        dessinateur: fullDraft.dessinateur,
        traducteur: fullDraft.traducteur,
        serializations: fullDraft.serializations,
        prepublie: fullDraft.prepublie,
        editeurVf: fullDraft.editeurVf,
        editeurVo: fullDraft.editeurVo,
        publishedString: fullDraft.publishedString,
        anneeVf: fullDraft.anneeVf,
        anneeVo: fullDraft.anneeVo,
        chapters: Number(fullDraft.chapters),
        volumes: Number(fullDraft.volumes),
        volumesVf: Number(fullDraft.volumesVf),
        ageConseille: fullDraft.ageConseille,
        groupe: fullDraft.groupe,
        synopsis: fullDraft.synopsisOriginal,
        synopsisFr: fullDraft.synopsisFr,
        linkMal: fullDraft.linkMal,
        linkNautiljon: fullDraft.linkNautiljon,
        linkAnilist: fullDraft.linkAnilist,
        userStatus: fullDraft.userStatus as
          | "Planifié"
          | "En cours"
          | "En pause"
          | "Terminé"
          | "Abandonné",
        favorite: fullDraft.isFavorite,
      });
      navigate(`/lectures/${createdMalId}`);
      handleClose();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Impossible de créer la fiche complète."
      );
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
      title="Ajouter une lecture (aperçu Jikan)"
      onClose={handleClose}
      maxWidth="min(96vw, 68rem)"
    >
      <p className="add-anime-hint">1) Import direct (MAL/Jikan)</p>
      <p className="add-anime-hint">💡 Tapez un titre ou un MAL ID → Rechercher → Sélectionnez un résultat.</p>

      <div className="add-anime-form">
        <div className="add-anime-input-wrap">
          <label htmlFor="add-reading-query" className="add-anime-label">
            Ex. One Piece, Solo Leveling, ou ID MAL (13)…
          </label>
          <input
            id="add-reading-query"
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

      <hr style={{ borderColor: "rgba(255,255,255,0.15)", margin: "12px 0" }} />
      <p className="add-anime-hint" style={{ marginTop: 12 }}>2) Création complète (formulaire avancé)</p>
      <div className="add-anime-collapsible-head">
        <button type="button" className="add-anime-btn" onClick={() => setFullExpanded((prev) => !prev)}>
          {fullExpanded ? "Réduire la section" : "Ouvrir la section"}
        </button>
      </div>

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
