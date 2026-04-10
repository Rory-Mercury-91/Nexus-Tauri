/**
 * Client HTTP minimal pour l’API Jikan v4 (données publiques MyAnimeList).
 * @see https://docs.api.jikan.moe/
 */

const JIKAN_BASE = "https://api.jikan.moe/v4";

export type JikanErrorPayload = {
  status?: number;
  type?: string;
  messages?: string[];
  message?: string;
  error?: string;
};

function extractErrorMessage(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "Réponse Jikan invalide.";
  }
  const p = payload as JikanErrorPayload;
  if (Array.isArray(p.messages) && p.messages.length > 0) {
    return p.messages.join(" ");
  }
  if (typeof p.message === "string" && p.message.trim()) {
    return p.message;
  }
  if (typeof p.error === "string" && p.error.trim()) {
    return p.error;
  }
  return `Erreur Jikan (${p.status ?? "?"}).`;
}

export type JikanGetOk<T> = { ok: true; data: T };
export type JikanGetFail = {
  ok: false;
  status: number;
  message: string;
  raw?: unknown;
};

/**
 * GET sur l’API Jikan ; renvoie le JSON typé ou une erreur métier.
 */
export async function jikanGet<T>(path: string): Promise<JikanGetOk<T> | JikanGetFail> {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const res = await fetch(`${JIKAN_BASE}${normalized}`);
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      message: extractErrorMessage(body),
      raw: body,
    };
  }
  return { ok: true, data: body as T };
}

/** Pause pour limiter le débit (recommandations Jikan : éviter le spam). */
export function jikanDelay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
