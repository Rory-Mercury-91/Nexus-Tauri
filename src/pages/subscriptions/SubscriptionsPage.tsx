import { useCallback, useEffect, useMemo, useState } from "react";
import { Ban, Pencil } from "lucide-react";
import { ProfileAvatarImage } from "@/components/common/ProfileAvatarImage";
import { getSupabaseClient } from "@/lib/supabaseClient";
import type { FamilyMemberProfile, FamilySummary } from "@/services/family/familyService";
import { listMyFamilies } from "@/services/family/familyService";
import {
  cancelRecurringSubscription,
  distinctPurchaseSites,
  listOneOffPurchases,
  listRecurringSubscriptions,
  monthlyEquivalentEuros,
  type OneOffPeriodFilter,
  type OneOffPurchaseRow,
  type PeriodType,
  purchaseInPeriod,
  type RecurringSubscriptionRow,
  userShareEuros,
  yearlyEquivalentEuros,
} from "@/services/subscriptions/subscriptionService";
import { useDataFetchOverlay } from "@/contexts/DataFetchOverlayContext";
import { useSession } from "@/hooks/useSession";
import {
  getSubscriptionsPageCache,
  invalidateSubscriptionsPageCache,
  isSubscriptionsCacheFresh,
  setSubscriptionsPageCache,
} from "@/lib/subscriptionsPageCache";
import { OneOffPurchaseModal } from "@/pages/subscriptions/OneOffPurchaseModal";
import { RecurringSubscriptionModal } from "@/pages/subscriptions/RecurringSubscriptionModal";
import "./SubscriptionsPage.css";

const PERIOD_LABELS: Record<PeriodType, string> = {
  weekly: "Hebdomadaire",
  monthly: "Mensuel",
  yearly: "Annuel",
  other: "Autre",
};

/** Nombre d’achats ponctuels visibles par défaut ; au-delà, considérés comme archivés (masqués). */
const ONE_OFF_VISIBLE_LIMIT = 10;

type RecurringListFilter = "active" | "archived" | "all";

function formatEuros(n: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
  }).format(n);
}

function formatDateFr(isoDate: string | null): string {
  if (!isoDate) {
    return "—";
  }
  const d = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(d.getTime())) {
    return isoDate;
  }
  return new Intl.DateTimeFormat("fr-FR").format(d);
}

/** Libellé français pour le nombre de crédits achetés (achats ponctuels). */
function formatCreditsPurchased(n: number): string {
  const formatted = new Intl.NumberFormat("fr-FR", {
    maximumFractionDigits: 2,
  }).format(n);
  if (Math.abs(n - 1) < 1e-9) {
    return "1 crédit";
  }
  return `${formatted} crédits`;
}

/** Libellé période en minuscules pour l’affichage « X € / … ». */
function periodLabelLower(period: PeriodType): string {
  return PERIOD_LABELS[period].toLowerCase();
}

/** Notes pour le tooltip natif (title) : une ligne lisible au survol. */
function notesAsTooltip(notes: string | undefined): string | undefined {
  if (!notes?.trim()) {
    return undefined;
  }
  return notes.trim().replace(/\s+/g, " ");
}

