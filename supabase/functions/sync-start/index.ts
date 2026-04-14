import {
  corsHeaders,
  createUserSupabaseClient,
  jsonResponse,
  requireUserId,
} from "../_shared/integration-helpers.ts";
import { createServiceSupabaseClient, nowIso, type SyncSource } from "../_shared/sync-helpers.ts";

type Body = {
  source?: SyncSource;
  media_type?: "anime" | "reading";
  selected_field_ids?: string[];
  target_mal_id?: number;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Méthode non autorisée." }, 405);
  }

  try {
    const userId = await requireUserId(req);
    const body = (await req.json().catch(() => ({}))) as Body;
    const source = body.source;
    const mediaType = body.media_type ?? "anime";
    const selectedFieldIds = Array.isArray(body.selected_field_ids)
      ? body.selected_field_ids
          .filter((value) => typeof value === "string")
          .map((value) => value.trim())
          .filter((value) => value.length > 0)
      : [];
    const rawTarget = body.target_mal_id;
    const targetMalId =
      typeof rawTarget === "number" && Number.isFinite(rawTarget) && rawTarget > 0
        ? Math.floor(rawTarget)
        : typeof rawTarget === "string" && rawTarget.trim() !== ""
        ? Math.floor(Number(rawTarget))
        : NaN;
    const targetMalIdSafe = Number.isFinite(targetMalId) && targetMalId > 0 ? targetMalId : null;
    if (
      (source !== "mal" && source !== "anilist") ||
      (mediaType !== "anime" && mediaType !== "reading")
    ) {
      return jsonResponse({ error: "Paramètres invalides." }, 400);
    }

    const userSupabase = createUserSupabaseClient(req);
    const { data: conn, error: connError } = await userSupabase
      .from("oauth_connections")
      .select("id, access_token")
      .eq("user_id", userId)
      .eq("provider", source)
      .maybeSingle();
    if (connError) {
      return jsonResponse({ error: `Erreur vérification OAuth: ${connError.message}` }, 500);
    }
    if (!conn?.access_token) {
      return jsonResponse(
        { error: `Aucun compte ${source.toUpperCase()} connecté.` },
        400
      );
    }

    const admin = createServiceSupabaseClient();
    const { data: existing, error: existingErr } = await admin
      .from("sync_runs")
      .select("id, status, source, media_type, created_at, started_at")
      .eq("user_id", userId)
      .eq("media_type", mediaType)
      .in("status", ["queued", "running"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existingErr) {
      return jsonResponse({ error: `Erreur lecture run actif: ${existingErr.message}` }, 500);
    }
    if (existing) {
      const { count: activeJobsCount } = await admin
        .from("sync_jobs")
        .select("*", { head: true, count: "exact" })
        .eq("run_id", existing.id)
        .in("status", ["queued", "running", "retry"]);
      if ((activeJobsCount ?? 0) > 0) {
        return jsonResponse({ ok: true, reused: true, run_id: existing.id }, 200);
      }
      await admin
        .from("sync_runs")
        .update({
          status: "failed",
          finished_at: nowIso(),
          error_message: "Run bloqué sans jobs actifs (auto-reset).",
        })
        .eq("id", existing.id);
    }

    const { data: run, error: runErr } = await admin
      .from("sync_runs")
      .insert({
        user_id: userId,
        source,
        media_type: mediaType,
        status: "queued",
        current_stage: "import",
      })
      .select("id")
      .single();
    if (runErr || !run) {
      return jsonResponse({ error: `Erreur création run: ${runErr?.message ?? "unknown"}` }, 500);
    }

    const startedAt = nowIso();
    const importPayload: Record<string, unknown> = {
      source,
      media_type: mediaType,
      selected_field_ids: selectedFieldIds,
    };
    if (targetMalIdSafe != null) {
      importPayload.target_mal_id = targetMalIdSafe;
    }
    /**
     * Pour MAL sans cible précise : premier job = prefetch (comptage uniquement).
     * Le prefetch va créer tous les jobs d'import avec le total exact en payload,
     * ce qui garantit X/Y toujours correct dès le début du traitement.
     * AniList n'en a pas besoin (charge toute la liste en mémoire dès le premier job).
     */
    if (source === "mal" && targetMalIdSafe == null) {
      importPayload.is_prefetch = true;
    }
    const { error: queueErr } = await admin.from("sync_jobs").insert({
      run_id: run.id,
      user_id: userId,
      stage: "import",
      status: "queued",
      attempts: 0,
      available_at: startedAt,
      payload: importPayload,
      created_at: startedAt,
      updated_at: startedAt,
    });
    if (queueErr) {
      await admin
        .from("sync_runs")
        .update({
          status: "failed",
          finished_at: nowIso(),
          error_message: queueErr.message,
        })
        .eq("id", run.id);
      return jsonResponse({ error: `Erreur création job: ${queueErr.message}` }, 500);
    }

    return jsonResponse({ ok: true, reused: false, run_id: run.id }, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur inconnue";
    return jsonResponse({ error: message }, 500);
  }
});
