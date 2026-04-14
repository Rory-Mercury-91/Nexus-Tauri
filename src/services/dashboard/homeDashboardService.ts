import type { SupabaseClient } from "@supabase/supabase-js";
import {
  listFamilyMembersProfiles,
  listMyFamilies,
  type FamilyMemberProfile,
} from "@/services/family/familyService";
import {
  listOneOffPurchases,
  listRecurringSubscriptions,
  monthlyEquivalentEuros,
  userShareEuros,
  type OneOffPurchaseRow,
  type RecurringSubscriptionRow,
} from "@/services/subscriptions/subscriptionService";
import type { PostgrestError } from "@supabase/supabase-js";

export type DashboardCategory = "reading" | "subscriptions" | "one_off";

export type LibraryRecentEntry = {
  kind: "anime" | "reading";
  id: number;
  title: string;
  imageUrl: string;
  progressLabel: string;
  updatedAt: string;
};

export type LibraryProgressSnapshot = {
  anime: {
    watchedEpisodes: number;
    totalEpisodes: number;
    completedSeries: number;
    totalSeries: number;
    ratioPercent: number;
  };
  reading: {
    readChapters: number;
    totalChapters: number;
    chapterRatioPercent: number;
    readVolumes: number;
    totalVolumes: number;
    volumeRatioPercent: number;
    completedSeries: number;
    totalSeries: number;
    globalRatioPercent: number;
  };
  recent: LibraryRecentEntry[];
};

export type DashboardOwnerCard = {
  userId: string;
  displayName: string;
  avatarStoragePath: string | null;
  /** Lectures (0 tant que la collection n’est pas branchée) + achats ponctuels sur l’année choisie */
  mainEuros: number;
  readingCount: number;
  subscriptionMonthlyEuros: number;
};

function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map((v) => parseInt(v, 10));
  return new Date(y, (m || 1) - 1, d || 1);
}

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toPercent(value: number, total: number): number {
  if (total <= 0) {
    return 0;
  }
  return Math.round((value / total) * 100);
}

function safeString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function resolveEpisodesWatched(row: Record<string, unknown>, total: number): number {
  // Priorité : watch_progress_by_source.mal.episodes_watched
  const watchBySource = (row.watch_progress_by_source ?? {}) as Record<string, unknown>;
  const malProgress = (watchBySource.mal ?? {}) as Record<string, unknown>;
  const fromProgress = Number(malProgress.episodes_watched ?? NaN);

  // Fallback : mal_official_snapshot.list_entry.list_status.num_episodes_watched
  const malSnapshot = (row.mal_official_snapshot ?? {}) as Record<string, unknown>;
  const listEntry = (malSnapshot.list_entry ?? {}) as Record<string, unknown>;
  const listStatus = (listEntry.list_status ?? {}) as Record<string, unknown>;
  const fromSnapshot = Number(listStatus.num_episodes_watched ?? NaN);

  let watched = Number.isFinite(fromProgress) ? fromProgress
    : Number.isFinite(fromSnapshot) ? fromSnapshot
    : 0;

  // MAL quirk : animé "completed" sans suivi ep-par-ep → num_episodes_watched = 0
  if (watched === 0 && total > 0) {
    const watchStatus = safeString(row.watch_status || listStatus.status).trim().toLowerCase();
    if (watchStatus === "completed") {
      watched = total;
    }
  }
  return watched;
}

function parseAnimeProgress(row: Record<string, unknown>) {
  const malSnapshot = (row.mal_official_snapshot ?? {}) as Record<string, unknown>;
  const jikanSnapshot = (row.jikan_snapshot ?? {}) as Record<string, unknown>;
  const full = (jikanSnapshot.full ?? {}) as Record<string, unknown>;
  const listEntry = (malSnapshot.list_entry ?? {}) as Record<string, unknown>;
  const listStatus = (listEntry.list_status ?? {}) as Record<string, unknown>;
  const total =
    toNumber(full.episodes) ||
    toNumber(malSnapshot.num_episodes) ||
    toNumber(listEntry.num_episodes);
  const watched = resolveEpisodesWatched(row, total);
  const watchStatus = safeString(row.watch_status || listStatus.status).trim().toLowerCase();
  const completedSeries = watchStatus === "completed" ? 1 : 0;
  return {
    watched,
    total,
    completedSeries,
  };
}

