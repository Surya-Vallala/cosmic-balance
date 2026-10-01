-- Cosmic Khaata database
-- Run this once in Supabase (SQL Editor → New query → paste → Run).
-- It is safe to run again: everything is created only if missing or replaced.
--
-- Model
--   people     one row per person. Real users have user_id set. Friends added
--              by name before they join are "placeholders" (user_id null).
--   groups     member_ids lists the people in the group.
--   expenses   the expense itself is stored as JSON in `data`.
--   payments   settle-up payments inside a group (JSON in `data`).
--   transfers  money between two people outside groups (JSON in `data`).
--
-- Security: row level security on every table. You see a group only if you
-- are a member, and its expenses and payments with it. You see people who
-- share a group with you, people you added, and people you have transfers with.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Tables

create table if not exists public.people (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users (id) on delete set null,
  name text not null check (char_length(name) between 1 and 80),
  upi_id text check (upi_id is null or char_length(upi_id) <= 100),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  member_ids uuid[] not null,
  simplify_debts boolean not null default true,
  base_currency text not null default 'INR',
  rates jsonb not null default '{}'::jsonb,
  invite_code text not null unique default encode(gen_random_bytes(6), 'hex'),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists groups_member_ids_idx on public.groups using gin (member_ids);

create table if not exists public.expenses (
  id uuid primary key,
  group_id uuid not null references public.groups (id) on delete cascade,
  data jsonb not null,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists expenses_group_idx on public.expenses (group_id);

create table if not exists public.transfers (
  id uuid primary key,
  from_person uuid not null references public.people (id),
  to_person uuid not null references public.people (id),
  data jsonb not null,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists transfers_from_idx on public.transfers (from_person);
create index if not exists transfers_to_idx on public.transfers (to_person);

create table if not exists public.payments (
  id uuid primary key,
  group_id uuid not null references public.groups (id) on delete cascade,
  -- Set when written by an overall settle-up; deleting that settle-up removes it.
  settlement_id uuid references public.transfers (id) on delete cascade,
  data jsonb not null,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists payments_group_idx on public.payments (group_id);

-- ---------------------------------------------------------------------------
-- Helpers (security definer so policies can use them without recursion)

create or replace function public.my_person_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.people where user_id = auth.uid() limit 1
$$;

create or replace function public.is_member(p_group uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.groups g
    where g.id = p_group and public.my_person_id() = any (g.member_ids)
  )
$$;

create or replace function public.can_see_person(p_person uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.people p
                 where p.id = p_person and (p.user_id = auth.uid() or p.created_by = auth.uid()))
      or exists (select 1 from public.groups g
                 where public.my_person_id() = any (g.member_ids) and p_person = any (g.member_ids))
      or exists (select 1 from public.transfers t
                 where (t.from_person = p_person or t.to_person = p_person)
                   and (t.created_by = auth.uid()
                        or public.my_person_id() in (t.from_person, t.to_person)))
$$;

-- ---------------------------------------------------------------------------
-- Row level security

alter table public.people enable row level security;
alter table public.groups enable row level security;
alter table public.expenses enable row level security;
alter table public.payments enable row level security;
alter table public.transfers enable row level security;

drop policy if exists people_select on public.people;
create policy people_select on public.people for select to authenticated
  using (public.can_see_person(id));

drop policy if exists people_insert on public.people;
create policy people_insert on public.people for insert to authenticated
  with check (created_by = auth.uid() and (user_id is null or user_id = auth.uid()));

-- You can edit yourself, and the name / UPI ID of placeholders you can see.
-- Nobody can attach an account to a placeholder this way (see join_group).
drop policy if exists people_update on public.people;
create policy people_update on public.people for update to authenticated
  using (user_id = auth.uid() or (user_id is null and public.can_see_person(id)))
  with check (user_id = auth.uid() or user_id is null);

drop policy if exists groups_select on public.groups;
create policy groups_select on public.groups for select to authenticated
  using (public.my_person_id() = any (member_ids));

drop policy if exists groups_insert on public.groups;
create policy groups_insert on public.groups for insert to authenticated
  with check (created_by = auth.uid() and public.my_person_id() = any (member_ids));

drop policy if exists groups_update on public.groups;
create policy groups_update on public.groups for update to authenticated
  using (public.my_person_id() = any (member_ids))
  with check (public.my_person_id() = any (member_ids));

drop policy if exists groups_delete on public.groups;
create policy groups_delete on public.groups for delete to authenticated
  using (created_by = auth.uid());

drop policy if exists expenses_all on public.expenses;
create policy expenses_all on public.expenses for all to authenticated
  using (public.is_member(group_id)) with check (public.is_member(group_id));

drop policy if exists payments_all on public.payments;
create policy payments_all on public.payments for all to authenticated
  using (public.is_member(group_id)) with check (public.is_member(group_id));

drop policy if exists transfers_select on public.transfers;
create policy transfers_select on public.transfers for select to authenticated
  using (created_by = auth.uid() or public.my_person_id() in (from_person, to_person));

drop policy if exists transfers_insert on public.transfers;
create policy transfers_insert on public.transfers for insert to authenticated
  with check (created_by = auth.uid()
              and public.can_see_person(from_person) and public.can_see_person(to_person));

drop policy if exists transfers_update on public.transfers;
create policy transfers_update on public.transfers for update to authenticated
  using (created_by = auth.uid() or public.my_person_id() in (from_person, to_person))
  with check (public.can_see_person(from_person) and public.can_see_person(to_person));

drop policy if exists transfers_delete on public.transfers;
create policy transfers_delete on public.transfers for delete to authenticated
  using (created_by = auth.uid() or public.my_person_id() in (from_person, to_person));

-- Only these group columns can be changed after creation (not the invite
-- code or creator). Same idea for people.
revoke update on public.groups from authenticated;
grant update (name, member_ids, simplify_debts, base_currency, rates, updated_at) on public.groups to authenticated;
revoke update on public.people from authenticated;
grant update (name, upi_id) on public.people to authenticated;

-- ---------------------------------------------------------------------------
-- Functions the app calls

-- Your own person row, created on first sign-in.
create or replace function public.ensure_me(p_name text)
returns public.people language plpgsql security definer set search_path = public as $$
declare
  me public.people;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  select * into me from public.people where user_id = auth.uid();
  if found then
    return me;
  end if;
  insert into public.people (user_id, name, created_by)
  values (auth.uid(), left(coalesce(nullif(trim(p_name), ''), 'Me'), 80), auth.uid())
  returning * into me;
  return me;
end $$;

-- Replace one person with another everywhere (used when a friend claims the
-- placeholder that was added for them). Not callable from the app directly.
create or replace function public.merge_person(p_old uuid, p_new uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  o text := p_old::text;
  n text := p_new::text;
begin
  if exists (select 1 from public.groups where p_old = any (member_ids) and p_new = any (member_ids)) then
    raise exception 'You are already in a group with this person''s placeholder. Ask the group to remove it first.';
  end if;
  update public.groups set member_ids = array_replace(member_ids, p_old, p_new), updated_at = now()
    where p_old = any (member_ids);
  update public.expenses set data = replace(data::text, o, n)::jsonb, updated_at = now()
    where data::text like '%' || o || '%';
  update public.payments set data = replace(data::text, o, n)::jsonb
    where data::text like '%' || o || '%';
  update public.transfers
    set from_person = case when from_person = p_old then p_new else from_person end,
        to_person = case when to_person = p_old then p_new else to_person end,
        data = replace(data::text, o, n)::jsonb
    where p_old in (from_person, to_person) or data::text like '%' || o || '%';
  update public.people p set upi_id = coalesce(p.upi_id, ph.upi_id)
    from public.people ph where p.id = p_new and ph.id = p_old;
  delete from public.people where id = p_old;
end $$;
revoke all on function public.merge_person(uuid, uuid) from public, anon, authenticated;

-- What someone opening an invite link sees before joining.
create or replace function public.group_preview(p_code text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  g public.groups;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  select * into g from public.groups where invite_code = p_code;
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'id', g.id,
    'name', g.name,
    'is_member', public.my_person_id() = any (g.member_ids),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'claimed', p.user_id is not null)
                       order by p.name)
      from public.people p where p.id = any (g.member_ids)), '[]'::jsonb)
  );
end $$;

-- Join a group from its invite code. Pass p_claim to take over the
-- placeholder that was added for you (keeps its expenses), or null to join
-- as a new member.
create or replace function public.join_group(p_code text, p_claim uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.my_person_id();
  g public.groups;
begin
  if me is null then
    raise exception 'Not signed in';
  end if;
  select * into g from public.groups where invite_code = p_code for update;
  if not found then
    raise exception 'This invite link is not valid any more.';
  end if;
  if me = any (g.member_ids) then
    return g.id;
  end if;
  if p_claim is not null then
    if not (p_claim = any (g.member_ids)) then
      raise exception 'That person is not in this group.';
    end if;
    if exists (select 1 from public.people where id = p_claim and user_id is not null) then
      raise exception 'Someone has already joined as that person.';
    end if;
    perform public.merge_person(p_claim, me);
  else
    update public.groups set member_ids = member_ids || me, updated_at = now() where id = g.id;
  end if;
  return g.id;
end $$;

-- A fresh invite code (makes the old link stop working).
create or replace function public.reset_invite_code(p_group uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  code text := encode(gen_random_bytes(6), 'hex');
begin
  if not public.is_member(p_group) then
    raise exception 'Not a member of this group';
  end if;
  update public.groups set invite_code = code where id = p_group;
  return code;
end $$;

grant execute on function public.my_person_id(), public.is_member(uuid), public.can_see_person(uuid),
  public.ensure_me(text), public.group_preview(text), public.join_group(text, uuid),
  public.reset_invite_code(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Live updates: let the app hear about changes made by others.

do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['people', 'groups', 'expenses', 'payments', 'transfers'] loop
      if not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
