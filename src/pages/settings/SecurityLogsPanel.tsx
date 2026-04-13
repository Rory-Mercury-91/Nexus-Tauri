import { useCallback, useEffect, useState } from "react";
import {
  readSecurityLogsCache,
  SECURITY_LOGS_CACHE_TTL_MS,
  writeSecurityLogsCache,
} from "@/lib/settingsPanelsCache";
import { getSupabaseClient } from "@/lib/supabaseClient";
import { useSession } from "@/hooks/useSession";
import {
  clearClientLogs,
  listClientLogs,
  type ClientLogEntry,
} from "@/services/observability/clientLogService";
import {
  getAnimeSyncStatus,
  getReadingSyncStatus,
  type SyncRun,
} from "@/services/library/syncService";

type SecurityLogItem = {
  id: string;
  at: string;
  level: "error" | "warn" | "info";
  source: "client" | "supabase-sync";
  scope: string;
  message: string;
};

function mapFailedSyncRuns(runs: SyncRun[], media: "anime" | "reading"): SecurityLogItem[] {
  return runs
    .filter((run) => run.status === "failed")
    .map((run) => ({
      id: `sync-${media}-${run.id}`,
      at: run.finished_at ?? run.started_at ?? run.created_at,
      level: "error" as const,
      source: "supabase-sync" as const,
      scope: `sync.${media}.${run.source}`,
      message: run.error_message?.trim() || "Synchronisation en échec (détail indisponible).",
    }));
}

function mapClientLogs(logs: ClientLogEntry[]): SecurityLogItem[] {
  return logs.map((log) => ({
    id: `client-${log.id}`,
    at: log.at,
    level: log.level,
    source: "client",
    scope: log.scope,
    message: log.details ? `${log.message} — ${log.details}` : log.message,
  }));
}

/**
 * Journal local des erreurs client + derniers échecs de synchronisation Supabase.
 */
export function SecurityLogsPanel() {
  const { session } = useSession();
  const userId = session?.user.id ?? "";
  const [items, setItems] = useState<SecurityLogItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scopeFilter, setScopeFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState<"all" | "client" | "supabase-sync">(
    "all"
  );
  const [levelFilter, setLevelFilter] = useState<"all" | "error" | "warn" | "info">(
    "all"
  );
  const [query, setQuery] = useState("");

  const reload = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const supabase = getSupabaseClient();
      const [anime, reading] = await Promise.all([
        getAnimeSyncStatus(supabase),
        getReadingSyncStatus(supabase),
      ]);
      const merged = [
        ...mapFailedSyncRuns(anime.recent_runs ?? [], "anime"),
        ...mapFailedSyncRuns(reading.recent_runs ?? [], "reading"),
        ...mapClientLogs(listClientLogs()),
      ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
      const slice = merged.slice(0, 200);
      setItems(slice);
      if (userId) {
        writeSecurityLogsCache(userId, slice);
      }
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Impossible de charger les journaux de sécurité."
      );
      setItems(mapClientLogs(listClientLogs()));
    } finally {
      setBusy(false);
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    const cached = readSecurityLogsCache(userId);
    if (cached && Date.now() - cached.cachedAt < SECURITY_LOGS_CACHE_TTL_MS) {
      setItems(cached.items as SecurityLogItem[]);
      return;
    }
    void reload();
  }, [userId, reload]);

  function handleClearClientLogs() {
    clearClientLogs();
    void reload();
  }

  const availableScopes = Array.from(new Set(items.map((item) => item.scope))).sort((a, b) =>
    a.localeCompare(b)
  );
  const filteredItems = items.filter((item) => {
    if (sourceFilter !== "all" && item.source !== sourceFilter) {
      return false;
    }
    if (scopeFilter !== "all" && item.scope !== scopeFilter) {
      return false;
    }
    if (levelFilter !== "all" && item.level !== levelFilter) {
      return false;
    }
    const q = query.trim().toLowerCase();
    if (!q) {
      return true;
    }
    return (
      item.scope.toLowerCase().includes(q) ||
      item.message.toLowerCase().includes(q) ||
      item.source.toLowerCase().includes(q)
    );
  });

  return (
    <section className="settings-block" aria-labelledby="settings-security-logs">
      <h2 id="settings-security-logs" className="settings-block-title">
        Journaux de communication Supabase
      </h2>
      <p className="settings-block-lead">
        Affiche les échanges app ⇄ Supabase (connexion, requêtes Edge Function,
        statuts HTTP, erreurs réseau) et les derniers échecs de sync.
      </p>
      <div className="settings-actions">
        <button type="button" disabled={busy} onClick={() => void reload()}>
          {busy ? "Chargement…" : "Rafraîchir"}
        </button>
        <button type="button" disabled={busy} onClick={handleClearClientLogs}>
          Vider logs client
        </button>
      </div>
      <div className="settings-form" style={{ marginTop: "0.75rem" }}>
        <div className="settings-field">
          <label htmlFor="settings-logs-search">Recherche texte</label>
          <input
            id="settings-logs-search"
            type="text"
            value={query}
            onChange={(ev) => setQuery(ev.target.value)}
            placeholder="sync-start, HTTP 400, auth.user, etc."
          />
        </div>
        <div className="settings-field">
          <label htmlFor="settings-logs-source">Source</label>
          <select
            id="settings-logs-source"
            className="family-settings-input"
            value={sourceFilter}
            onChange={(ev) =>
              setSourceFilter(ev.target.value as "all" | "client" | "supabase-sync")
            }
          >
            <option value="all">Toutes</option>
            <option value="client">Client</option>
            <option value="supabase-sync">Supabase sync</option>
          </select>
        </div>
        <div className="settings-field">
          <label htmlFor="settings-logs-level">Niveau</label>
          <select
            id="settings-logs-level"
            className="family-settings-input"
            value={levelFilter}
            onChange={(ev) =>
              setLevelFilter(ev.target.value as "all" | "error" | "warn" | "info")
            }
          >
            <option value="all">Tous</option>
            <option value="error">Erreur</option>
            <option value="warn">Avertissement</option>
            <option value="info">Info</option>
          </select>
        </div>
        <div className="settings-field">
          <label htmlFor="settings-logs-scope">Fonction / service (scope)</label>
          <select
            id="settings-logs-scope"
            className="family-settings-input"
            value={scopeFilter}
            onChange={(ev) => setScopeFilter(ev.target.value)}
          >
            <option value="all">Tous</option>
            {availableScopes.map((scope) => (
              <option key={scope} value={scope}>
                {scope}
              </option>
            ))}
          </select>
        </div>
      </div>
      {error ? <p className="settings-error">{error}</p> : null}
      {filteredItems.length === 0 ? (
        <p className="family-settings-muted">Aucun log disponible.</p>
      ) : (
        <ul className="settings-logs-list" aria-label="Liste des logs">
          {filteredItems.map((item) => (
            <li key={item.id} className="settings-logs-item">
              <div className="settings-logs-item-head">
                <span
                  className={`settings-logs-level settings-logs-level-${item.level}`}
                  title={`Niveau: ${item.level}`}
                >
                  {item.level.toUpperCase()}
                </span>
                <span className="settings-logs-source">{item.source}</span>
                <span className="settings-logs-scope">{item.scope}</span>
                <time className="settings-logs-time">
                  {new Date(item.at).toLocaleString("fr-FR")}
                </time>
              </div>
              <p className="settings-logs-message">{item.message}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
