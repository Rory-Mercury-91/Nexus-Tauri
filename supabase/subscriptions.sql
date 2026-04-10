-- =============================================================================
-- Abonnements récurrents + achats ponctuels (Nexus-Tauri)
-- À exécuter APRÈS supabase/families_storage_avatars.sql
-- Visibilité : uniquement les lignes dont l’utilisateur est propriétaire (table owners).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------

create table if not exists public.recurring_subscriptions (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  name text not null,
  period_type text not null
    constraint recurring_subscriptions_period_chk
      check (period_type in ('weekly', 'monthly', 'yearly', 'other')),
  price_euros numeric(12, 2) not null
    constraint recurring_subscriptions_price_chk check (price_euros >= 0),
  start_date date not null,
  end_date date,
  status text not null default 'active'
    constraint recurring_subscriptions_status_chk
      check (status in ('active', 'cancelled')),
  next_payment_date date,
  last_payment_date date,
  notes text not null default '',
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.recurring_subscriptions is
  'Abonnement récurrent partagé ; visibilité via recurring_subscription_owners.';

create table if not exists public.recurring_subscription_owners (
  subscription_id uuid not null references public.recurring_subscriptions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  primary key (subscription_id, user_id)
);

create table if not exists public.one_off_purchases (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  site_name text not null,
  purchase_date date not null,
  amount_euros numeric(12, 2) not null
    constraint one_off_purchases_amount_chk check (amount_euros >= 0),
  credits_received numeric(12, 2) not null default 0,
  notes text not null default '',
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.one_off_purchase_owners (
  purchase_id uuid not null references public.one_off_purchases (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  primary key (purchase_id, user_id)
);

create index if not exists recurring_subscriptions_family_idx
  on public.recurring_subscriptions (family_id);
create index if not exists recurring_subscriptions_status_idx
  on public.recurring_subscriptions (status);
create index if not exists one_off_purchases_family_idx
  on public.one_off_purchases (family_id);
create index if not exists one_off_purchases_date_idx
  on public.one_off_purchases (purchase_date);

-- Le foyer est optionnel : entrée personnelle possible.
alter table public.recurring_subscriptions
  alter column family_id drop not null;
alter table public.one_off_purchases
  alter column family_id drop not null;

-- Créateur : défini côté base (évite les refus RLS si le client omet la colonne)
alter table public.recurring_subscriptions
  alter column created_by set default (auth.uid());
alter table public.one_off_purchases
  alter column created_by set default (auth.uid());

-- -----------------------------------------------------------------------------
-- Triggers updated_at
-- -----------------------------------------------------------------------------

drop trigger if exists recurring_subscriptions_set_updated_at on public.recurring_subscriptions;
create trigger recurring_subscriptions_set_updated_at
  before update on public.recurring_subscriptions
  for each row execute function public.set_updated_at();

drop trigger if exists one_off_purchases_set_updated_at on public.one_off_purchases;
create trigger one_off_purchases_set_updated_at
  before update on public.one_off_purchases
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------

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

-- -----------------------------------------------------------------------------
-- Fonctions SECURITY DEFINER : éviter la récursion RLS sur les tables *_owners
-- (ne pas sous-requêter recurring_subscription_owners / one_off_purchase_owners
-- dans leurs propres politiques).
-- -----------------------------------------------------------------------------
drop function if exists public.user_is_owner_of_recurring_subscription(uuid);
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

drop function if exists public.user_is_owner_of_one_off_purchase(uuid);
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

-- SELECT : propriétaire OU créateur le temps qu’aucune ligne *_owners n’existe
-- (sinon INSERT … RETURNING échoue : les owners sont ajoutés après l’abonnement).
drop function if exists public.user_can_select_recurring_subscription(uuid);
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

drop function if exists public.user_can_select_one_off_purchase(uuid);
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

-- INSERT abonnement / achat : vérification en DEFINER (membre du foyer + créateur)
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

-- INSERT lignes propriétaires : lecture subscriptions / purchases via DEFINER
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

-- Abonnements : lecture (propriétaires + brouillon créateur sans owners)
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

-- Co-propriétaires : voir toutes les lignes du même abonnement
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

-- Achats ponctuels
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
