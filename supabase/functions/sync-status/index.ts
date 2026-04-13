import {
  corsHeaders,
  jsonResponse,
  requireUserId,
} from "../_shared/integration-helpers.ts";
import { createServiceSupabaseClient } from "../_shared/sync-helpers.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Méthode non autorisée." }, 405);
  }

  try {
    const userId = await requireUserId(req);
    const body = (await req.json().catch(() => ({}))) as { media_type?: "anime" | "reading" };
    const mediaType = body.media_type === "reading" ? "reading" : "anime";
    const admin = createServiceSupabaseClient();

    const { data: activeRun, error: activeErr } = await admin
      .from("sync_runs")
      .select(
        "id, source, media_type, status, current_stage, created_at, started_at, finished_at, error_message, import_report"
      )
      .eq("user_id", userId)
      .eq("media_type", mediaType)
      .in("status", ["queued", "running"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (activeErr) {
      return jsonResponse({ error: `Erreur run actif: ${activeErr.message}` }, 500);
    }

    const runId = activeRun?.id ?? null;
    let progress: unknown[] = [];
    if (runId) {
      const { data: rows, error: progressErr } = await admin
        .from("sync_progress")
        .select(
          "stage, total, processed, created_count, updated_count, error_count, current_item_label, rate_per_min, eta_seconds, updated_at"
        )
        .eq("run_id", runId)
        .order("updated_at", { ascending: true });
      if (progressErr) {
        return jsonResponse({ error: `Erreur progression: ${progressErr.message}` }, 500);
      }
      progress = rows ?? [];
    }

    const { data: recentRuns, error: recentErr } = await admin
      .from("sync_runs")
      .select(
        "id, source, media_type, status, current_stage, created_at, started_at, finished_at, error_message, import_report"
      )
      .eq("user_id", userId)
      .eq("media_type", mediaType)
      .order("created_at", { ascending: false })
      .limit(10);
    if (recentErr) {
      return jsonResponse({ error: `Erreur historique runs: ${recentErr.message}` }, 500);
    }

    return jsonResponse(
      {
        ok: true,
        active_run: activeRun ?? null,
        active_progress: progress,
        recent_runs: recentRuns ?? [],
      },
      200
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur inconnue";
    return jsonResponse({ error: message }, 500);
  }
});