function parseReadingProgress(row: Record<string, unknown>, volumes: Array<Record<string, unknown>>) {
  const malSnapshot = (row.mal_official_snapshot ?? {}) as Record<string, unknown>;
  const jikanSnapshot = (row.jikan_snapshot ?? {}) as Record<string, unknown>;
  const full = (jikanSnapshot.full ?? {}) as Record<string, unknown>;
  const manualOverrides = (malSnapshot.manual_overrides ?? {}) as Record<string, unknown>;
  const listEntry = (malSnapshot.list_entry ?? {}) as Record<string, unknown>;
  const listStatus = (listEntry.list_status ?? {}) as Record<string, unknown>;
  const readChapters = toNumber(listStatus.num_chapters_read ?? listStatus.num_chapters_readed);
  const totalChapters = toNumber(
    full.chapters ?? malSnapshot.num_chapters ?? listEntry.num_chapters ?? malSnapshot.chapters
  );
  
  // Compter les volumes réellement marqués comme lus
  const readVolumes = volumes.filter((vol) => vol.is_read === true).length;
  
  // Utiliser volumesVf en priorité, sinon volumes VO
  const manualVolumesVf = toNumber(manualOverrides.volumes_vf);
  const totalVolumesVo = toNumber(malSnapshot.num_volumes ?? listEntry.num_volumes ?? malSnapshot.volumes);
  const totalVolumes = manualVolumesVf > 0 ? manualVolumesVf : totalVolumesVo;
  
  const readStatus = safeString(row.read_status || listStatus.status).trim().toLowerCase();
  const completedSeries = readStatus === "completed" ? 1 : 0;
  return {
    readChapters,
    totalChapters,
    readVolumes,
    totalVolumes,
    completedSeries,
  };
}

function buildRecentAnimeEntry(row: Record<string, unknown>): LibraryRecentEntry {
  const malSnapshot = (row.mal_official_snapshot ?? {}) as Record<string, unknown>;
  const jikanSnapshot = (row.jikan_snapshot ?? {}) as Record<string, unknown>;
  const full = (jikanSnapshot.full ?? {}) as Record<string, unknown>;
  const total = toNumber(full.episodes) || toNumber(malSnapshot.num_episodes);
  const seen = resolveEpisodesWatched(row, total);
  const pct = toPercent(seen, total);
  const imageUrl =
    safeString(row.main_picture_url) ||
    safeString(((full.images as Record<string, unknown> | undefined)?.jpg as Record<string, unknown> | undefined)?.image_url);
  return {
    kind: "anime",
    id: toNumber(row.mal_id),
    title: safeString(row.title),
    imageUrl,
    progressLabel: `${seen}/${total || "?"} ép. (${pct}%)`,
    updatedAt: safeString(row.updated_at || row.created_at),
  };
}

