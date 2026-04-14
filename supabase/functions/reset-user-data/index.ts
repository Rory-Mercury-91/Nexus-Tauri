/**
 * reset-user-data — purge les données de l'utilisateur connecté.
 *
 * Corps JSON attendu :
 * {
 *   scope: "anime" | "reading" | "sync" | "all"
 *   confirm: true   // champ obligatoire pour éviter les appels accidentels
 * }
 *
 * Scopes :
 * - "anime"   → library_anime
 * - "reading" → family_manga_volume_owner, reading_mihon_presence, library_reading
 *               (user_manga_volume_state est supprimé par CASCADE depuis library_reading)
 * - "sync"    → sync_runs, sync_progress, sync_jobs
 * - "all"     → tous les scopes ci-dessus
 */
import {
  corsHeaders,
  jsonResponse,
  requireUserId,
} from "../_shared/integration-helpers.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

type ResetScope = "anime" | "reading" | "sync" | "all";

type Body = {
  scope?: unknown;
  confirm?: unknown;
};

const VALID_SCOPES: ResetScope[] = ["anime", "reading", "sync", "all"];

/** Supprime via le client service-role pour contourner les RLS. */
async function deleteUserRows(
  serviceClient: ReturnType<typeof createClient>,
  userId: string,
  scope: ResetScope
): Promise<Record<string, number>> {
  const deleted: Record<string, number> = {};

  async function purge(table: string, column = "user_id") {
    const { count, error } = await serviceClient
      .from(table)
      .delete({ count: "exact" })
      .eq(column, userId);
    if (error) throw new Error(`Erreur suppression ${table} : ${error.message}`);
    deleted[table] = count ?? 0;
  }

  if (scope === "anime" || scope === "all") {
    await purge("library_anime");
  }

  if (scope === "reading" || scope === "all") {
    // Supprimer d'abord les tables dépendantes avant library_reading
    await purge("family_manga_volume_owner");
    await purge("reading_mihon_presence");
    // library_reading supprime user_manga_volume_state par CASCADE
    await purge("library_reading");
  }

  if (scope === "sync" || scope === "all") {
    // sync_progress et sync_jobs sont liés à sync_runs via run_id,
    // mais contiennent aussi user_id directement pour les RLS.
    await purge("sync_progress");
    await purge("sync_jobs");
    await purge("sync_runs");
  }

  return deleted;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Méthode non autorisée." }, 405);
  }

  try {
    const userId = await requireUserId(req);

    let body: Body;
    try {
      body = (await req.json()) as Body;
    } catch {
      return jsonResponse({ error: "Corps JSON invalide." }, 400);
    }

    // Sécurité : confirmation explicite obligatoire
    if (body.confirm !== true) {
      return jsonResponse({ error: "Champ confirm: true requis." }, 400);
    }

    const scope = body.scope;
    if (!scope || !VALID_SCOPES.includes(scope as ResetScope)) {
      return jsonResponse(
        { error: `scope invalide — valeurs acceptées : ${VALID_SCOPES.join(", ")}.` },
        400
      );
    }

    // Client service-role pour bypasser les RLS (suppression sécurisée côté serveur).
    // L'authentification est déjà validée par requireUserId ci-dessus.
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    const deleted = await deleteUserRows(serviceClient, userId, scope as ResetScope);

    return jsonResponse({ ok: true, scope, deleted });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur inconnue.";
    return jsonResponse({ error: message }, 500);
  }
});
