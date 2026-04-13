-- =============================================================================
-- Nexus-Tauri — Index des sources Mihon/Tachiyomi (Keiyoushi)
-- =============================================================================

create table if not exists public.mihon_sources (
  source_id text primary key,
  source_name text not null,
  source_lang text not null,
  source_base_url text,
  extension_name text not null,
  extension_pkg text not null,
  extension_version text,
  extension_apk text,
  extension_nsfw boolean not null default false,
  catalog_url text not null default 'https://raw.githubusercontent.com/keiyoushi/extensions/repo/index.min.json',
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.mihon_sources is
  'Index local des sources Mihon/Tachiyomi, alimenté depuis le catalogue Keiyoushi.';

comment on column public.mihon_sources.catalog_url is
  'URL du catalogue utilisé pour alimenter la table (index.min.json Keiyoushi).';

create index if not exists mihon_sources_lang_idx
  on public.mihon_sources (source_lang);

create index if not exists mihon_sources_base_url_idx
  on public.mihon_sources (source_base_url);

create index if not exists mihon_sources_pkg_idx
  on public.mihon_sources (extension_pkg);

drop trigger if exists mihon_sources_set_updated_at on public.mihon_sources;
create trigger mihon_sources_set_updated_at
  before update on public.mihon_sources
  for each row execute function public.set_updated_at();

alter table public.mihon_sources enable row level security;

drop policy if exists "mihon_sources_select_authenticated" on public.mihon_sources;
create policy "mihon_sources_select_authenticated"
  on public.mihon_sources for select
  using (auth.role() = 'authenticated');

drop function if exists public.upsert_mihon_sources(jsonb, text);
create or replace function public.upsert_mihon_sources(
  p_sources jsonb,
  p_catalog_url text default 'https://raw.githubusercontent.com/keiyoushi/extensions/repo/index.min.json'
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
  v_row jsonb;
begin
  if p_sources is null or jsonb_typeof(p_sources) <> 'array' then
    raise exception 'p_sources doit être un tableau JSON';
  end if;

  for v_row in
    select value from jsonb_array_elements(p_sources)
  loop
    insert into public.mihon_sources (
      source_id,
      source_name,
      source_lang,
      source_base_url,
      extension_name,
      extension_pkg,
      extension_version,
      extension_apk,
      extension_nsfw,
      catalog_url,
      fetched_at
    )
    values (
      coalesce(v_row->>'source_id', ''),
      coalesce(v_row->>'source_name', 'Source inconnue'),
      coalesce(v_row->>'source_lang', 'all'),
      nullif(v_row->>'source_base_url', ''),
      coalesce(v_row->>'extension_name', 'Extension inconnue'),
      coalesce(v_row->>'extension_pkg', 'unknown.pkg'),
      nullif(v_row->>'extension_version', ''),
      nullif(v_row->>'extension_apk', ''),
      coalesce((v_row->>'extension_nsfw')::boolean, false),
      coalesce(nullif(p_catalog_url, ''), 'https://raw.githubusercontent.com/keiyoushi/extensions/repo/index.min.json'),
      now()
    )
    on conflict (source_id) do update set
      source_name = excluded.source_name,
      source_lang = excluded.source_lang,
      source_base_url = excluded.source_base_url,
      extension_name = excluded.extension_name,
      extension_pkg = excluded.extension_pkg,
      extension_version = excluded.extension_version,
      extension_apk = excluded.extension_apk,
      extension_nsfw = excluded.extension_nsfw,
      catalog_url = excluded.catalog_url,
      fetched_at = excluded.fetched_at;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

grant execute on function public.upsert_mihon_sources(jsonb, text) to authenticated;