function buildRecentReadingEntry(
  row: Record<string, unknown>,
  volumes: Array<Record<string, unknown>>
): LibraryRecentEntry {
  const malSnapshot = (row.mal_official_snapshot ?? {}) as Record<string, unknown>;
  const jikanSnapshot = (row.jikan_snapshot ?? {}) as Record<string, unknown>;
  const full = (jikanSnapshot.full ?? {}) as Record<string, unknown>;
  const listEntry = (malSnapshot.list_entry ?? {}) as Record<string, unknown>;
  const listStatus = (listEntry.list_status ?? {}) as Record<string, unknown>;
  const manualOverrides = (malSnapshot.manual_overrides ?? {}) as Record<string, unknown>;
  
  // Calculer progression volumes
  const readVolumes = volumes.filter((vol) => vol.is_read === true).length;
  const manualVolumesVf = toNumber(manualOverrides.volumes_vf);
  const totalVolumesVo = toNumber(malSnapshot.num_volumes ?? listEntry.num_volumes ?? malSnapshot.volumes);
  const totalVolumes = manualVolumesVf > 0 ? manualVolumesVf : totalVolumesVo;
  
  // Calculer progression chapitres
  const readChapters = toNumber(listStatus.num_chapters_read ?? listStatus.num_chapters_readed);
  const totalChapters = toNumber(full.chapters ?? malSnapshot.num_chapters ?? listEntry.num_chapters);
  
  // Prioriser l'affichage des volumes si disponibles, sinon chapitres
  let progressLabel = "";
  if (totalVolumes > 0) {
    const volPct = toPercent(readVolumes, totalVolumes);
    progressLabel = `${readVolumes}/${totalVolumes} vol. (${volPct}%)`;
  } else if (totalChapters > 0) {
    const chPct = toPercent(readChapters, totalChapters);
    progressLabel = `${readChapters}/${totalChapters} ch. (${chPct}%)`;
  } else {
    progressLabel = `${readChapters}/? ch. (0%)`;
  }
  
  const imageUrl = safeString(row.main_picture_url);
  return {
    kind: "reading",
    id: toNumber(row.mal_manga_id),
    title: safeString(row.title),
    imageUrl,
    progressLabel,
    updatedAt: safeString(row.updated_at || row.created_at),
  };
}

function throwIfError(error: PostgrestError | null): void {
  if (error) {
    throw new Error(error.message);
  }
}

export async function loadLibraryProgressSnapshot(
  supabase: SupabaseClient,
  userId: string
): Promise<LibraryProgressSnapshot> {
  const [animeRes, readingRes] = await Promise.all([
    supabase
      .from("library_anime")
      .select("mal_id, title, main_picture_url, watch_status, created_at, updated_at, mal_official_snapshot, jikan_snapshot, watch_progress_by_source")
      .eq("user_id", userId),
    supabase
      .from("library_reading")
      .select("id, mal_manga_id, title, main_picture_url, read_status, created_at, updated_at, mal_official_snapshot, jikan_snapshot")
      .eq("user_id", userId),
  ]);
  throwIfError(animeRes.error);
  throwIfError(readingRes.error);

  const animeRows = (animeRes.data ?? []) as Array<Record<string, unknown>>;
  const readingRows = (readingRes.data ?? []) as Array<Record<string, unknown>>;
  
  // Récupérer les volumes pour toutes les lectures de l'utilisateur
  // Diviser en lots pour éviter les URLs trop longues
  const readingIds = readingRows.map((row) => String(row.id ?? "")).filter(Boolean);
  const volumeRows: Array<Record<string, unknown>> = [];
  if (readingIds.length > 0) {
    const BATCH_SIZE = 50; // Limiter à 50 IDs par requête
    for (let i = 0; i < readingIds.length; i += BATCH_SIZE) {
      const batch = readingIds.slice(i, i + BATCH_SIZE);
      const volumesRes = await supabase
        .from("user_manga_volume_state")
        .select("reading_id, is_read")
        .in("reading_id", batch);
      throwIfError(volumesRes.error);
      volumeRows.push(...((volumesRes.data ?? []) as Array<Record<string, unknown>>));
    }
  }
  
  // Index des volumes par reading_id
  const volumesByReadingId = new Map<string, Array<Record<string, unknown>>>();
  for (const vol of volumeRows) {
    const readingId = String(vol.reading_id ?? "");
    if (!volumesByReadingId.has(readingId)) {
      volumesByReadingId.set(readingId, []);
    }
    volumesByReadingId.get(readingId)!.push(vol);
  }

  let watchedEpisodes = 0;
  let totalEpisodes = 0;
  let completedAnimeSeries = 0;
  for (const row of animeRows) {
    const p = parseAnimeProgress(row);
    watchedEpisodes += p.watched;
    totalEpisodes += p.total;
    completedAnimeSeries += p.completedSeries;
  }

  let readChapters = 0;
  let totalChapters = 0;
  let readVolumes = 0;
  let totalVolumes = 0;
  let completedReadingSeries = 0;
  for (const row of readingRows) {
    const readingId = String(row.id ?? "");
    const volumes = volumesByReadingId.get(readingId) ?? [];
    const p = parseReadingProgress(row, volumes);
    readChapters += p.readChapters;
    totalChapters += p.totalChapters;
    readVolumes += p.readVolumes;
    totalVolumes += p.totalVolumes;
    completedReadingSeries += p.completedSeries;
  }

  const chapterRatioPercent = toPercent(readChapters, totalChapters);
  const volumeRatioPercent = toPercent(readVolumes, totalVolumes);
  const readingGlobalRatioPercent =
    totalChapters > 0 && totalVolumes > 0
      ? Math.round((chapterRatioPercent + volumeRatioPercent) / 2)
      : chapterRatioPercent || volumeRatioPercent;

  const recent = [
    ...animeRows.map(buildRecentAnimeEntry),
    ...readingRows.map((row) => {
      const readingId = String(row.id ?? "");
      const volumes = volumesByReadingId.get(readingId) ?? [];
      return buildRecentReadingEntry(row, volumes);
    }),
  ]
    .filter((entry) => entry.id > 0 && entry.title)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 10);

  return {
    anime: {
      watchedEpisodes,
      totalEpisodes,
      completedSeries: completedAnimeSeries,
      totalSeries: animeRows.length,
      ratioPercent: toPercent(watchedEpisodes, totalEpisodes),
    },
    reading: {
      readChapters,
      totalChapters,
      chapterRatioPercent,
      readVolumes,
      totalVolumes,
      volumeRatioPercent,
      completedSeries: completedReadingSeries,
      totalSeries: readingRows.length,
      globalRatioPercent: readingGlobalRatioPercent,
    },
    recent,
  };
}

