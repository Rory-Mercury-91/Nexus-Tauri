import { Link } from "react-router-dom";
import type { UseMalOfficialBundleState } from "@/hooks/useMalOfficialBundle";
import type { MalOfficialPart } from "@/services/mal/malOfficialBundleService";

function summarizeRecord(data: unknown): string {
  if (!data || typeof data !== "object") {
    return "";
  }
  const o = data as Record<string, unknown>;
  const title = typeof o.title === "string" ? o.title : "";
  const mean = o.mean != null ? String(o.mean) : "";
  const status = typeof o.status === "string" ? o.status : "";
  return [title, mean && `note ${mean}`, status].filter(Boolean).join(" · ");
}

function MalPartCard({
  title,
  part,
  preview,
}: {
  title: string;
  part: MalOfficialPart;
  preview?: string;
}) {
  if (!part.ok) {
    return (
      <div className="anime-api-mal-card anime-api-mal-card--error">
        <h3 className="anime-api-mal-card-title">{title}</h3>
        <p className="anime-api-mal-card-meta">HTTP {part.status}</p>
        <pre className="anime-api-mal-pre">{part.body}</pre>
      </div>
    );
  }
  return (
    <div className="anime-api-mal-card">
      <h3 className="anime-api-mal-card-title">{title}</h3>
      {preview ? <p className="anime-api-mal-preview">{preview}</p> : null}
      <details className="anime-api-mal-details">
        <summary>JSON brut</summary>
        <pre className="anime-api-mal-pre">{JSON.stringify(part.data, null, 2)}</pre>
      </details>
    </div>
  );
}

type AnimeDetailMalPanelProps = {
  malId: number | null;
  malState: UseMalOfficialBundleState;
};

/**
 * Bloc « atelier » : tout ce que renvoie l’API MAL officielle (via Edge Function) pour la maquette.
 */
export function AnimeDetailMalPanel({ malId, malState }: AnimeDetailMalPanelProps) {
  if (malId === null) {
    return null;
  }

  return (
    <section className="anime-api-lab" id="api-mal" aria-labelledby="api-mal-title">
      <h2 id="api-mal-title" className="anime-api-lab-title">
        API MyAnimeList (officielle) — matière pour la maquette
      </h2>
      <p className="anime-api-lab-lead">
        Appels effectués côté serveur avec ton token OAuth (
        <Link to="/settings">Paramètres → Intégrations</Link>
        ). Compare avec le bloc Jikan ci‑dessous pour décider quoi afficher où.
      </p>

      {malState.status === "loading" ? (
        <p className="anime-detail-loading" role="status">
          Chargement du bundle MAL officiel…
        </p>
      ) : null}

      {malState.status === "error" ? (
        <div className="anime-api-mal-banner anime-api-mal-banner--error" role="alert">
          <strong>
            {malState.code === "not_connected"
              ? "Compte MAL non connecté"
              : "Bundle MAL indisponible"}
          </strong>
          <p>{malState.message}</p>
          {malState.code === "not_connected" ? (
            <p>
              <Link to="/settings">Ouvrir les intégrations</Link>
            </p>
          ) : null}
        </div>
      ) : null}

      {malState.status === "ready" ? (
        <>
          <p className="anime-api-mal-fetched">
            Récupéré le{" "}
            {new Date(malState.payload.fetched_at).toLocaleString("fr-FR")} — MAL id{" "}
            {malState.payload.mal_id}
          </p>
          <div className="anime-api-mal-grid">
            <MalPartCard
              title="GET /users/@me"
              part={malState.payload.parts.user_me}
              preview={
                malState.payload.parts.user_me.ok
                  ? summarizeRecord(malState.payload.parts.user_me.data)
                  : undefined
              }
            />
            <MalPartCard
              title={`GET /anime/${malId} (tous les champs doc)`}
              part={malState.payload.parts.anime_detail}
              preview={
                malState.payload.parts.anime_detail.ok
                  ? summarizeRecord(malState.payload.parts.anime_detail.data)
                  : undefined
              }
            />
            <MalPartCard
              title="GET /users/@me/animelist (aperçu récent)"
              part={malState.payload.parts.animelist_recent}
            />
          </div>
        </>
      ) : null}
    </section>
  );
}
