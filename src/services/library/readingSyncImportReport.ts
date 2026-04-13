import type { SyncReadingImportReport, SyncSource } from "@/services/library/syncService";

export function hasReadingImportReportContent(r: SyncReadingImportReport): boolean {
  return (
    (r.from_mal_created ?? 0) +
      (r.from_mal_updated ?? 0) +
      (r.from_anilist_created ?? 0) +
      (r.from_anilist_updated ?? 0) +
      (r.anilist_skipped_has_mal_id ?? 0) +
      (r.mal_also_on_anilist ?? 0) +
      (r.anilist_no_mal_id_count ?? 0) >
    0
  );
}

/** Libellés pour la bannière « Listes manga » après une sync terminée. */
export function formatReadingSyncImportReportLines(
  r: SyncReadingImportReport,
  syncSource: SyncSource
): string[] {
  const lines: string[] = [];
  const c = r.from_mal_created ?? 0;
  const u = r.from_mal_updated ?? 0;
  if (c + u > 0) {
    lines.push(`Manga importés depuis MAL : ${c + u} (${c} créés, ${u} mis à jour)`);
  }
  if (syncSource === "anilist") {
    const ac = r.from_anilist_created ?? 0;
    const au = r.from_anilist_updated ?? 0;
    if (ac + au > 0) {
      lines.push(`Manga importés depuis AniList : ${ac + au} (${ac} créés, ${au} mis à jour)`);
    } else {
      lines.push(
        `Manga importés depuis AniList : 0 — priorité MAL : les entrées avec un MAL ID sont ignorées ici ; sans MAL ID l’import n’est pas encore pris en charge (mal_manga_id requis).`
      );
    }
  }
  const skipAni = r.anilist_skipped_has_mal_id ?? 0;
  if (skipAni > 0) {
    lines.push(`Entrées AniList ignorées (MAL ID présent — données à jour via sync MAL) : ${skipAni}`);
  }
  const overlap = r.mal_also_on_anilist ?? 0;
  if (overlap > 0) {
    lines.push(`Manga importés depuis MAL mais aussi présents sur ta liste AniList : ${overlap}`);
  }
  const noMal = r.anilist_no_mal_id_count ?? 0;
  if (noMal > 0) {
    const titles = (r.anilist_no_mal_id_titles ?? []).slice(0, 15);
    const suffix = titles.length ? ` — Exemples : ${titles.join(" · ")}` : "";
    lines.push(
      `Entrées AniList sans MAL ID (non importées : la base exige un mal_manga_id) : ${noMal}${suffix}`
    );
  }
  return lines;
}