/** L’abonnement couvre-t-il ce mois pour la répartition mensuelle ? */
export function recurringActiveDuringMonth(
  sub: RecurringSubscriptionRow,
  year: number,
  monthIndex: number
): boolean {
  const monthStart = new Date(year, monthIndex, 1);
  const monthEnd = new Date(year, monthIndex + 1, 0);
  const start = parseIsoDate(sub.start_date);
  if (start > monthEnd) {
    return false;
  }
  if (sub.status === "active") {
    return true;
  }
  if (sub.status === "cancelled" && sub.end_date) {
    const end = parseIsoDate(sub.end_date);
    return end >= monthStart;
  }
  return false;
}

function collectOwnerIdsFromSubscriptions(
  recurring: RecurringSubscriptionRow[],
  oneOff: OneOffPurchaseRow[]
): Set<string> {
  const s = new Set<string>();
  for (const r of recurring) {
    r.owner_ids.forEach((id) => s.add(id));
  }
  for (const o of oneOff) {
    o.owner_ids.forEach((id) => s.add(id));
  }
  return s;
}

export async function loadDashboardData(
  supabase: SupabaseClient,
  currentUserId: string
): Promise<{
  recurring: RecurringSubscriptionRow[];
  oneOff: OneOffPurchaseRow[];
  profiles: Map<string, FamilyMemberProfile>;
  memberIds: string[];
  readingVolumes: Array<{ ownerId: string; volumeCount: number; totalCost: number }>;
  readingUniqueCount: number;
}> {
  const [recurring, oneOff, families] = await Promise.all([
    listRecurringSubscriptions(supabase),
    listOneOffPurchases(supabase),
    listMyFamilies(supabase),
  ]);

  const memberIds = new Set<string>([currentUserId]);
  collectOwnerIdsFromSubscriptions(recurring, oneOff).forEach((id) =>
    memberIds.add(id)
  );

  const memberLists = await Promise.all(
    families.map((f) => listFamilyMembersProfiles(supabase, f.id))
  );
  for (const list of memberLists) {
    for (const m of list) {
      memberIds.add(m.id);
    }
  }

  const ids = [...memberIds];
  const { data: profRows } = await supabase
    .from("profiles")
    .select("id, display_name, avatar_storage_path")
    .in("id", ids);

  const profiles = new Map<string, FamilyMemberProfile>();
  for (const p of (profRows ?? []) as FamilyMemberProfile[]) {
    profiles.set(p.id, p);
  }

  // Calculer les coûts des volumes de lecture par propriétaire
  const readingVolumesResult = await calculateReadingVolumesCosts(supabase, ids);

  return {
    recurring,
    oneOff,
    profiles,
    memberIds: ids,
    readingVolumes: readingVolumesResult.byOwner,
    readingUniqueCount: readingVolumesResult.uniqueVolumeCount,
  };
}

