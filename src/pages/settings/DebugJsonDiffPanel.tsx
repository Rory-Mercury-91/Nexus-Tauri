import { useMemo, useState } from "react";
import { FilePickField } from "@/components/common/FilePickField";

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

type DiffRow = {
  path: string;
  left: string;
  right: string;
};

function safePreview(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    const text = JSON.stringify(value);
    return text.length > 140 ? `${text.slice(0, 140)}...` : text;
  } catch {
    return String(value);
  }
}

function getByPath(input: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (!current || typeof current !== "object") return undefined;
    const record = current as Record<string, unknown>;
    return record[segment];
  }, input);
}

function collectDiffs(left: unknown, right: unknown, path: string, out: DiffRow[], max: number): void {
  if (out.length >= max) return;
  if (Object.is(left, right)) return;
  const leftType = Array.isArray(left) ? "array" : typeof left;
  const rightType = Array.isArray(right) ? "array" : typeof right;
  if (leftType !== rightType) {
    out.push({ path, left: safePreview(left), right: safePreview(right) });
    return;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) {
      out.push({ path: `${path}.length`, left: String(left.length), right: String(right.length) });
    }
    const size = Math.min(left.length, right.length);
    for (let i = 0; i < size; i += 1) {
      collectDiffs(left[i], right[i], `${path}[${i}]`, out, max);
      if (out.length >= max) return;
    }
    return;
  }
  if (left && right && typeof left === "object" && typeof right === "object") {
    const leftObj = left as Record<string, unknown>;
    const rightObj = right as Record<string, unknown>;
    const keys = Array.from(new Set([...Object.keys(leftObj), ...Object.keys(rightObj)])).sort();
    for (const key of keys) {
      collectDiffs(leftObj[key], rightObj[key], `${path}.${key}`, out, max);
      if (out.length >= max) return;
    }
    return;
  }
  out.push({ path, left: safePreview(left), right: safePreview(right) });
}

async function readJsonFile(file: File): Promise<JsonValue> {
  const text = await file.text();
  return JSON.parse(text) as JsonValue;
}

export function DebugJsonDiffPanel() {
  const [leftFile, setLeftFile] = useState<File | null>(null);
  const [rightFile, setRightFile] = useState<File | null>(null);
  const [leftJson, setLeftJson] = useState<JsonValue | null>(null);
  const [rightJson, setRightJson] = useState<JsonValue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function loadFiles(): Promise<void> {
    if (!leftFile || !rightFile) {
      setError("Sélectionne les deux fichiers JSON.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const [left, right] = await Promise.all([readJsonFile(leftFile), readJsonFile(rightFile)]);
      setLeftJson(left);
      setRightJson(right);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Impossible de lire les JSON.");
      setLeftJson(null);
      setRightJson(null);
    } finally {
      setBusy(false);
    }
  }

  const summary = useMemo(() => {
    if (!leftJson || !rightJson) return null;
    const checks = [
      "entity.media",
      "entity.mal_id",
      "entity.reading_row_id",
      "entity.anime_row_id",
      "context.user_id",
      "supabase.errors",
    ].map((path) => {
      const left = getByPath(leftJson, path);
      const right = getByPath(rightJson, path);
      return { path, left: safePreview(left), right: safePreview(right), same: safePreview(left) === safePreview(right) };
    });

    const diffs: DiffRow[] = [];
    collectDiffs(leftJson, rightJson, "$", diffs, 180);
    const leftReadingRows = Number((getByPath(leftJson, "supabase.reading_by_mal_all_rows") as unknown[] | undefined)?.length ?? 0);
    const rightReadingRows = Number((getByPath(rightJson, "supabase.reading_by_mal_all_rows") as unknown[] | undefined)?.length ?? 0);
    const leftAnimeRows = Number((getByPath(leftJson, "supabase.anime_by_mal_all_rows") as unknown[] | undefined)?.length ?? 0);
    const rightAnimeRows = Number((getByPath(rightJson, "supabase.anime_by_mal_all_rows") as unknown[] | undefined)?.length ?? 0);

    return {
      checks,
      diffs,
      leftReadingRows,
      rightReadingRows,
      leftAnimeRows,
      rightAnimeRows,
    };
  }, [leftJson, rightJson]);

  return (
    <section className="settings-block" aria-labelledby="settings-json-diff">
      <h2 id="settings-json-diff" className="settings-block-title">
        Comparateur JSON debug
      </h2>
      <p className="settings-block-lead">
        Charge deux exports debug pour repérer rapidement les divergences de données entre utilisateurs.
      </p>

      <div className="settings-debug-diff-picks">
        <FilePickField
          accept=".json,application/json"
          buttonLabel="Fichier A"
          selectedLabel={leftFile?.name ?? null}
          onFileChange={(file) => setLeftFile(file ?? null)}
          disabled={busy}
        />
        <FilePickField
          accept=".json,application/json"
          buttonLabel="Fichier B"
          selectedLabel={rightFile?.name ?? null}
          onFileChange={(file) => setRightFile(file ?? null)}
          disabled={busy}
        />
        <div className="settings-actions">
          <button type="button" onClick={() => void loadFiles()} disabled={busy}>
            {busy ? "Analyse..." : "Comparer"}
          </button>
        </div>
      </div>

      {error ? <p className="settings-error">{error}</p> : null}

      {summary ? (
        <div className="settings-debug-diff-results">
          <p className="settings-block-lead">
            Différences détectées: <strong>{summary.diffs.length}</strong>
          </p>
          <p className="settings-block-lead">
            Doublons potentiels lecture (A/B): <strong>{summary.leftReadingRows}</strong> / <strong>{summary.rightReadingRows}</strong> |
            Doublons potentiels anime (A/B): <strong>{summary.leftAnimeRows}</strong> / <strong>{summary.rightAnimeRows}</strong>
          </p>

          <ul className="settings-logs-list">
            {summary.checks.map((check) => (
              <li key={check.path} className="settings-logs-item">
                <p className="settings-logs-message">
                  <strong>{check.path}</strong> — {check.same ? "OK" : "DIFF"}
                </p>
                <p className="settings-logs-message">A: {check.left || "—"}</p>
                <p className="settings-logs-message">B: {check.right || "—"}</p>
              </li>
            ))}
          </ul>

          <ul className="settings-logs-list">
            {summary.diffs.map((row) => (
              <li key={row.path} className="settings-logs-item">
                <p className="settings-logs-message">
                  <strong>{row.path}</strong>
                </p>
                <p className="settings-logs-message">A: {row.left || "—"}</p>
                <p className="settings-logs-message">B: {row.right || "—"}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