export function SubscriptionsPage() {
  const { session } = useSession();
  const { beginPageDataLoad, endPageDataLoad } = useDataFetchOverlay();
  const userId = session?.user?.id ?? "";

  const [families, setFamilies] = useState<FamilySummary[]>([]);
  const [recurring, setRecurring] = useState<RecurringSubscriptionRow[]>([]);
  const [oneOff, setOneOff] = useState<OneOffPurchaseRow[]>([]);
  const [sites, setSites] = useState<string[]>([]);
  const [profiles, setProfiles] = useState<Map<string, FamilyMemberProfile>>(
    new Map()
  );
  const [oneOffFilter, setOneOffFilter] = useState<OneOffPeriodFilter>("month");
  const [recurringListFilter, setRecurringListFilter] =
    useState<RecurringListFilter>("active");
  const [showAllOneOff, setShowAllOneOff] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [modalRecurring, setModalRecurring] = useState<"create" | "edit" | null>(
    null
  );
  const [editRow, setEditRow] = useState<RecurringSubscriptionRow | null>(null);
  const [modalOneOff, setModalOneOff] = useState<"create" | "edit" | null>(
    null
  );
  const [editOneOffRow, setEditOneOffRow] = useState<OneOffPurchaseRow | null>(
    null
  );

  const reload = useCallback(async () => {
    if (!userId) {
      return;
    }
    beginPageDataLoad();
    setLoadError(null);
    try {
      const supabase = getSupabaseClient();
      const [fam, rec, off, st] = await Promise.all([
        listMyFamilies(supabase),
        listRecurringSubscriptions(supabase),
        listOneOffPurchases(supabase),
        distinctPurchaseSites(supabase),
      ]);
      setFamilies(fam);
      setRecurring(rec);
      setOneOff(off);
      setSites(st);
      const allIds = new Set<string>();
      for (const r of rec) {
        r.owner_ids.forEach((id) => allIds.add(id));
      }
      for (const o of off) {
        o.owner_ids.forEach((id) => allIds.add(id));
      }
      let profilesMap = new Map<string, FamilyMemberProfile>();
      if (allIds.size > 0) {
        const { data: profRows, error: pe } = await supabase
          .from("profiles")
          .select("id, display_name, avatar_storage_path")
          .in("id", [...allIds]);
        if (!pe && profRows) {
          const m = new Map<string, FamilyMemberProfile>();
          for (const p of profRows as FamilyMemberProfile[]) {
            m.set(p.id, p);
          }
          profilesMap = m;
          setProfiles(m);
        } else {
          setProfiles(new Map());
        }
      } else {
        setProfiles(new Map());
      }
      setSubscriptionsPageCache(userId, {
        families: fam,
        recurring: rec,
        oneOff: off,
        sites: st,
        profilesRecord: Object.fromEntries(profilesMap.entries()),
      });
    } catch (e) {
      setLoadError(
        e instanceof Error ? e.message : "Impossible de charger les données."
      );
    } finally {
      endPageDataLoad();
    }
  }, [userId, beginPageDataLoad, endPageDataLoad]);

  /** Cache sessionStorage (TTL) : affichage instantané si frais, sinon requête + overlay. */
  useEffect(() => {
    if (!userId) {
      setFamilies([]);
      setRecurring([]);
      setOneOff([]);
      setSites([]);
      setProfiles(new Map());
      setLoadError(null);
      return;
    }
    const cached = getSubscriptionsPageCache(userId);
    if (cached && isSubscriptionsCacheFresh(cached)) {
      setFamilies(cached.families);
      setRecurring(cached.recurring);
      setOneOff(cached.oneOff);
      setSites(cached.sites);
      setProfiles(new Map(Object.entries(cached.profilesRecord)));
      setLoadError(null);
      return;
    }
    void reload();
  }, [userId, reload]);

  const activeRecurring = useMemo(
    () => recurring.filter((r) => r.status === "active"),
    [recurring]
  );

  const activeCount = activeRecurring.length;

  const { monthlyShare, yearlyShare } = useMemo(() => {
    let m = 0;
    let y = 0;
    for (const sub of activeRecurring) {
      const n = sub.owner_ids.length || 1;
      const me = monthlyEquivalentEuros(sub.price_euros, sub.period_type);
      const ye = yearlyEquivalentEuros(sub.price_euros, sub.period_type);
      m += userShareEuros(me, n, userId, sub.owner_ids);
      y += userShareEuros(ye, n, userId, sub.owner_ids);
    }
    return { monthlyShare: m, yearlyShare: y };
  }, [activeRecurring, userId]);

  const oneOffTotal = useMemo(() => {
    let t = 0;
    for (const p of oneOff) {
      if (!purchaseInPeriod(p.purchase_date, oneOffFilter)) {
        continue;
      }
      const n = p.owner_ids.length || 1;
      t += userShareEuros(p.amount_euros, n, userId, p.owner_ids);
    }
    return t;
  }, [oneOff, oneOffFilter, userId]);

  /** Tri : date d’achat décroissante, puis création (les 10 « derniers » au sens métier). */
  const oneOffSorted = useMemo(() => {
    return [...oneOff].sort((a, b) => {
      const byDate = b.purchase_date.localeCompare(a.purchase_date);
      if (byDate !== 0) {
        return byDate;
      }
      return b.created_at.localeCompare(a.created_at);
    });
  }, [oneOff]);

  const oneOffArchivedCount = Math.max(0, oneOff.length - ONE_OFF_VISIBLE_LIMIT);

  const oneOffDisplayed = useMemo(() => {
    if (showAllOneOff) {
      return oneOffSorted;
    }
    return oneOffSorted.slice(0, ONE_OFF_VISIBLE_LIMIT);
  }, [oneOffSorted, showAllOneOff]);

  const recurringDisplayed = useMemo(() => {
    switch (recurringListFilter) {
      case "active":
        return recurring.filter((r) => r.status === "active");
      case "archived":
        return recurring.filter((r) => r.status === "cancelled");
      default:
        return recurring;
    }
  }, [recurring, recurringListFilter]);

  async function handleCancel(sub: RecurringSubscriptionRow) {
    if (
      !window.confirm(
        `Résilier « ${sub.name} » ? Le prochain prélèvement ne sera plus planifié.`
      )
    ) {
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    const supabase = getSupabaseClient();
    const r = await cancelRecurringSubscription(supabase, sub.id, today);
    if (!r.ok) {
      window.alert(r.error);
      return;
    }
    invalidateSubscriptionsPageCache(userId);
    void reload();
  }

  const filterLabels: { id: OneOffPeriodFilter; label: string }[] = [
    { id: "all", label: "Début" },
    { id: "month", label: "Mois" },
    { id: "year", label: "Année" },
  ];

  const recurringFilterOptions: { id: RecurringListFilter; label: string }[] = [
    { id: "active", label: "Actifs" },
    { id: "archived", label: "Résiliés" },
    { id: "all", label: "Tous" },
  ];

  return (
    <div className="subscriptions-page">
      <header className="subscriptions-header">
        <div>
          <h1 className="subscriptions-page-title">Abonnements</h1>
          <p className="subscriptions-page-lead">
            Abonnements récurrents et achats ponctuels partagés. Tu ne vois que
            les entrées dont tu es propriétaire (ta part est indiquée dans les
            totaux).
          </p>
        </div>
        <div className="subscriptions-header-actions">
          <button
            type="button"
            className="sub-btn-primary"
            onClick={() => {
              setEditRow(null);
              setModalRecurring("create");
            }}
          >
            Ajouter un abonnement
          </button>
          <button
            type="button"
            className="sub-btn-secondary"
            onClick={() => {
              setEditOneOffRow(null);
              setModalOneOff("create");
            }}
          >
            Achat ponctuel
          </button>
        </div>
      </header>

      {families.length === 0 ? (
        <p className="subscriptions-warn">
          Aucun foyer détecté : tu peux quand même créer des entrées
          personnelles (sans foyer).
        </p>
      ) : null}

      {loadError ? (
        <p className="subscriptions-error">{loadError}</p>
      ) : null}

      <section
        className="subscriptions-summary"
        aria-label="Synthèse des coûts"
      >
        <div className="subscriptions-summary-grid">
          <div className="subscriptions-summary-card">
            <h2 className="subscriptions-summary-card-title">
              Abonnements actifs
            </h2>
            <span className="subscriptions-summary-value">{activeCount}</span>
          </div>
          <div className="subscriptions-summary-card">
            <h2 className="subscriptions-summary-card-title">
              Coût mensuel (ta part)
            </h2>
            <span className="subscriptions-summary-value">
              {formatEuros(monthlyShare)}
            </span>
          </div>
          <div className="subscriptions-summary-card">
            <h2 className="subscriptions-summary-card-title">
              Coût annuel (ta part)
            </h2>
            <span className="subscriptions-summary-value">
              {formatEuros(yearlyShare)}
            </span>
          </div>
          <div className="subscriptions-summary-card subscriptions-summary-card-oneoff">
            <h2 className="subscriptions-summary-card-title">
              Total achats ponctuels (ta part)
            </h2>
            <div
              className="subscriptions-segment"
              role="group"
              aria-label="Période pour le total des achats ponctuels"
            >
              {filterLabels.map((x) => (
                <button
                  key={x.id}
                  type="button"
                  className={
                    oneOffFilter === x.id
                      ? "subscriptions-segment-btn subscriptions-segment-btn-active"
                      : "subscriptions-segment-btn"
                  }
                  onClick={() => setOneOffFilter(x.id)}
                >
                  {x.label}
                </button>
              ))}
            </div>
            <span className="subscriptions-summary-value">
              {formatEuros(oneOffTotal)}
            </span>
          </div>
        </div>
        <p className="subscriptions-summary-hint">
          Mensuel / annuel : équivalent selon la période facturée (hebdo →
          ×52/12, mensuel tel quel, annuel ÷12). « Autre » : le prix saisi est
          traité comme un montant mensuel pour l’estimation, sauf précision dans
          les notes.
        </p>
      </section>

      <section className="subscriptions-section" aria-labelledby="rec-title">
        <h2 id="rec-title" className="subscriptions-section-title">
          Abonnements récurrents
        </h2>
        {recurring.length > 0 ? (
          <div
            className="subscriptions-recurring-toolbar"
            role="group"
            aria-label="Filtrer l’affichage des abonnements récurrents"
          >
            <div className="subscriptions-segment">
              {recurringFilterOptions.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  className={
                    recurringListFilter === opt.id
                      ? "subscriptions-segment-btn subscriptions-segment-btn-active"
                      : "subscriptions-segment-btn"
                  }
                  onClick={() => setRecurringListFilter(opt.id)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {recurring.length === 0 ? (
          <p className="subscriptions-empty">Aucun abonnement enregistré.</p>
        ) : recurringDisplayed.length === 0 ? (
          <p className="subscriptions-empty">
            {recurringListFilter === "active"
              ? "Aucun abonnement actif. Utilise le filtre « Résiliés » ou « Tous » pour voir les abonnements terminés."
              : recurringListFilter === "archived"
                ? "Aucun abonnement résilié."
                : "Aucun abonnement à afficher."}
          </p>
        ) : (
          <ul className="subscriptions-list">
            {recurringDisplayed.map((sub) => {
              const n = sub.owner_ids.length || 1;
              const globalMonthlyEq = monthlyEquivalentEuros(
                sub.price_euros,
                sub.period_type
              );
              const shareMonthly = userShareEuros(
                globalMonthlyEq,
                n,
                userId,
                sub.owner_ids
              );
              const nextPayment =
                sub.status === "active"
                  ? sub.next_payment_date ?? sub.start_date
                  : null;
              return (
                <li
                  key={sub.id}
                  className="subscriptions-item-row"
                  title={notesAsTooltip(sub.notes)}
                >
                  <div className="subscriptions-item-main">
                    <div className="subscriptions-rec-title-line">
                      <h3 className="subscriptions-rec-name">{sub.name}</h3>
                      <span
                        className={
                          sub.status === "active"
                            ? "subscriptions-badge subscriptions-badge-active"
                            : "subscriptions-badge subscriptions-badge-cancelled"
                        }
                      >
                        {sub.status === "active" ? "Actif" : "Résilié"}
                      </span>
                    </div>
                    <p className="subscriptions-item-field">
                      <span className="subscriptions-item-field-label">
                        Coût global :
                      </span>{" "}
                      <span className="subscriptions-item-field-value">
                        {formatEuros(sub.price_euros)} /{" "}
                        {periodLabelLower(sub.period_type)}{" "}
                        <span className="subscriptions-item-field-muted">
                          ({formatEuros(globalMonthlyEq)} €/mois)
                        </span>
                      </span>
                    </p>
                    <p className="subscriptions-item-field">
                      <span className="subscriptions-item-field-label">
                        Mon coût :
                      </span>{" "}
                      <span className="subscriptions-item-field-value">
                        {formatEuros(shareMonthly)} / mois
                      </span>
                    </p>
                    <p className="subscriptions-rec-dates">
                      Début : {formatDateFr(sub.start_date)}
                    </p>
                    {sub.status === "active" ? (
                      <p className="subscriptions-rec-dates">
                        Date du prochain prélèvement :{" "}
                        {nextPayment ? formatDateFr(nextPayment) : "—"}
                      </p>
                    ) : null}
                    {sub.status === "cancelled" ? (
                      <p className="subscriptions-rec-dates">
                        Date de fin :{" "}
                        {formatDateFr(sub.end_date ?? sub.last_payment_date)}
                      </p>
                    ) : null}
                    <div className="subscriptions-rec-owners">
                      {sub.owner_ids.map((oid) => {
                        const pr = profiles.get(oid);
                        return (
                          <span
                            key={oid}
                            className="subscriptions-rec-avatar"
                            title={pr?.display_name ?? oid}
                          >
                            <ProfileAvatarImage
                              storagePath={pr?.avatar_storage_path ?? null}
                              displayName={pr?.display_name ?? oid}
                              size={32}
                            />
                          </span>
                        );
                      })}
                    </div>
                  </div>
                  <div className="subscriptions-item-aside">
                    <div className="subscriptions-rec-actions">
                      <button
                        type="button"
                        className="subscriptions-icon-btn"
                        title="Modifier"
                        aria-label="Modifier"
                        onClick={() => {
                          setEditRow(sub);
                          setModalRecurring("edit");
                        }}
                      >
                        <Pencil size={18} />
                      </button>
                      {sub.status === "active" ? (
                        <button
                          type="button"
                          className="subscriptions-icon-btn subscriptions-icon-btn-danger"
                          title="Résilier"
                          aria-label="Résilier"
                          onClick={() => void handleCancel(sub)}
                        >
                          <Ban size={18} />
                        </button>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="subscriptions-section" aria-labelledby="one-title">
        <h2 id="one-title" className="subscriptions-section-title">
          Achats ponctuels
        </h2>
        {oneOff.length === 0 ? (
          <p className="subscriptions-empty">Aucun achat enregistré.</p>
        ) : (
          <>
            {oneOffArchivedCount > 0 ? (
              <p className="subscriptions-oneoff-archive-banner">
                {showAllOneOff ? (
                  <>
                    Tous les achats sont affichés (y compris archivés).{" "}
                    <button
                      type="button"
                      className="subscriptions-archive-toggle"
                      onClick={() => setShowAllOneOff(false)}
                    >
                      Afficher seulement les {ONE_OFF_VISIBLE_LIMIT} derniers
                    </button>
                  </>
                ) : (
                  <>
                    Seuls les {ONE_OFF_VISIBLE_LIMIT} derniers paiements sont
                    listés ;{" "}
                    {oneOffArchivedCount === 1
                      ? "1 achat plus ancien est archivé (masqué)."
                      : `${oneOffArchivedCount} achats plus anciens sont archivés (masqués).`}{" "}
                    <button
                      type="button"
                      className="subscriptions-archive-toggle"
                      onClick={() => setShowAllOneOff(true)}
                    >
                      Afficher aussi les achats archivés
                    </button>
                  </>
                )}
              </p>
            ) : null}
            <ul className="subscriptions-list">
              {oneOffDisplayed.map((p) => {
              const n = p.owner_ids.length || 1;
              const shareTotal = userShareEuros(
                p.amount_euros,
                n,
                userId,
                p.owner_ids
              );
              return (
                <li
                  key={p.id}
                  className="subscriptions-item-row"
                  title={notesAsTooltip(p.notes)}
                >
                  <div className="subscriptions-item-main">
                    <div className="subscriptions-rec-title-line">
                      <h3 className="subscriptions-rec-name">{p.site_name}</h3>
                    </div>
                    <p className="subscriptions-item-field">
                      <span className="subscriptions-item-field-label">
                        Coût global :
                      </span>{" "}
                      <span className="subscriptions-item-field-value">
                        {formatEuros(p.amount_euros)}
                      </span>
                    </p>
                    <p className="subscriptions-item-field">
                      <span className="subscriptions-item-field-label">
                        Mon coût :
                      </span>{" "}
                      <span className="subscriptions-item-field-value">
                        {formatEuros(shareTotal)}
                      </span>
                    </p>
                    <p className="subscriptions-item-field">
                      <span className="subscriptions-item-field-label">
                        Crédits reçus :
                      </span>{" "}
                      <span className="subscriptions-item-field-value">
                        {formatCreditsPurchased(p.credits_received)}
                      </span>
                    </p>
                    <p className="subscriptions-rec-dates">
                      Date d’achat : {formatDateFr(p.purchase_date)}
                    </p>
                    <div className="subscriptions-rec-owners">
                      {p.owner_ids.map((oid) => {
                        const pr = profiles.get(oid);
                        return (
                          <span
                            key={oid}
                            className="subscriptions-rec-avatar"
                            title={pr?.display_name ?? oid}
                          >
                            <ProfileAvatarImage
                              storagePath={pr?.avatar_storage_path ?? null}
                              displayName={pr?.display_name ?? oid}
                              size={32}
                            />
                          </span>
                        );
                      })}
                    </div>
                  </div>
                  <div className="subscriptions-item-aside">
                    <div className="subscriptions-rec-actions">
                      <button
                        type="button"
                        className="subscriptions-icon-btn"
                        title="Modifier l’achat"
                        aria-label="Modifier l’achat"
                        onClick={() => {
                          setEditOneOffRow(p);
                          setModalOneOff("edit");
                        }}
                      >
                        <Pencil size={16} />
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
            </ul>
          </>
        )}
      </section>

      <RecurringSubscriptionModal
        open={modalRecurring !== null}
        mode={modalRecurring === "edit" ? "edit" : "create"}
        families={families}
        initial={editRow}
        onClose={() => {
          setModalRecurring(null);
          setEditRow(null);
        }}
        onSaved={() => {
          invalidateSubscriptionsPageCache(userId);
          void reload();
        }}
      />

      <OneOffPurchaseModal
        open={modalOneOff !== null}
        mode={modalOneOff === "edit" ? "edit" : "create"}
        initial={editOneOffRow}
        families={families}
        existingSites={sites}
        onClose={() => {
          setModalOneOff(null);
          setEditOneOffRow(null);
        }}
        onSaved={() => {
          invalidateSubscriptionsPageCache(userId);
          void reload();
        }}
      />
    </div>
  );
}
