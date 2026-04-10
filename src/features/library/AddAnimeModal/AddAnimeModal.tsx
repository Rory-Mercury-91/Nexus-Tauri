import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Modal } from "@/components/common/Modal";
import {
  getAnimeByMalId,
  searchAnime,
} from "@/services/jikan/animeJikanService";
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
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<ResultRow[]>([]);

  function resetForClose() {
    setQuery("");
    setError(null);
    setResults([]);
    setLoading(false);
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

  return (
    <Modal
      open={open}
      title="Ajouter un animé (aperçu Jikan)"
      onClose={handleClose}
      maxWidth="34rem"
    >
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

    </Modal>
  );
}
