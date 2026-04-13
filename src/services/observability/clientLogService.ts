export type ClientLogLevel = "error" | "warn" | "info";

export type ClientLogEntry = {
  id: string;
  at: string;
  level: ClientLogLevel;
  scope: string;
  message: string;
  details?: string;
};

const CLIENT_LOGS_KEY = "nexus:client:logs:v1";
const CLIENT_LOGS_LIMIT = 300;

function readLogs(): ClientLogEntry[] {
  try {
    const raw = localStorage.getItem(CLIENT_LOGS_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as ClientLogEntry[]) : [];
  } catch {
    return [];
  }
}

function writeLogs(entries: ClientLogEntry[]): void {
  try {
    localStorage.setItem(CLIENT_LOGS_KEY, JSON.stringify(entries.slice(0, CLIENT_LOGS_LIMIT)));
  } catch {
    // Ignore les erreurs de quota/stockage.
  }
}

function shouldSkipDuplicate(
  previous: ClientLogEntry[],
  next: Pick<ClientLogEntry, "level" | "scope" | "message" | "details">
): boolean {
  const latestSame = previous.find(
    (entry) =>
      entry.level === next.level &&
      entry.scope === next.scope &&
      entry.message === next.message &&
      (entry.details ?? "") === (next.details ?? "")
  );
  if (!latestSame) {
    return false;
  }
  const deltaMs = Date.now() - new Date(latestSame.at).getTime();
  // Evite le spam de logs de polling identiques.
  return deltaMs < 30_000;
}

export function appendClientLog(
  level: ClientLogLevel,
  scope: string,
  message: string,
  details?: string
): void {
  const previous = readLogs();
  if (shouldSkipDuplicate(previous, { level, scope, message, details })) {
    return;
  }
  const next: ClientLogEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    at: new Date().toISOString(),
    level,
    scope,
    message,
    ...(details ? { details } : {}),
  };
  writeLogs([next, ...previous]);
}

export function listClientLogs(): ClientLogEntry[] {
  return readLogs();
}

export function clearClientLogs(): void {
  try {
    localStorage.removeItem(CLIENT_LOGS_KEY);
  } catch {
    // Ignore les erreurs de stockage.
  }
}
