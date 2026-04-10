export type SyncDiffField = {
  id: string;
  label: string;
  currentValue: string;
  incomingValue: string;
};

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

function asNumberString(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return "";
  }
  return String(n);
}

function normalizeComparable(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function pushDiff(
  output: SyncDiffField[],
  field: { id: string; label: string; currentValue: string; incomingValue: string }
) {
  const current = field.currentValue || "—";
  const incoming = field.incomingValue || "—";
  if (normalizeComparable(current) === normalizeComparable(incoming)) {
    return;
  }
  output.push({
    id: field.id,
    label: field.label,
    currentValue: current,
    incomingValue: incoming,
  });
}

export function buildAnimeSyncDiffFields(params: {
  malSnapshot: Record<string, unknown> | null;
  liveFull: Record<string, unknown> | null;
}): SyncDiffField[] {
  const snapshot = params.malSnapshot ?? {};
  const live = params.liveFull ?? {};
  const output: SyncDiffField[] = [];

  pushDiff(output, {
    id: "title",
    label: "Titre principal",
    currentValue: asString(snapshot.title),
    incomingValue: asString(live.title),
  });
  pushDiff(output, {
    id: "score",
    label: "Score",
    currentValue: asNumberString(snapshot.mean),
    incomingValue: asNumberString(live.score),
  });
  pushDiff(output, {
    id: "status",
    label: "Statut de l'oeuvre",
    currentValue: asString(snapshot.status),
    incomingValue: asString(live.status),
  });
  pushDiff(output, {
    id: "episodes",
    label: "Nombre d'épisodes",
    currentValue: asNumberString(snapshot.num_episodes),
    incomingValue: asNumberString(live.episodes),
  });
  pushDiff(output, {
    id: "synopsis",
    label: "Synopsis",
    currentValue: asString(snapshot.synopsis),
    incomingValue: asString(live.synopsis),
  });

  return output;
}

export function buildReadingSyncDiffFields(params: {
  dbRow: Record<string, unknown> | null;
  livePayload: Record<string, unknown> | null;
}): SyncDiffField[] {
  const db = params.dbRow ?? {};
  const jikanSnapshot = toRecord(db.jikan_snapshot);
  const snapshotFull = toRecord(jikanSnapshot.full);
  const liveRoot = toRecord(params.livePayload);
  const liveFull = toRecord(liveRoot.data ?? liveRoot);
  const output: SyncDiffField[] = [];

  pushDiff(output, {
    id: "title",
    label: "Titre principal",
    currentValue: asString(snapshotFull.title || db.title),
    incomingValue: asString(liveFull.title),
  });
  pushDiff(output, {
    id: "score",
    label: "Score",
    currentValue: asNumberString(snapshotFull.score),
    incomingValue: asNumberString(liveFull.score),
  });
  pushDiff(output, {
    id: "status",
    label: "Statut de l'oeuvre",
    currentValue: asString(snapshotFull.status),
    incomingValue: asString(liveFull.status),
  });
  pushDiff(output, {
    id: "chapters",
    label: "Chapitres",
    currentValue: asNumberString(snapshotFull.chapters),
    incomingValue: asNumberString(liveFull.chapters),
  });
  pushDiff(output, {
    id: "volumes",
    label: "Volumes",
    currentValue: asNumberString(snapshotFull.volumes),
    incomingValue: asNumberString(liveFull.volumes),
  });
  pushDiff(output, {
    id: "synopsis",
    label: "Synopsis",
    currentValue: asString(snapshotFull.synopsis),
    incomingValue: asString(liveFull.synopsis),
  });

  return output;
}