/**
 * Calcule les coûts des volumes de lecture par propriétaire
 */
async function calculateReadingVolumesCosts(
  supabase: SupabaseClient,
  userIds: string[]
): Promise<{
  byOwner: Array<{ ownerId: string; volumeCount: number; totalCost: number }>;
  uniqueVolumeCount: number;
}> {
  if (userIds.length === 0) {
    return { byOwner: [], uniqueVolumeCount: 0 };
  }

  // Récupérer tous les volumes avec leurs propriétaires et coûts
  const { data: volumeOwnersData } = await supabase
    .from("family_manga_volume_owner")
    .select("user_id, catalog_volume_id, share_euros")
    .in("user_id", userIds);

  const costsByOwner = new Map<string, { volumeCount: number; totalCost: number }>();
  const uniqueVolumeIds = new Set<string>();

  type FamilyVolumeOwnerRow = {
    user_id: string;
    catalog_volume_id?: string | null;
    share_euros: number | string | null;
  };
  (volumeOwnersData ?? []).forEach((owner) => {
    const typedOwner = owner as FamilyVolumeOwnerRow;
    const userId = typedOwner.user_id;
    const volumeId = String(typedOwner.catalog_volume_id ?? "");
    const shareEuros = Number(typedOwner.share_euros ?? 0);
    if (volumeId) {
      uniqueVolumeIds.add(volumeId);
    }
    
    if (!costsByOwner.has(userId)) {
      costsByOwner.set(userId, { volumeCount: 0, totalCost: 0 });
    }
    
    const current = costsByOwner.get(userId)!;
    current.volumeCount += 1;
    current.totalCost += shareEuros;
  });

  return {
    byOwner: Array.from(costsByOwner.entries()).map(([ownerId, data]) => ({
      ownerId,
      volumeCount: data.volumeCount,
      totalCost: data.totalCost,
    })),
    uniqueVolumeCount: uniqueVolumeIds.size,
  };
}

function ownerSubscriptionMonthlyShare(
  recurring: RecurringSubscriptionRow[],
  ownerId: string
): number {
  let sum = 0;
  for (const sub of recurring) {
    if (sub.status !== "active") {
      continue;
    }
    const n = sub.owner_ids.length || 1;
    if (!sub.owner_ids.includes(ownerId)) {
      continue;
    }
    const me = monthlyEquivalentEuros(sub.price_euros, sub.period_type);
    sum += userShareEuros(me, n, ownerId, sub.owner_ids);
  }
  return sum;
}

function ownerOneOffYearShare(
  oneOff: OneOffPurchaseRow[],
  ownerId: string,
  year: number
): number {
  let sum = 0;
  for (const p of oneOff) {
    if (!p.owner_ids.includes(ownerId)) {
      continue;
    }
    const d = new Date(`${p.purchase_date}T12:00:00`);
    if (d.getFullYear() !== year) {
      continue;
    }
    const n = p.owner_ids.length || 1;
    sum += userShareEuros(p.amount_euros, n, ownerId, p.owner_ids);
  }
  return sum;
}

