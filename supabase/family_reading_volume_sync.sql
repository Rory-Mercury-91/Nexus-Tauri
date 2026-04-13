-- =============================================================================
-- Nexus-Tauri — Synchronisation des tomes entre fiches lecture du même foyer
-- =============================================================================
-- ⚠️ DÉPRÉCIÉ — Modèle v1 (reading_volumes dupliqués). Remplacé par
-- nexus_install_volumes_v2.sql (catalogue global + family_manga_volume_owner).
-- Ne pas exécuter sur un projet déjà passé en v2.
-- =============================================================================

create or replace function public.refresh_reading_mal_snapshot_volumes_read(p_reading_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
  v_snap jsonb;
  v_list jsonb;
  v_list_status jsonb;
begin
  select count(*)::int into v_count
  from public.reading_volumes
  where reading_id = p_reading_id and is_read = true;

  select mal_official_snapshot into v_snap
  from public.library_reading
  where id = p_reading_id;

  if not found then
    return;
  end if;

  v_snap := coalesce(v_snap, '{}'::jsonb);
  v_list := coalesce(v_snap->'list_entry', '{}'::jsonb);
  v_list_status := coalesce(v_list->'list_status', '{}'::jsonb);
  v_list_status := jsonb_set(v_list_status, '{num_volumes_read}', to_jsonb(v_count), true);
  v_list := jsonb_set(v_list, '{list_status}', v_list_status);
  v_snap := jsonb_set(v_snap, '{list_entry}', v_list);

  update public.library_reading
  set mal_official_snapshot = v_snap,
      updated_at = now()
  where id = p_reading_id;
end;
$$;

comment on function public.refresh_reading_mal_snapshot_volumes_read(uuid) is
  'Met à jour num_volumes_read dans mal_official_snapshot à partir des tomes lus.';

-- Copie un tome (métadonnées + propriétaires) vers les autres library_reading
-- du foyer pour le même manga MAL.
create or replace function public.sync_reading_volume_to_family_peers(
  p_reading_id uuid,
  p_volume_number integer,
  p_family_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_vol public.reading_volumes%rowtype;
  v_mal integer;
  v_source_id uuid;
  v_target_id uuid;
  r record;
begin
  if v_uid is null then
    raise exception 'Non authentifié';
  end if;

  if not exists (
    select 1 from public.family_members fm
    where fm.family_id = p_family_id and fm.user_id = v_uid
  ) then
    raise exception 'Accès foyer refusé';
  end if;

  select * into v_vol
  from public.reading_volumes rv
  where rv.reading_id = p_reading_id and rv.volume_number = p_volume_number;

  if not found then
    raise exception 'Tome introuvable';
  end if;

  if v_vol.family_id is distinct from p_family_id then
    update public.reading_volumes
    set family_id = p_family_id
    where id = v_vol.id;
    v_vol.family_id := p_family_id;
  end if;

  select lr.mal_manga_id into v_mal
  from public.library_reading lr
  where lr.id = p_reading_id;

  if v_mal is null then
    return;
  end if;

  v_source_id := v_vol.id;

  for r in
    select lr.id as reading_id
    from public.library_reading lr
    inner join public.family_members fm
      on fm.user_id = lr.user_id and fm.family_id = p_family_id
    where lr.mal_manga_id = v_mal
      and lr.id <> p_reading_id
  loop
    insert into public.reading_volumes (
      reading_id,
      family_id,
      volume_number,
      volume_type,
      image_url,
      release_date_vf,
      purchase_date,
      price_euros,
      is_owned,
      is_read,
      is_mihon,
      created_by
    ) values (
      r.reading_id,
      p_family_id,
      v_vol.volume_number,
      v_vol.volume_type,
      v_vol.image_url,
      v_vol.release_date_vf,
      v_vol.purchase_date,
      v_vol.price_euros,
      v_vol.is_owned,
      v_vol.is_read,
      v_vol.is_mihon,
      v_uid
    )
    on conflict (reading_id, volume_number) do update set
      family_id = excluded.family_id,
      volume_type = excluded.volume_type,
      image_url = excluded.image_url,
      release_date_vf = excluded.release_date_vf,
      purchase_date = excluded.purchase_date,
      price_euros = excluded.price_euros,
      is_owned = excluded.is_owned,
      is_read = excluded.is_read,
      is_mihon = excluded.is_mihon,
      updated_at = now()
    returning id into v_target_id;

    delete from public.reading_volume_owners o where o.volume_id = v_target_id;

    -- DISTINCT ON : évite doublon PK si la source contenait des anomalies
    insert into public.reading_volume_owners (volume_id, user_id, family_id, share_euros)
    select distinct on (o.user_id)
      v_target_id, o.user_id, o.family_id, o.share_euros
    from public.reading_volume_owners o
    where o.volume_id = v_source_id
    order by o.user_id, o.updated_at desc nulls last;

    perform public.refresh_reading_mal_snapshot_volumes_read(r.reading_id);
  end loop;
end;
$$;

comment on function public.sync_reading_volume_to_family_peers(uuid, integer, uuid) is
  'Réplique le tome sur les fiches lecture des autres membres du foyer (même manga).';

grant execute on function public.refresh_reading_mal_snapshot_volumes_read(uuid) to authenticated;
grant execute on function public.sync_reading_volume_to_family_peers(uuid, integer, uuid) to authenticated;
