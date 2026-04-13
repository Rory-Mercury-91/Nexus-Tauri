import {
  corsHeaders,
  jsonResponse,
  requireUserId,
} from "../_shared/integration-helpers.ts";
import { createServiceSupabaseClient, nowIso } from "../_shared/sync-helpers.ts";

type Body = {
  reading_id?: string;
  force?: boolean;
  limit?: number;
};

type ReadingRow = {
  id: string;
  mal_official_snapshot: Record<string, unknown> | null;
};

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function toStringValue(value: unknown): string {
  return String(value ?? "").trim();
}

function parseIsoMs(value: unknown): number | null {
  const raw = toStringValue(value);
  if (!raw) {
    return null;
  }
  const ms = new Date(raw).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function shouldCheckWeekly(lastCheckedAt: unknown, force: boolean): boolean {
  if (force) {
    return true;
  }
  const lastMs = parseIsoMs(lastCheckedAt);
  if (lastMs === null) {
    return true;
  }
  return Date.now() - lastMs >= WEEK_MS;
}

async function sha256Hex(input: string): Promise<string> {
  const payload = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", payload);
  const bytes = Array.from(new Uint8Array(digest));
  return bytes.map((entry) => entry.toString(16).padStart(2, "0")).join("");
}

function normalizeHtmlForHash(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchNautiljonPage(url: string): Promise<string> {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "User-Agent": "Nexus-Tauri/1.0 (Nautiljon refresh checker)",
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
    },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} sur ${url}`);
  }
  return await response.text();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Methode non autorisee." }, 405);
  }
  try {
    const userId = await requireUserId(req);
    const body = (await req.json().catch(() => ({}))) as Body;
    const force = Boolean(body.force);
    const limit = Math.max(1, Math.min(200, Number(body.limit ?? 50)));
    const readingId = toStringValue(body.reading_id);
    const admin = createServiceSupabaseClient();

    let query = admin
      .from("library_reading")
      .select("id, mal_official_snapshot")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(limit);

    if (readingId) {
      query = query.eq("id", readingId);
    }

    const { data, error } = await query;
    if (error) {
      return jsonResponse({ error: error.message }, 500);
    }

    const rows = (data ?? []) as ReadingRow[];
    let checked = 0;
    let changed = 0;
    let flagged = 0;
    const errors: Array<{ id: string; error: string }> = [];

    for (const row of rows) {
      const baseSnapshot = toRecord(row.mal_official_snapshot);
      const manualOverrides = toRecord(baseSnapshot.manual_overrides);
      const links = toRecord(manualOverrides.links);
      const nautiljonUrl = toStringValue(links.nautiljon);
      if (!nautiljonUrl) {
        continue;
      }
      if (!shouldCheckWeekly(manualOverrides.nautiljon_last_checked_at, force)) {
        continue;
      }

      checked += 1;
      try {
        const html = await fetchNautiljonPage(nautiljonUrl);
        const hash = await sha256Hex(normalizeHtmlForHash(html));
        const previousHash = toStringValue(manualOverrides.nautiljon_last_hash);
        const isChanged = previousHash.length > 0 && previousHash !== hash;
        if (isChanged) {
          changed += 1;
        }

        const nextManualOverrides = {
          ...manualOverrides,
          nautiljon_last_checked_at: nowIso(),
          nautiljon_last_hash: hash,
          nautiljon_last_change_at: isChanged
            ? nowIso()
            : manualOverrides.nautiljon_last_change_at ?? null,
          nautiljon_needs_manual_import: isChanged,
        };
        if (isChanged) {
          flagged += 1;
        }
        const nextSnapshot = {
          ...baseSnapshot,
          manual_overrides: nextManualOverrides,
        };
        const { error: updateError } = await admin
          .from("library_reading")
          .update({
            mal_official_snapshot: nextSnapshot,
            updated_at: nowIso(),
          })
          .eq("id", row.id)
          .eq("user_id", userId);
        if (updateError) {
          errors.push({ id: row.id, error: updateError.message });
        }
      } catch (error) {
        errors.push({
          id: row.id,
          error: error instanceof Error ? error.message : "Erreur Nautiljon inconnue.",
        });
      }
    }

    return jsonResponse(
      {
        ok: true,
        checked,
        changed,
        flagged,
        errors,
      },
      200,
    );
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Erreur inconnue." },
      500,
    );
  }
});

