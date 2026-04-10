const PROXY_PORT = 40000;
const PROXY_BASE_URL = `http://127.0.0.1:${PROXY_PORT}`;

/**
 * Transforme une URL Nautiljon en URL proxy locale pour contourner le hotlink blocking.
 * Les images sont téléchargées par le serveur Tauri avec le bon referer et mises en cache 30 jours.
 */
export function proxyNautiljonImage(url: string | null | undefined): string {
  // Vérifier explicitement null/undefined avant toute opération
  if (url === null || url === undefined) {
    return "";
  }
  
  const raw = String(url).trim();
  if (!raw) {
    return "";
  }

  // Si ce n'est pas une URL Nautiljon, retourner telle quelle
  if (!raw.includes("nautiljon.com")) {
    return raw;
  }

  // Encoder l'URL pour la passer en paramètre
  const encoded = encodeURIComponent(raw);
  return `${PROXY_BASE_URL}/api/proxy-image?url=${encoded}`;
}

/**
 * Transforme une liste d'URLs Nautiljon en URLs proxy.
 */
export function proxyNautiljonImages(urls: Array<string | null | undefined>): string[] {
  return urls.map(proxyNautiljonImage).filter(Boolean);
}
