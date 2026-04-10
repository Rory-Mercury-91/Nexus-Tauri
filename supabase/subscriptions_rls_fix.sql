-- =============================================================================
-- Correctif RLS complet abonnements (INSERT + SELECT RETURNING + owners)
-- + DEFAULT auth.uid() sur created_by
-- Exécuter une fois dans Supabase SQL Editor (après families_storage_avatars.sql).
-- Idempotent : peut être relancé.
-- =============================================================================

alter table public.recurring_subscriptions
  alter column created_by set default (auth.uid());
alter table public.one_off_purchases
  alter column created_by set default (auth.uid());
alter table public.recurring_subscriptions
  alter column family_id drop not null;
alter table public.one_off_purchases
  alter column family_id drop not null;

alter table public.recurring_subscriptions enable row level security;
alter table public.recurring_subscription_owners enable row level security;
alter table public.one_off_purchases enable row level security;
alter table public.one_off_purchase_owners enable row level security;

drop policy if exists "recurring_subscriptions_select_owner" on public.recurring_subscriptions;
drop policy if exists "recurring_subscriptions_insert_member" on public.recurring_subscriptions;
drop policy if exists "recurring_subscriptions_update_owner" on public.recurring_subscriptions;
drop policy if exists "recurring_subscriptions_delete_owner" on public.recurring_subscriptions;

drop policy if exists "recurring_owners_select" on public.recurring_subscription_owners;
drop policy if exists "recurring_owners_insert" on public.recurring_subscription_owners;
drop policy if exists "recurring_owners_delete" on public.recurring_subscription_owners;

drop policy if exists "one_off_select_owner" on public.one_off_purchases;
drop policy if exists "one_off_insert_member" on public.one_off_purchases;
drop policy if exists "one_off_update_owner" on public.one_off_purchases;
drop policy if exists "one_off_delete_owner" on public.one_off_purchases;

drop policy if exists "one_off_owners_select" on public.one_off_purchase_owners;
drop policy if exists "one_off_owners_insert" on public.one_off_purchase_owners;
drop policy if exists "one_off_owners_delete" on public.one_off_purchase_owners;

drop function if exists public.recurring_subscription_insert_allowed(uuid, uuid);
drop function if exists public.one_off_purchase_insert_allowed(uuid, uuid);
drop function if exists public.recurring_owner_row_insert_allowed(uuid, uuid);
drop function if exists public.one_off_owner_row_insert_allowed(uuid, uuid);
drop function if exists public.user_is_owner_of_recurring_subscription(uuid);
drop function if exists public.user_is_owner_of_one_off_purchase(uuid);
drop function if exists public.user_can_select_recurring_subscription(uuid);
drop function if exists public.user_can_select_one_off_purchase(uuid);

create or replace function public.user_is_owner_of_recurring_subscription(
  p_subscription_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.recurring_subscription_owners
    where subscription_id = p_subscription_id
      and user_id = auth.uid()
  );
$$;

create or replace function public.user_is_owner_of_one_off_purchase(
  p_purchase_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.one_off_purchase_owners
    where purchase_id = p_purchase_id
      and user_id = auth.uid()
  );
$$;

grant execute on function public.user_is_owner_of_recurring_subscription(uuid)
  to authenticated;
grant execute on function public.user_is_owner_of_one_off_purchase(uuid)
  to authenticated;

create or replace function public.user_can_select_recurring_subscription(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.recurring_subscription_owners
    where subscription_id = p_id and user_id = auth.uid()
  )
  or exists (
    select 1 from public.recurring_subscriptions s
    where s.id = p_id
      and s.created_by = auth.uid()
      and s.family_id in (select public.user_family_ids())
      and not exists (
        select 1 from public.recurring_subscription_owners o
        where o.subscription_id = s.id
      )
  );
$$;

create or replace function public.user_can_select_one_off_purchase(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.one_off_purchase_owners
    where purchase_id = p_id and user_id = auth.uid()
  )
  or exists (
    select 1 from public.one_off_purchases p
    where p.id = p_id
      and p.created_by = auth.uid()
      and p.family_id in (select public.user_family_ids())
      and not exists (
        select 1 from public.one_off_purchase_owners o
        where o.purchase_id = p.id
      )
  );
$$;

grant execute on function public.user_can_select_recurring_subscription(uuid)
  to authenticated;
grant execute on function public.user_can_select_one_off_purchase(uuid)
  to authenticated;

