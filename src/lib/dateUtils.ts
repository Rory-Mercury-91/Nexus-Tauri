/**
 * Utilitaires pour formater les dates en français
 */

const MOIS_FR = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"
];

/**
 * Formate une date ISO au format "25 Avril 2005"
 */
export function formatDateFr(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return "—";
    
    const jour = date.getDate();
    const mois = MOIS_FR[date.getMonth()];
    const annee = date.getFullYear();
    
    return `${jour} ${mois} ${annee}`;
  } catch {
    return "—";
  }
}

/**
 * Formate une période de dates au format "25 Avril 2005 au 28 Août 2013"
 */
export function formatPeriodeFr(
  dateDebut: string | null | undefined,
  dateFin: string | null | undefined
): string {
  const debut = formatDateFr(dateDebut);
  const fin = formatDateFr(dateFin);
  
  if (debut === "—" && fin === "—") return "—";
  if (debut === "—") return `jusqu'au ${fin}`;
  if (fin === "—") return `depuis le ${debut}`;
  
  return `${debut} au ${fin}`;
}

/**
 * Extrait l'année d'une date
 */
export function extractYear(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return null;
    return date.getFullYear();
  } catch {
    return null;
  }
}
