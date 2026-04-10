-- =============================================================================
-- À exécuter dans le SQL Editor Supabase (après init.sql + families_storage_avatars.sql)
-- Recherche de profils par pseudo pour inviter au foyer (sans passer par le dashboard).
-- =============================================================================

create or replace function public.search_profiles_for_invite(p_query text)
returns table (id uuid, display_name text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.display_name
  from public.profiles p
  where auth.uid() is not null
    and p.id <> auth.uid()
    and length(trim(p_query)) >= 2
    and trim(p.display_name) <> ''
    and p.display_name ilike ('%' || trim(p_query) || '%')
  order by
    case when lower(trim(p.display_name)) = lower(trim(p_query)) then 0 else 1 end,
    char_length(p.display_name)
  limit 15;
$$;

comment on function public.search_profiles_for_invite(text) is
  'Liste des profils dont le pseudo correspond à la requête (invitation foyer).';

revoke all on function public.search_profiles_for_invite(text) from public;
grant execute on function public.search_profiles_for_invite(text) to authenticated;
