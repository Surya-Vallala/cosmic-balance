-- Cosmic Khaata database
-- Run this in Supabase (SQL Editor → New query → paste → Run).
-- It is safe to run again, and running the newest version upgrades a
-- database set up with an older one: everything is created only if missing
-- or replaced, and existing data is kept.
--
-- Model
--   people     one row per person. Real users have user_id set. Friends added
--              before they join are "placeholders" (user_id null). A
--              placeholder with an email is linked to that person's account
--              automatically when they sign in.
--   contacts   your friends list: people you added who aren't necessarily in
--              a group with you.
--   groups     member_ids lists the people in the group.
--   expenses   the expense itself is stored as JSON in `data`.
--   payments   settle-up payments inside a group (JSON in `data`).
--   transfers  money between two people outside groups (JSON in `data`).
--
-- Security: row level security on every table. You see a group only if you
-- are a member, and its expenses and payments with it. You see people who
-- share a group with you, your friends list, people you added, and people you
-- have transfers with. Group members change only through set_group_members.

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
-- Added in version 2: the person's email (their sign-in email once linked).
alter table public.people add column if not exists email text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'people_email_length') then
    alter table public.people add constraint people_email_length
      check (email is null or char_length(email) <= 254);
  end if;
end $$;

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  member_ids uuid[] not null,
  simplify_debts boolean not null default true,
  base_currency text not null default 'INR',
  rates jsonb not null default '{}'::jsonb,
  invite_code text not null unique default left(replace(gen_random_uuid()::text, '-', ''), 12),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists groups_member_ids_idx on public.groups using gin (member_ids);
-- Version 1 used pgcrypto here, which Supabase keeps outside the functions' search path.
alter table public.groups alter column invite_code set default left(replace(gen_random_uuid()::text, '-', ''), 12);

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

