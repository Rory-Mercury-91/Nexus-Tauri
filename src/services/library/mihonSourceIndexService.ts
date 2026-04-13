import { getSupabaseClient } from "@/lib/supabaseClient";

export const MIHON_KEIYOUSHI_INDEX_URL =
  "https://raw.githubusercontent.com/keiyoushi/extensions/repo/index.min.json";

type MihonCatalogEntry = {
  name?: string;
  pkg?: string;
  apk?: string;
  version?: string;
  nsfw?: number | boolean;
  sources?: Array<{
    name?: string;
    lang?: string;
    id?: string | number;
    baseUrl?: string;
  }>;
};

type MihonSourceUpsertRow = {
  source_id: string;
  source_name: string;
  source_lang: string;
  source_base_url: string | null;
  extension_name: string;
  extension_pkg: string;
  extension_version: string | null;
  extension_apk: string | null;
  extension_nsfw: boolean;
};

function toBooleanNsfw(value: number | boolean | undefined): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  return Number(value ?? 0) === 1;
}

function flattenMihonCatalog(entries: MihonCatalogEntry[]): MihonSourceUpsertRow[] {
  const rows: MihonSourceUpsertRow[] = [];
  for (const extension of entries) {
    const extensionSources = Array.isArray(extension.sources) ? extension.sources : [];
    for (const source of extensionSources) {
      const sourceId = String(source.id ?? "").trim();
      if (!sourceId) {
        continue;
      }
      rows.push({
        source_id: sourceId,
        source_name: String(source.name ?? "Source inconnue"),
        source_lang: String(source.lang ?? "all"),
        source_base_url: source.baseUrl ? String(source.baseUrl) : null,
        extension_name: String(extension.name ?? "Extension inconnue"),
        extension_pkg: String(extension.pkg ?? "unknown.pkg"),
        extension_version: extension.version ? String(extension.version) : null,
        extension_apk: extension.apk ? String(extension.apk) : null,
        extension_nsfw: toBooleanNsfw(extension.nsfw),
      });
    }
  }
  return rows;
}

export async function refreshMihonSourceIndex(
  catalogUrl: string = MIHON_KEIYOUSHI_INDEX_URL
): Promise<{ imported: number }> {
  const response = await fetch(catalogUrl, { method: "GET" });
  if (!response.ok) {
    throw new Error(`Téléchargement index Mihon impossible (${response.status}).`);
  }

  const payload = (await response.json()) as unknown;
  if (!Array.isArray(payload)) {
    throw new Error("Format index Mihon invalide: tableau attendu.");
  }

  const flattened = flattenMihonCatalog(payload as MihonCatalogEntry[]);
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("upsert_mihon_sources", {
    p_sources: flattened,
    p_catalog_url: catalogUrl,
  });

  if (error) {
    throw new Error(error.message);
  }

  return { imported: Number(data ?? 0) };
}

export async function getMihonSourceById(sourceId: string): Promise<{
  sourceId: string;
  sourceName: string;
  sourceLang: string;
  sourceBaseUrl: string | null;
} | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("mihon_sources")
    .select("source_id, source_name, source_lang, source_base_url")
    .eq("source_id", sourceId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    return null;
  }
  return {
    sourceId: String(data.source_id),
    sourceName: String(data.source_name),
    sourceLang: String(data.source_lang),
    sourceBaseUrl: data.source_base_url ? String(data.source_base_url) : null,
  };
}

export async function getMihonSourceIndexStats(): Promise<{
  total: number;
  lastFetchedAt: string | null;
}> {
  const supabase = getSupabaseClient();
  const [{ count, error: countError }, { data, error: latestError }] = await Promise.all([
    supabase
      .from("mihon_sources")
      .select("source_id", { count: "exact", head: true }),
    supabase
      .from("mihon_sources")
      .select("fetched_at")
      .order("fetched_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (countError) {
    throw new Error(countError.message);
  }
  if (latestError) {
    throw new Error(latestError.message);
  }

  return {
    total: Number(count ?? 0),
    lastFetchedAt: data?.fetched_at ? String(data.fetched_at) : null,
  };
}
