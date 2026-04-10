-- Avertissement linter Supabase : function_search_path_mutable (set_updated_at)
-- Exécuter une fois dans le SQL Editor si init.sql a été appliqué sans search_path.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
