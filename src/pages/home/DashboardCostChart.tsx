import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  DashboardCategory,
} from "@/services/dashboard/homeDashboardService";

const CATEGORY_OPTIONS: { id: DashboardCategory; label: string }[] = [
  { id: "reading", label: "Lectures" },
  { id: "subscriptions", label: "Abonnements" },
  { id: "one_off", label: "Achats ponctuels" },
];

type DashboardCostChartProps = {
  data: { monthLabel: string; value: number }[];
  category: DashboardCategory;
  onCategoryChange: (c: DashboardCategory) => void;
  year: number;
  yearOptions: number[];
  onYearChange: (y: number) => void;
  embedded?: boolean;
};

/**
 * Histogramme des montants par mois (part de l’utilisateur connecté), filtre catégorie + année.
 */
export function DashboardCostChart({
  data,
  category,
  onCategoryChange,
  year,
  yearOptions,
  onYearChange,
  embedded = false,
}: DashboardCostChartProps) {
  const years = useMemo(() => {
    const set = new Set(yearOptions);
    set.add(year);
    return [...set].sort((a, b) => b - a);
  }, [yearOptions, year]);

  return (
    <section className="home-chart-section" aria-labelledby="home-chart-title">
      <div className="home-chart-head">
        {embedded ? null : (
          <h2 id="home-chart-title" className="home-chart-title">
            Répartition mensuelle (ta part)
          </h2>
        )}
        <div className="home-chart-toolbar">
          <label className="home-chart-toolbar-label">
            <span className="visually-hidden">Catégorie</span>
            <select
              className="home-chart-select"
              value={category}
              onChange={(e) =>
                onCategoryChange(e.target.value as DashboardCategory)
              }
            >
              {CATEGORY_OPTIONS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="home-chart-toolbar-label">
            <span className="visually-hidden">Année</span>
            <select
              className="home-chart-select"
              value={year}
              onChange={(e) => onYearChange(Number(e.target.value))}
            >
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      <div className="home-chart-wrap">
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis
              dataKey="monthLabel"
              tick={{ fill: "var(--text-secondary)", fontSize: 11 }}
            />
            <YAxis
              tick={{ fill: "var(--text-secondary)", fontSize: 11 }}
              tickFormatter={(v) => `${v} €`}
            />
            <Tooltip
              formatter={(value) => [
                `${Number(value ?? 0).toFixed(2)} €`,
                "Montant",
              ]}
              labelFormatter={(label) => `Mois : ${label}`}
              contentStyle={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-sm)",
                color: "var(--text)",
              }}
            />
            <Bar
              dataKey="value"
              name="Montant"
              fill="var(--primary-light)"
              radius={[4, 4, 0, 0]}
              maxBarSize={48}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