create or replace function public.recurring_subscription_insert_allowed(
  p_family_id uuid,
  p_created_by uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
    and coalesce(p_created_by, auth.uid()) = auth.uid()
    and (
      p_family_id is null
      or exists (
        select 1 from public.family_members fm
        where fm.family_id = p_family_id
          and fm.user_id = auth.uid()
      )
    );
$$;

create or replace function public.one_off_purchase_insert_allowed(
  p_family_id uuid,
  p_created_by uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
    and coalesce(p_created_by, auth.uid()) = auth.uid()
    and (
      p_family_id is null
      or exists (
        select 1 from public.family_members fm
        where fm.family_id = p_family_id
          and fm.user_id = auth.uid()
      )
    );
$$;

grant execute on function public.recurring_subscription_insert_allowed(uuid, uuid)
  to authenticated;
grant execute on function public.one_off_purchase_insert_allowed(uuid, uuid)
  to authenticated;

create or replace function public.recurring_owner_row_insert_allowed(
  p_subscription_id uuid,
  p_owner_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.recurring_subscriptions s
    where s.id = p_subscription_id
      and (
        (
          s.family_id is null
          and auth.uid() = p_owner_user_id
        )
        or (
          s.family_id is not null
          and exists (
            select 1 from public.family_members fm
            where fm.family_id = s.family_id
              and fm.user_id = auth.uid()
          )
          and exists (
            select 1 from public.family_members fm
            where fm.family_id = s.family_id
              and fm.user_id = p_owner_user_id
          )
        )
      )
  );
$$;

create or replace function public.one_off_owner_row_insert_allowed(
  p_purchase_id uuid,
  p_owner_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.one_off_purchases p
    where p.id = p_purchase_id
      and (
        (
          p.family_id is null
          and auth.uid() = p_owner_user_id
        )
        or (
          p.family_id is not null
          and exists (
            select 1 from public.family_members fm
            where fm.family_id = p.family_id
              and fm.user_id = auth.uid()
          )
          and exists (
            select 1 from public.family_members fm
            where fm.family_id = p.family_id
              and fm.user_id = p_owner_user_id
          )
        )
      )
  );
$$;

grant execute on function public.recurring_owner_row_insert_allowed(uuid, uuid)
  to authenticated;
grant execute on function public.one_off_owner_row_insert_allowed(uuid, uuid)
  to authenticated;

create policy "recurring_subscriptions_select_owner"
  on public.recurring_subscriptions for select
  using (public.user_can_select_recurring_subscription(id));

create policy "recurring_subscriptions_insert_member"
  on public.recurring_subscriptions for insert
  with check (
    public.recurring_subscription_insert_allowed(family_id, created_by)
  );

create policy "recurring_subscriptions_update_owner"
  on public.recurring_subscriptions for update
  using (public.user_is_owner_of_recurring_subscription(id))
  with check (
    family_id in (select public.user_family_ids())
  );

create policy "recurring_subscriptions_delete_owner"
  on public.recurring_subscriptions for delete
  using (public.user_is_owner_of_recurring_subscription(id));

create policy "recurring_owners_select"
  on public.recurring_subscription_owners for select
  using (
    public.user_is_owner_of_recurring_subscription(subscription_id)
  );

create policy "recurring_owners_insert"
  on public.recurring_subscription_owners for insert
  with check (
    public.recurring_owner_row_insert_allowed(subscription_id, user_id)
  );

create policy "recurring_owners_delete"
  on public.recurring_subscription_owners for delete
  using (
    public.user_is_owner_of_recurring_subscription(subscription_id)
  );

create policy "one_off_select_owner"
  on public.one_off_purchases for select
  using (public.user_can_select_one_off_purchase(id));

create policy "one_off_insert_member"
  on public.one_off_purchases for insert
  with check (
    public.one_off_purchase_insert_allowed(family_id, created_by)
  );

create policy "one_off_update_owner"
  on public.one_off_purchases for update
  using (public.user_is_owner_of_one_off_purchase(id))
  with check (
    family_id in (select public.user_family_ids())
  );

create policy "one_off_delete_owner"
  on public.one_off_purchases for delete
  using (public.user_is_owner_of_one_off_purchase(id));

create policy "one_off_owners_select"
  on public.one_off_purchase_owners for select
  using (
    public.user_is_owner_of_one_off_purchase(purchase_id)
  );

create policy "one_off_owners_insert"
  on public.one_off_purchase_owners for insert
  with check (
    public.one_off_owner_row_insert_allowed(purchase_id, user_id)
  );

create policy "one_off_owners_delete"
  on public.one_off_purchase_owners for delete
  using (
    public.user_is_owner_of_one_off_purchase(purchase_id)
  );
