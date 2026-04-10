import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useDataFetchOverlay } from "@/contexts/DataFetchOverlayContext";
import { useSession } from "@/hooks/useSession";
import { getSupabaseClient } from "@/lib/supabaseClient";
import type { FamilyMemberProfile } from "@/services/family/familyService";
import {
  buildOwnerCards,
  buildTotalSummary,
  computeMonthlySeriesForUser,
  loadLibraryProgressSnapshot,
  loadDashboardData,
  suggestYearOptions,
  type DashboardCategory,
  type LibraryProgressSnapshot,
} from "@/services/dashboard/homeDashboardService";
import type {
  OneOffPurchaseRow,
  RecurringSubscriptionRow,
} from "@/services/subscriptions/subscriptionService";
import { DashboardCostChart } from "@/pages/home/DashboardCostChart";
import { DashboardOwnerCards } from "@/pages/home/DashboardOwnerCards";
import "./HomePage.css";

function formatEuros(n: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
  }).format(n);
}

/**
 * Tableau de bord : coûts par membre (abonnements + achats ponctuels) et histogramme mensuel.
 */
export function HomePage() {
  const { session } = useSession();
  const userId = session?.user?.id ?? "";
  const { beginPageDataLoad, endPageDataLoad } = useDataFetchOverlay();

  const [recurring, setRecurring] = useState<RecurringSubscriptionRow[]>([]);
  const [oneOff, setOneOff] = useState<OneOffPurchaseRow[]>([]);
  const [profiles, setProfiles] = useState<Map<string, FamilyMemberProfile>>(
    new Map()
  );
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [readingVolumes, setReadingVolumes] = useState<Array<{ ownerId: string; volumeCount: number; totalCost: number }>>([]);

  const [year, setYear] = useState(() => new Date().getFullYear());
  const [category, setCategory] =
    useState<DashboardCategory>("subscriptions");
  const [dataLoaded, setDataLoaded] = useState(false);
  const [libraryProgress, setLibraryProgress] = useState<LibraryProgressSnapshot | null>(null);
  const [progressCollapsed, setProgressCollapsed] = useState(false);
  const [recentCollapsed, setRecentCollapsed] = useState(false);
  const [ownersCollapsed, setOwnersCollapsed] = useState(true);
  const [chartCollapsed, setChartCollapsed] = useState(true);

  const load = useCallback(async () => {
    if (!userId) {
      return;
    }
    beginPageDataLoad();
    try {
      const supabase = getSupabaseClient();
      const [d, progress] = await Promise.all([
        loadDashboardData(supabase, userId),
        loadLibraryProgressSnapshot(supabase, userId),
      ]);
      setRecurring(d.recurring);
      setOneOff(d.oneOff);
      setProfiles(d.profiles);
      setMemberIds(d.memberIds);
      setReadingVolumes(d.readingVolumes);
      setLibraryProgress(progress);
    } finally {
      endPageDataLoad();
      setDataLoaded(true);
    }
  }, [userId, beginPageDataLoad, endPageDataLoad]);

  useEffect(() => {
    void load();
  }, [load]);

  const ownerCards = useMemo(
    () =>
      buildOwnerCards(recurring, oneOff, profiles, memberIds, userId, year, readingVolumes),
    [recurring, oneOff, profiles, memberIds, userId, year, readingVolumes]
  );

  const total = useMemo(() => buildTotalSummary(ownerCards), [ownerCards]);

  const chartData = useMemo(
    () =>
      computeMonthlySeriesForUser(recurring, oneOff, userId, year, category),
    [recurring, oneOff, userId, year, category]
  );

  const yearOptions = useMemo(
    () => suggestYearOptions(recurring, oneOff),
    [recurring, oneOff]
  );

  return (
    <div className="home-page">
      <header className="home-page-header">
        <h1 className="home-page-title">Tableau de bord</h1>
      </header>
      {libraryProgress ? (
        <section className="home-progress-section">
          <div className="home-kpi-grid">
            <div className="home-kpi-card">
              <div className="home-kpi-icon" style={{ color: "#f97316" }}>📚</div>
              <div className="home-kpi-value" style={{ color: "#f97316" }}>
                {libraryProgress.reading.totalSeries}
              </div>
              <div className="home-kpi-label">
                Série{libraryProgress.reading.totalSeries > 1 ? "s" : ""}
              </div>
            </div>

            <div className="home-kpi-card">
              <div className="home-kpi-icon" style={{ color: "#d946ef" }}>📖</div>
              <div className="home-kpi-double-value">
                <div>
                  <div className="home-kpi-value" style={{ color: "#d946ef", fontSize: "1.5rem" }}>
                    {libraryProgress.reading.readVolumes}
                  </div>
                  <div className="home-kpi-label" style={{ fontSize: "0.7rem" }}>
                    Volume{libraryProgress.reading.readVolumes > 1 ? "s" : ""} lu{libraryProgress.reading.readVolumes > 1 ? "s" : ""}
                  </div>
                </div>
                <div style={{ color: "var(--text-secondary)", fontSize: "1.2rem", fontWeight: "300" }}>|</div>
                <div>
                  <div className="home-kpi-value" style={{ color: "#f59e0b", fontSize: "1.5rem" }}>
                    {libraryProgress.reading.readChapters}
                  </div>
                  <div className="home-kpi-label" style={{ fontSize: "0.7rem" }}>
                    Chapitre{libraryProgress.reading.readChapters > 1 ? "s" : ""} lu{libraryProgress.reading.readChapters > 1 ? "s" : ""}
                  </div>
                </div>
              </div>
            </div>

            <div className="home-kpi-card">
              <div className="home-kpi-icon" style={{ color: "#10b981" }}>🎬</div>
              <div className="home-kpi-value" style={{ color: "#10b981" }}>
                {libraryProgress.anime.totalSeries}
              </div>
              <div className="home-kpi-label">
                Animé{libraryProgress.anime.totalSeries > 1 ? "s" : ""}
              </div>
              <div className="home-kpi-sublabel">
                {libraryProgress.anime.watchedEpisodes} ép. vue{libraryProgress.anime.watchedEpisodes > 1 ? "s" : ""}
              </div>
            </div>

            <div className="home-kpi-card">
              <div className="home-kpi-icon">📊</div>
              <div className="home-kpi-value" style={{ color: "var(--success)" }}>
                {libraryProgress.reading.globalRatioPercent}%
              </div>
              <div className="home-kpi-label">Progression lecture</div>
              <div className="home-kpi-sublabel">
                {libraryProgress.reading.completedSeries}/{libraryProgress.reading.totalSeries} séries terminées
              </div>
            </div>

            <div className="home-kpi-card">
              <div className="home-kpi-icon">🎯</div>
              <div className="home-kpi-value" style={{ color: "#3b82f6" }}>
                {libraryProgress.anime.ratioPercent}%
              </div>
              <div className="home-kpi-label">Progression animés</div>
              <div className="home-kpi-sublabel">
                {libraryProgress.anime.completedSeries}/{libraryProgress.anime.totalSeries} séries terminées
              </div>
            </div>
          </div>

          <div className="home-section-container">
            <h2 className="home-section-title">📊 Progression</h2>

            <article className="home-progress-block">
              <div className="home-progress-inline">
                <div className="home-progress-inline-header">
                  <span className="home-progress-inline-icon">📚</span>
                  <span className="home-progress-inline-title">Lectures :</span>
                </div>
                <div className="home-progress-inline-stats">
                  <span style={{ color: "var(--primary)" }}>
                    {libraryProgress.reading.readChapters}/{libraryProgress.reading.totalChapters || "?"} ch. ({libraryProgress.reading.chapterRatioPercent}%)
                  </span>
                  <span className="home-progress-inline-separator">|</span>
                  <span style={{ color: "#d946ef" }}>
                    {libraryProgress.reading.readVolumes}/{libraryProgress.reading.totalVolumes || "?"} vol. ({libraryProgress.reading.volumeRatioPercent}%)
                  </span>
                  <span className="home-progress-inline-separator">|</span>
                  <span style={{ color: "var(--success)" }}>
                    {libraryProgress.reading.completedSeries}/{libraryProgress.reading.totalSeries} séries
                  </span>
                  <span className="home-progress-inline-separator">|</span>
                  <span style={{ color: "var(--secondary)" }}>
                    {libraryProgress.reading.globalRatioPercent}% (global)
                  </span>
                </div>
              </div>

              <div className="home-progress-bars">
                <div className="home-progress-bar-item">
                  <div className="home-progress-bar-label">Progression chapitres</div>
                  <div className="home-progress-bar">
                    <div style={{ width: `${libraryProgress.reading.chapterRatioPercent}%` }} />
                  </div>
                </div>
                <div className="home-progress-bar-item">
                  <div className="home-progress-bar-label">Progression volumes</div>
                  <div className="home-progress-bar">
                    <div style={{ width: `${libraryProgress.reading.volumeRatioPercent}%`, background: "linear-gradient(90deg, #d946ef, #a855f7)" }} />
                  </div>
                </div>
                <div className="home-progress-bar-item">
                  <div className="home-progress-bar-label">Progression globale</div>
                  <div className="home-progress-bar">
                    <div style={{ width: `${libraryProgress.reading.globalRatioPercent}%` }} />
                  </div>
                </div>
              </div>
            </article>

            <article className="home-progress-block">
              <div className="home-progress-inline">
                <div className="home-progress-inline-header">
                  <span className="home-progress-inline-icon">🎬</span>
                  <span className="home-progress-inline-title">Animés :</span>
                </div>
                <div className="home-progress-inline-stats">
                  <span style={{ color: "var(--primary)" }}>
                    {libraryProgress.anime.watchedEpisodes}/{libraryProgress.anime.totalEpisodes || "?"} ép.
                  </span>
                  <span className="home-progress-inline-separator">|</span>
                  <span style={{ color: "var(--success)" }}>
                    {libraryProgress.anime.completedSeries}/{libraryProgress.anime.totalSeries} séries
                  </span>
                  <span className="home-progress-inline-separator">|</span>
                  <span style={{ color: "var(--secondary)" }}>
                    {libraryProgress.anime.ratioPercent}%
                  </span>
                </div>
              </div>

              <div className="home-progress-bars">
                <div className="home-progress-bar-item">
                  <div className="home-progress-bar-label">Progression animés</div>
                  <div className="home-progress-bar">
                    <div style={{ width: `${libraryProgress.anime.ratioPercent}%` }} />
                  </div>
                </div>
              </div>
            </article>
          </div>
        </section>
      ) : null}

      {libraryProgress?.recent.length ? (
        <section className="home-recent-section">
          {recentCollapsed ? (
            <button
              type="button"
              className="home-panel-toggle is-collapsed"
              onClick={() => setRecentCollapsed(false)}
              aria-expanded={false}
            >
              <h2 className="home-progress-title">📘 Progression récente</h2>
              <span className="home-panel-chevron">▸</span>
            </button>
          ) : (
            <div className="home-section-container">
              <h2 className="home-section-title">📘 Progression récente</h2>
              <div className="home-recent-carousel">
              {libraryProgress.recent.map((entry) => {
                const to = entry.kind === "anime" ? `/anime/${entry.id}` : `/lectures/${entry.id}`;
                const imageUrl = entry.imageUrl?.includes("nautiljon.com") 
                  ? `http://127.0.0.1:40000/api/proxy-image?url=${encodeURIComponent(entry.imageUrl)}`
                  : entry.imageUrl;
                return (
                  <Link key={`${entry.kind}-${entry.id}-${entry.updatedAt}`} to={to} className="home-recent-card">
                    {imageUrl ? (
                      <img src={imageUrl} alt="" className="home-recent-image" loading="lazy" />
                    ) : (
                      <div className="home-recent-image home-recent-image-placeholder" aria-hidden />
                    )}
                    <small className="home-recent-progress">{entry.progressLabel}</small>
                    <strong className="home-recent-title">{entry.title}</strong>
                  </Link>
                );
              })}
              </div>
            </div>
          )}
        </section>
      ) : null}

      {ownerCards.length > 0 ? (
        <section className="home-recent-section">
          {ownersCollapsed ? (
            <button
              type="button"
              className="home-panel-toggle is-collapsed"
              onClick={() => setOwnersCollapsed(false)}
              aria-expanded={false}
            >
              <h2 className="home-progress-title">👥 Répartition par propriétaire</h2>
              <span className="home-panel-chevron">▸</span>
            </button>
          ) : (
            <div className="home-section-container">
              <h2 className="home-section-title">👥 Répartition par propriétaire</h2>
              <DashboardOwnerCards
                cards={ownerCards}
                total={total}
                formatEuros={formatEuros}
              />
            </div>
          )}
        </section>
      ) : null}
      {dataLoaded && ownerCards.length === 0 ? (
        <p className="home-dash-placeholder">
          Aucun membre de foyer ou de coût partagé à afficher pour l'instant.
        </p>
      ) : null}

      {userId ? (
        <section className="home-recent-section">
          {chartCollapsed ? (
            <button
              type="button"
              className="home-panel-toggle is-collapsed"
              onClick={() => setChartCollapsed(false)}
              aria-expanded={false}
            >
              <h2 className="home-progress-title">📈 Évolution mensuelle</h2>
              <span className="home-panel-chevron">▸</span>
            </button>
          ) : (
            <div className="home-section-container">
              <h2 className="home-section-title">📈 Évolution mensuelle</h2>
              <DashboardCostChart
                data={chartData}
                category={category}
                onCategoryChange={setCategory}
                year={year}
                yearOptions={yearOptions}
                onYearChange={setYear}
                embedded
              />
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
