import { BookOpen, Bus } from "lucide-react";
import { ProfileAvatarImage } from "@/components/common/ProfileAvatarImage";
import type { DashboardOwnerCard } from "@/services/dashboard/homeDashboardService";

type DashboardOwnerCardsProps = {
  cards: DashboardOwnerCard[];
  total: {
    mainEuros: number;
    readingCount: number;
    subscriptionMonthlyEuros: number;
  };
  formatEuros: (n: number) => string;
};

/**
 * Rangée de cartes par membre (coût principal, lectures, abonnements / mois) + carte Total.
 */
export function DashboardOwnerCards({
  cards,
  total,
  formatEuros,
}: DashboardOwnerCardsProps) {
  return (
    <div className="home-owner-cards" aria-label="Coûts par personne">
      {cards.map((c) => (
        <article key={c.userId} className="home-owner-card">
          <header className="home-owner-card-head">
            <span className="home-owner-card-avatar-wrap" aria-hidden>
              <ProfileAvatarImage
                storagePath={c.avatarStoragePath}
                displayName={c.displayName}
                size={28}
              />
            </span>
            <span className="home-owner-card-name">{c.displayName}</span>
          </header>
          <p className="home-owner-card-main">{formatEuros(c.mainEuros)}</p>
          <ul className="home-owner-card-meta">
            <li>
              <BookOpen size={14} aria-hidden />
              <span>
                {c.readingCount} lecture{c.readingCount > 1 ? "s" : ""}
              </span>
            </li>
            <li>
              <Bus size={14} aria-hidden />
              <span>
                {formatEuros(c.subscriptionMonthlyEuros)}/mois (abonnements)
              </span>
            </li>
          </ul>
        </article>
      ))}
      <article className="home-owner-card home-owner-card-total">
        <header className="home-owner-card-head">
          <span className="home-owner-card-name home-owner-card-name-total">
            Total
          </span>
        </header>
        <p className="home-owner-card-main">{formatEuros(total.mainEuros)}</p>
        <ul className="home-owner-card-meta">
          <li>
            <BookOpen size={14} aria-hidden />
            <span>{total.readingCount} lectures</span>
          </li>
          <li>
            <Bus size={14} aria-hidden />
            <span>
              {formatEuros(total.subscriptionMonthlyEuros)}/mois (abonnements)
            </span>
          </li>
        </ul>
      </article>
    </div>
  );
}