/** Cartes par profil (foyer + co‑propriétaires abonnements). */
export function buildOwnerCards(
  recurring: RecurringSubscriptionRow[],
  oneOff: OneOffPurchaseRow[],
  profiles: Map<string, FamilyMemberProfile>,
  memberIds: string[],
  currentUserId: string,
  year: number,
  readingVolumes?: Array<{ ownerId: string; volumeCount: number; totalCost: number }>
): DashboardOwnerCard[] {
  const rows: DashboardOwnerCard[] = [];
  for (const userId of memberIds) {
    const pr = profiles.get(userId);
    const displayName =
      pr?.display_name?.trim() ||
      (userId === currentUserId ? "Moi" : `Profil ${userId.slice(0, 6)}…`);
    const subM = ownerSubscriptionMonthlyShare(recurring, userId);
    const oneY = ownerOneOffYearShare(oneOff, userId, year);
    
    // Coûts des volumes de lecture pour cet utilisateur
    const readingData = (readingVolumes ?? []).find((r) => r.ownerId === userId);
    const readingCount = readingData?.volumeCount ?? 0;
    const readingValue = readingData?.totalCost ?? 0;
    
    rows.push({
      userId,
      displayName,
      avatarStoragePath: pr?.avatar_storage_path ?? null,
      mainEuros: round2(readingValue + oneY),
      readingCount,
      subscriptionMonthlyEuros: round2(subM),
    });
  }
  rows.sort((a, b) => {
    if (a.userId === currentUserId) {
      return -1;
    }
    if (b.userId === currentUserId) {
      return 1;
    }
    return a.displayName.localeCompare(b.displayName, "fr");
  });
  return rows;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function buildTotalSummary(cards: DashboardOwnerCard[]): {
  mainEuros: number;
  readingCount: number;
  subscriptionMonthlyEuros: number;
} {
  let main = 0;
  let reading = 0;
  let sub = 0;
  for (const c of cards) {
    main += c.mainEuros;
    reading += c.readingCount;
    sub += c.subscriptionMonthlyEuros;
  }
  return {
    mainEuros: round2(main),
    readingCount: reading,
    subscriptionMonthlyEuros: round2(sub),
  };
}

const MONTH_LABELS_SHORT = [
  "Jan",
  "Fév",
  "Mar",
  "Avr",
  "Mai",
  "Juin",
  "Juil",
  "Août",
  "Sep",
  "Oct",
  "Nov",
  "Déc",
];

/**
 * Série mensuelle pour l’utilisateur connecté (sa part), année et catégorie données.
 * Lectures : 0 tant que la collection n’est pas exposée en service.
 */
export function computeMonthlySeriesForUser(
  recurring: RecurringSubscriptionRow[],
  oneOff: OneOffPurchaseRow[],
  userId: string,
  year: number,
  category: DashboardCategory
): { monthLabel: string; value: number }[] {
  const out: { monthLabel: string; value: number }[] = [];
  for (let m = 0; m < 12; m++) {
    let value = 0;
    if (category === "reading") {
      value = 0;
    } else if (category === "subscriptions") {
      for (const sub of recurring) {
        if (!recurringActiveDuringMonth(sub, year, m)) {
          continue;
        }
        if (!sub.owner_ids.includes(userId)) {
          continue;
        }
        const n = sub.owner_ids.length || 1;
        const me = monthlyEquivalentEuros(sub.price_euros, sub.period_type);
        value += userShareEuros(me, n, userId, sub.owner_ids);
      }
    } else {
      for (const p of oneOff) {
        if (!p.owner_ids.includes(userId)) {
          continue;
        }
        const d = new Date(`${p.purchase_date}T12:00:00`);
        if (d.getFullYear() !== year || d.getMonth() !== m) {
          continue;
        }
        const n = p.owner_ids.length || 1;
        value += userShareEuros(p.amount_euros, n, userId, p.owner_ids);
      }
    }
    out.push({
      monthLabel: MONTH_LABELS_SHORT[m],
      value: round2(value),
    });
  }
  return out;
}

/** Années présentes dans les achats ponctuels + abonnements + année courante (pour le sélecteur). */
export function suggestYearOptions(
  recurring: RecurringSubscriptionRow[],
  oneOff: OneOffPurchaseRow[]
): number[] {
  const years = new Set<number>();
  const yNow = new Date().getFullYear();
  years.add(yNow);
  for (const s of recurring) {
    years.add(parseIsoDate(s.start_date).getFullYear());
    if (s.end_date) {
      years.add(parseIsoDate(s.end_date).getFullYear());
    }
  }
  for (const p of oneOff) {
    years.add(new Date(`${p.purchase_date}T12:00:00`).getFullYear());
  }
  return [...years].sort((a, b) => b - a);
}
