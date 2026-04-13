import {
  corsHeaders,
  jsonResponse,
  requireUserId,
} from "../_shared/integration-helpers.ts";
import { createServiceSupabaseClient, nowIso } from "../_shared/sync-helpers.ts";

type Body = {
  media_type?: "anime" | "reading";
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
    const mediaType = body.media_type === "reading" ? "reading" : "anime";
    const admin = createServiceSupabaseClient();

    const { data: run, error: runErr } = await admin
      .from("sync_runs")
      .select("id, status")
      .eq("user_id", userId)
      .eq("media_type", mediaType)
      .in("status", ["queued", "running"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (runErr) {
      return jsonResponse({ error: `Erreur lecture run: ${runErr.message}` }, 500);
    }
    if (!run?.id) {
      return jsonResponse({ ok: true, cancelled: false, message: "Aucune synchronisation active." }, 200);
    }

    const finishedAt = nowIso();
    const { error: updRunErr } = await admin
      .from("sync_runs")
      .update({
        status: "cancelled",
        finished_at: finishedAt,
        error_message: "Annulé par l'utilisateur.",
      })
      .eq("id", run.id)
      .eq("user_id", userId)
      .in("status", ["queued", "running"]);

    if (updRunErr) {
      return jsonResponse({ error: `Erreur annulation run: ${updRunErr.message}` }, 500);
    }

    const { error: updJobsErr } = await admin
      .from("sync_jobs")
      .update({
        status: "cancelled",
        finished_at: finishedAt,
        last_error: "Annulé par l'utilisateur.",
        updated_at: finishedAt,
      })
      .eq("run_id", run.id)
      .in("status", ["queued", "retry"]);

    if (updJobsErr) {
      return jsonResponse({ error: `Erreur annulation jobs: ${updJobsErr.message}` }, 500);
    }

    return jsonResponse({ ok: true, cancelled: true, run_id: run.id }, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur inconnue";
    return jsonResponse({ error: message }, 500);
  }
});