-- Added in version 2: friends lists. Written only by the functions below.
create table if not exists public.contacts (
  owner uuid not null references auth.users (id) on delete cascade,
  person_id uuid not null references public.people (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (owner, person_id)
);
create index if not exists contacts_person_idx on public.contacts (person_id);

-- ---------------------------------------------------------------------------
-- Helpers (security definer so policies can use them without recursion)

-- Emails compared the way Google treats them: case doesn't matter, and for
-- Gmail neither do dots or a +suffix (s.urya+trip@gmail.com = surya@gmail.com).
create or replace function public.normalize_email(p text)
returns text language sql immutable set search_path = public as $$
  select case
    when p is null or btrim(p) = '' or position('@' in btrim(p)) = 0 then null
    when lower(split_part(btrim(p), '@', 2)) in ('gmail.com', 'googlemail.com')
      then replace(split_part(lower(split_part(btrim(p), '@', 1)), '+', 1), '.', '') || '@gmail.com'
    else lower(btrim(p))
  end
$$;

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
      or exists (select 1 from public.contacts c where c.owner = auth.uid() and c.person_id = p_person)
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
alter table public.contacts enable row level security;

drop policy if exists people_select on public.people;
create policy people_select on public.people for select to authenticated
  using (public.can_see_person(id));

drop policy if exists people_insert on public.people;
create policy people_insert on public.people for insert to authenticated
  with check (created_by = auth.uid() and user_id is null);

-- You can edit yourself, and the name / UPI ID of placeholders you can see.
-- Nobody can attach an account to a placeholder this way (see join_group).
drop policy if exists people_update on public.people;
create policy people_update on public.people for update to authenticated
  using (user_id = auth.uid() or (user_id is null and public.can_see_person(id)))
  with check (user_id = auth.uid() or user_id is null);

drop policy if exists groups_select on public.groups;
create policy groups_select on public.groups for select to authenticated
  using (public.my_person_id() = any (member_ids));

-- A new group must include you, and only people you know.
drop policy if exists groups_insert on public.groups;
create policy groups_insert on public.groups for insert to authenticated
  with check (created_by = auth.uid()
              and public.my_person_id() = any (member_ids)
              and (select coalesce(bool_and(public.can_see_person(m)), false) from unnest(member_ids) m));

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

drop policy if exists contacts_select on public.contacts;
create policy contacts_select on public.contacts for select to authenticated
  using (owner = auth.uid());

-- Only these columns can be changed directly. Group members change through
-- set_group_members (so two people editing at once can't undo each other),
-- emails through add_person_by_email / set_person_email.
revoke update on public.groups from anon, authenticated;
grant update (name, simplify_debts, base_currency, rates, updated_at) on public.groups to authenticated;
revoke update on public.people from anon, authenticated;
grant update (name, upi_id) on public.people to authenticated;
revoke insert, update, delete, truncate on public.contacts from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Internal functions (not callable from the app)

-- The person row for an account, created if they have never opened the app.
create or replace function public.person_for_account(p_account uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  pid uuid;
begin
  select id into pid from public.people where user_id = p_account;
  if pid is not null then
    return pid;
  end if;
  insert into public.people (user_id, name, email, created_by)
  select u.id,
         left(coalesce(nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
                       nullif(btrim(u.raw_user_meta_data ->> 'name'), ''),
                       split_part(u.email, '@', 1), 'Friend'), 80),
         lower(btrim(u.email)), u.id
  from auth.users u where u.id = p_account
  on conflict (user_id) do nothing;
  select id into pid from public.people where user_id = p_account;
  return pid;
end $$;

-- Replace one person with another everywhere (used when a friend claims the
-- placeholder that was added for them, or signs in with its email).
create or replace function public.merge_person(p_old uuid, p_new uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  o text := p_old::text;
  n text := p_new::text;
  old_creator uuid;
  new_user uuid;
  creator_person uuid;
begin
  if p_old = p_new then
    return;
  end if;
  if exists (select 1 from public.groups where p_old = any (member_ids) and p_new = any (member_ids)) then
    raise exception 'You are already in a group with this person''s placeholder. Ask the group to remove it first.';
  end if;
  select created_by into old_creator from public.people where id = p_old;
  select user_id into new_user from public.people where id = p_new;

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

  -- Friends lists follow the person, and whoever added the placeholder and
  -- the real person become friends both ways.
  insert into public.contacts (owner, person_id)
    select c.owner, p_new from public.contacts c
    where c.person_id = p_old and c.owner is distinct from new_user
    on conflict do nothing;
  if old_creator is not null and old_creator is distinct from new_user then
    insert into public.contacts (owner, person_id) values (old_creator, p_new) on conflict do nothing;
    select id into creator_person from public.people where user_id = old_creator;
    if creator_person is not null and new_user is not null then
      insert into public.contacts (owner, person_id) values (new_user, creator_person) on conflict do nothing;
    end if;
  end if;

  update public.people p set upi_id = coalesce(p.upi_id, ph.upi_id)
    from public.people ph where p.id = p_new and ph.id = p_old;
  delete from public.people where id = p_old;
end $$;

-- ---------------------------------------------------------------------------
-- Functions the app calls

-- Your own person row, created on first sign-in. Also links you to anyone
-- who added your email before you joined.
create or replace function public.ensure_me(p_name text)
returns public.people language plpgsql security definer set search_path = public as $$
declare
  me public.people;
  my_email text;
  ph record;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  select lower(btrim(email)) into my_email from auth.users where id = auth.uid();
  select * into me from public.people where user_id = auth.uid();
  if not found then
    insert into public.people (user_id, name, email, created_by)
    values (auth.uid(), left(coalesce(nullif(btrim(p_name), ''), 'Me'), 80), my_email, auth.uid())
    on conflict (user_id) do nothing;
    select * into me from public.people where user_id = auth.uid();
  elsif me.email is distinct from my_email then
    update public.people set email = my_email where id = me.id returning * into me;
  end if;

  if my_email is not null then
    for ph in
      select id from public.people
      where user_id is null and public.normalize_email(email) = public.normalize_email(my_email)
      order by created_at
    loop
      begin
        perform public.merge_person(ph.id, me.id);
      exception when others then
        null; -- e.g. you're already in a group alongside that placeholder: leave it
      end;
    end loop;
  end if;
  return me;
end $$;

-- Add a friend by email. If they have an account they're added as
-- themselves; otherwise a placeholder is made (or reused) that links to them
-- when they first sign in. Either way they join your friends list.
create or replace function public.add_person_by_email(p_email text, p_name text default null)
returns public.people language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.my_person_id();
  k text := public.normalize_email(p_email);
  account uuid;
  pid uuid;
  target public.people;
begin
  if me is null then
    raise exception 'Not signed in';
  end if;
  if k is null or k !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Enter an email address like name@gmail.com.';
  end if;
  select u.id into account from auth.users u where public.normalize_email(u.email) = k limit 1;
  if account = auth.uid() then
    raise exception 'That''s your own email address.';
  end if;

  if account is not null then
    -- (two statements: the second must see a row the first may have just created)
    pid := public.person_for_account(account);
    select * into target from public.people where id = pid;
  else
    select * into target from public.people p
      where p.user_id is null and public.normalize_email(p.email) = k and public.can_see_person(p.id)
      order by p.created_at limit 1;
    if not found then
      insert into public.people (name, email, created_by)
      values (left(coalesce(nullif(btrim(p_name), ''), lower(btrim(p_email))), 80), lower(btrim(p_email)), auth.uid())
      returning * into target;
    end if;
  end if;

  insert into public.contacts (owner, person_id) values (auth.uid(), target.id) on conflict do nothing;
  if target.user_id is not null then
    insert into public.contacts (owner, person_id) values (target.user_id, me) on conflict do nothing;
  end if;
  return target;
end $$;

-- Give a placeholder an email (or clear it). If that email already has an
-- account, the placeholder is handed over to it straight away. Returns the
-- id the person now has.
create or replace function public.set_person_email(p_person uuid, p_email text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.my_person_id();
  ph public.people;
  k text := public.normalize_email(p_email);
  account uuid;
  real_person uuid;
begin
  if me is null then
    raise exception 'Not signed in';
  end if;
  select * into ph from public.people where id = p_person;
  if not found or not public.can_see_person(p_person) then
    raise exception 'That person isn''t one of your friends.';
  end if;
  if ph.user_id is not null then
    raise exception '% manages their own account.', ph.name;
  end if;
  if k is null then
    update public.people set email = null where id = p_person;
    return p_person;
  end if;
  if k !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Enter an email address like name@gmail.com.';
  end if;
  select u.id into account from auth.users u where public.normalize_email(u.email) = k limit 1;
  if account = auth.uid() then
    raise exception 'That''s your own email address.';
  end if;
  if account is null then
    update public.people set email = lower(btrim(p_email)) where id = p_person;
    return p_person;
  end if;
  real_person := public.person_for_account(account);
  perform public.merge_person(p_person, real_person);
  insert into public.contacts (owner, person_id) values (auth.uid(), real_person) on conflict do nothing;
  insert into public.contacts (owner, person_id) values (account, me) on conflict do nothing;
  return real_person;
end $$;

-- Add and remove group members in one step, against the group as it is now
-- (so a friend who just joined isn't dropped by someone saving an older
-- copy). People in the group's expenses or payments can't be removed, and
-- the person who created the group stays in it. Removing yourself = leaving.
create or replace function public.set_group_members(p_group uuid, p_add uuid[] default '{}', p_remove uuid[] default '{}')
returns uuid[] language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.my_person_id();
  g public.groups;
  creator_person uuid;
  members uuid[];
  x uuid;
begin
  if me is null then
    raise exception 'Not signed in';
  end if;
  select * into g from public.groups where id = p_group for update;
  if not found or not (me = any (g.member_ids)) then
    raise exception 'You are not in this group any more.';
  end if;
  select id into creator_person from public.people where user_id = g.created_by;
  members := g.member_ids;

  foreach x in array coalesce(p_remove, '{}'::uuid[]) loop
    continue when not (x = any (members));
    if x = creator_person then
      if x = me then
        raise exception 'You created this group, so you can''t leave it. You can delete it instead.';
      end if;
      raise exception 'The person who created this group can''t be removed.';
    end if;
    if exists (select 1 from public.expenses e where e.group_id = p_group and e.data::text like '%' || x::text || '%')
       or exists (select 1 from public.payments p where p.group_id = p_group and p.data::text like '%' || x::text || '%') then
      raise exception '% % in this group''s expenses or payments, so % can''t be removed.',
        case when x = me then 'You' else coalesce((select name from public.people where id = x), 'This person') end,
        case when x = me then 'are' else 'is' end,
        case when x = me then 'you' else 'they' end;
    end if;
    members := array_remove(members, x);
  end loop;

  foreach x in array coalesce(p_add, '{}'::uuid[]) loop
    continue when x = any (members);
    if not public.can_see_person(x) then
      raise exception 'You can only add your friends to a group.';
    end if;
    members := members || x;
  end loop;

  if members is distinct from g.member_ids then
    update public.groups set member_ids = members, updated_at = now() where id = p_group;
  end if;
  return members;
end $$;

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
  code text := left(replace(gen_random_uuid()::text, '-', ''), 12); -- 48 random bits, like before
begin
  if not public.is_member(p_group) then
    raise exception 'Not a member of this group';
  end if;
  update public.groups set invite_code = code where id = p_group;
  return code;
end $$;

-- Who can call what. New functions are callable by everyone by default in
-- Supabase, so start from nothing and allow signed-in people only.
revoke all on function public.merge_person(uuid, uuid), public.person_for_account(uuid)
  from public, anon, authenticated;
revoke all on function public.my_person_id(), public.is_member(uuid), public.can_see_person(uuid),
  public.ensure_me(text), public.add_person_by_email(text, text), public.set_person_email(uuid, text),
  public.set_group_members(uuid, uuid[], uuid[]), public.group_preview(text),
  public.join_group(text, uuid), public.reset_invite_code(uuid)
  from public, anon;
grant execute on function public.my_person_id(), public.is_member(uuid), public.can_see_person(uuid),
  public.ensure_me(text), public.add_person_by_email(text, text), public.set_person_email(uuid, text),
  public.set_group_members(uuid, uuid[], uuid[]), public.group_preview(text),
  public.join_group(text, uuid), public.reset_invite_code(uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Upgrading from version 1: friends were added by typing their email as a
-- name. Treat those as emails, and link the ones that already have accounts.

update public.people set email = lower(btrim(name))
  where user_id is null and email is null
    and btrim(name) ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$';

update public.people p set email = lower(btrim(u.email))
  from auth.users u
  where p.user_id = u.id and p.email is distinct from lower(btrim(u.email));

do $$
declare
  ph record;
  target uuid;
begin
  for ph in
    select p.id as placeholder, u.id as account
    from public.people p
    join auth.users u on public.normalize_email(u.email) = public.normalize_email(p.email)
    where p.user_id is null
    order by p.created_at
  loop
    begin
      target := public.person_for_account(ph.account);
      perform public.merge_person(ph.placeholder, target);
    exception when others then
      null; -- already in a group alongside that placeholder: leave it
    end;
  end loop;
end $$;

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
