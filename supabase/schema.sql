-- Cosmic Balance database (version 4)
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
--   person_invites  personal invite links for friends who haven't joined;
--              opening one and signing in links that person.
--   groups     member_ids lists the people in the group.
--   join_requests  people who opened a group's link and asked to join; the
--              person who created the group approves or declines.
--   expenses   the expense itself is stored as JSON in `data`.
--   payments   settle-up payments inside a group (JSON in `data`).
--   transfers  money between two people outside groups (JSON in `data`).
--   notifications  what happened that concerns you (no amounts), shown in
--              the app and sent to your phones.
--   push_subscriptions  the phones that asked for notifications.
--
-- Security: row level security on every table. You see a group only if you
-- are a member, and its expenses and payments with it. You see people who
-- share a group with you, your friends list, people you added, people you
-- have transfers with, and people asking to join a group you created. Group
-- members change only through set_group_members and approve_join_request.

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
-- Added in version 4: who gave a placeholder its email (they vouch it's that person).
alter table public.people add column if not exists email_set_by uuid references auth.users (id) on delete set null;
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

-- Added in version 3: one personal invite code per friend who hasn't joined.
-- Read and written only by the functions below; used once, then gone with
-- the placeholder.
create table if not exists public.person_invites (
  person_id uuid primary key references public.people (id) on delete cascade,
  code text not null unique,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

-- Added in version 4: asking to join a group from its link.
create table if not exists public.join_requests (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  person_id uuid not null references public.people (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (group_id, person_id)
);
create index if not exists join_requests_person_idx on public.join_requests (person_id);

-- Added in version 4: notifications. Written only by the functions below.
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  body text not null,
  group_id uuid references public.groups (id) on delete set null,
  person_id uuid references public.people (id) on delete set null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  pushed_at timestamptz
);
-- Who caused it (to limit how many one person can cause).
alter table public.notifications add column if not exists actor uuid references auth.users (id) on delete set null;
create index if not exists notifications_actor_idx on public.notifications (actor, user_id, created_at);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);
create index if not exists notifications_unpushed_idx on public.notifications (created_at) where pushed_at is null;

create table if not exists public.push_subscriptions (
  endpoint text primary key check (char_length(endpoint) <= 1000),
  user_id uuid not null references auth.users (id) on delete cascade,
  p256dh text not null check (char_length(p256dh) <= 200),
  auth text not null check (char_length(auth) <= 100),
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

-- The key pair push services use to check notifications come from us. Made
-- by the send-push function the first time it runs; the private half never
-- leaves the database and that function.
create table if not exists public.push_keys (
  id int primary key default 1 check (id = 1),
  public_key text not null,
  private_key jsonb not null,
  created_at timestamptz not null default now()
);

-- Where the send-push function lives (set below).
create table if not exists public.app_settings (
  key text primary key,
  value text
);

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

-- Who lets people in through a group's link: the person who created it (or,
-- if their account is gone, any member).
create or replace function public.can_approve(p_group uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.groups g
    where g.id = p_group
      and (g.created_by = auth.uid()
           or (g.created_by is null and public.my_person_id() = any (g.member_ids)))
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
      or exists (select 1 from public.join_requests r
                 where r.person_id = p_person and public.can_approve(r.group_id))
$$;

-- Who may say which account a friend added by name really is (give them an
-- email, send their personal invite, let someone in as them): whoever added
-- them, or someone in every group they're in. Linking an account to a name
-- puts it in all of that name's groups, so nobody can use it to get into a
-- group they aren't in themselves.
create or replace function public.speaks_for(p_person uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_user is not null and (
    exists (select 1 from public.people p where p.id = p_person and p.created_by = p_user)
    or (exists (select 1 from public.groups g where p_person = any (g.member_ids))
        and not exists (
          select 1 from public.groups g
          where p_person = any (g.member_ids)
            and not exists (select 1 from public.people m where m.user_id = p_user and m.id = any (g.member_ids)))))
$$;

-- Turns notifications off for the rest of a step (used while merging people,
-- which rewrites rows without anyone really changing them).
create or replace function public.set_quiet(p_on boolean)
returns void language plpgsql set search_path = public as $$
begin
  perform set_config('cosmic.quiet', case when p_on then 'on' else 'off' end, true);
end $$;

-- The signed-in person's name, for "Ravi added an expense".
create or replace function public.actor_name()
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select name from public.people where user_id = auth.uid()), 'Someone')
$$;

-- Tell these people (those with accounts, except whoever did it) something
-- happened. About a group, only its members are told. One person can cause at
-- most 30 notifications to someone in 10 minutes.
create or replace function public.notify_people(p_people uuid[], p_kind text, p_body text,
                                                p_group uuid default null, p_person uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  members uuid[];
  r uuid;
begin
  if coalesce(current_setting('cosmic.quiet', true), '') = 'on' then
    return;
  end if;
  if p_group is not null then
    select member_ids into members from public.groups where id = p_group;
  end if;
  for r in
    select distinct p.user_id from public.people p
    where p.id = any (coalesce(p_people, '{}'::uuid[])) and p.user_id is not null
      and p.user_id is distinct from auth.uid()
      and (p_group is null or p.id = any (coalesce(members, '{}'::uuid[])))
    order by p.user_id
  loop
    -- One at a time per sender and recipient, so changes made at the same
    -- moment can't get round the limits (30 in 10 minutes, 200 a day).
    perform pg_advisory_xact_lock(hashtextextended(coalesce(auth.uid()::text, '') || ':' || r::text, 0));
    continue when (select count(*) from public.notifications n
                   where n.actor = auth.uid() and n.user_id = r and n.created_at > now() - interval '10 minutes') >= 30
               or (select count(*) from public.notifications n
                   where n.actor = auth.uid() and n.user_id = r and n.created_at > now() - interval '1 day') >= 200;
    insert into public.notifications (user_id, kind, body, group_id, person_id, actor)
    values (r, p_kind, left(p_body, 300), p_group, p_person, auth.uid());
  end loop;
end $$;

-- Everyone in an expense: who paid and who shares it.
create or replace function public.expense_people(d jsonb)
returns uuid[] language sql immutable set search_path = public as $$
  select coalesce(array_agg(distinct x::uuid), '{}'::uuid[]) from (
    select jsonb_object_keys(case when jsonb_typeof(d -> 'payers') = 'object' then d -> 'payers' else '{}'::jsonb end) x
    union
    select jsonb_object_keys(case when jsonb_typeof(d -> 'shares') = 'object' then d -> 'shares' else '{}'::jsonb end)
    union
    select jsonb_array_elements_text(case when jsonb_typeof(d -> 'participants') = 'array' then d -> 'participants' else '[]'::jsonb end)
  ) s
  where x ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
$$;

-- ---------------------------------------------------------------------------
-- Row level security

alter table public.people enable row level security;
alter table public.groups enable row level security;
alter table public.expenses enable row level security;
alter table public.payments enable row level security;
alter table public.transfers enable row level security;
alter table public.contacts enable row level security;
alter table public.person_invites enable row level security; -- no policies: functions only
alter table public.join_requests enable row level security;
alter table public.notifications enable row level security;
alter table public.push_subscriptions enable row level security; -- no policies: functions only
alter table public.push_keys enable row level security;          -- no policies: functions only
alter table public.app_settings enable row level security;       -- no policies: functions only

-- You see your own requests, and requests to join groups you let people into.
drop policy if exists join_requests_select on public.join_requests;
create policy join_requests_select on public.join_requests for select to authenticated
  using (person_id = public.my_person_id() or public.can_approve(group_id));

drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications for select to authenticated
  using (user_id = auth.uid());

drop policy if exists people_select on public.people;
create policy people_select on public.people for select to authenticated
  using (public.can_see_person(id));

drop policy if exists people_insert on public.people;
create policy people_insert on public.people for insert to authenticated
  with check (created_by = auth.uid() and user_id is null);

-- You can edit yourself, and the name / UPI ID of friends added by name whom
-- you speak for (you added them, or you're in every group they're in).
-- Nobody can attach an account to a placeholder this way.
drop policy if exists people_update on public.people;
create policy people_update on public.people for update to authenticated
  using (user_id = auth.uid() or (user_id is null and public.speaks_for(id, auth.uid())))
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
revoke all on public.person_invites from anon, authenticated;
revoke insert, update, delete, truncate on public.join_requests, public.notifications from anon, authenticated;
revoke all on public.push_subscriptions, public.push_keys, public.app_settings from anon, authenticated;

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
  -- Rows are rewritten below but nothing really changes for anyone: no notifications.
  perform public.set_quiet(true);
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
  perform public.set_quiet(false);
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
      select id, created_by from public.people
      where user_id is null and public.normalize_email(email) = public.normalize_email(my_email)
        and public.speaks_for(id, coalesce(email_set_by, created_by))
      order by created_at
    loop
      begin
        perform public.merge_person(ph.id, me.id);
        -- Whoever added them hears that they've joined.
        if ph.created_by is not null and ph.created_by <> auth.uid() then
          insert into public.notifications (user_id, kind, body, person_id, actor)
          values (ph.created_by, 'joined', left(me.name || ' joined Cosmic Balance and is now linked to you', 300), me.id, auth.uid());
        end if;
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
      insert into public.people (name, email, created_by, email_set_by)
      values (left(coalesce(nullif(btrim(p_name), ''), lower(btrim(p_email))), 80), lower(btrim(p_email)), auth.uid(), auth.uid())
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
  if not public.speaks_for(p_person, auth.uid()) then
    raise exception '% is also in groups you''re not in, so only whoever added % can link them to an account.', ph.name, ph.name;
  end if;
  if k is null then
    update public.people set email = null, email_set_by = null where id = p_person;
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
    update public.people set email = lower(btrim(p_email)), email_set_by = auth.uid() where id = p_person;
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

-- Personal invite codes for friends who haven't joined (created when first
-- asked for). Only for placeholders you can see.
create or replace function public.person_invite_codes(p_people uuid[])
returns table (person_id uuid, code text)
language plpgsql security definer set search_path = public as $$
declare
  x uuid;
begin
  if public.my_person_id() is null then
    raise exception 'Not signed in';
  end if;
  foreach x in array coalesce(p_people, '{}'::uuid[]) loop
    continue when not exists (select 1 from public.people p where p.id = x and p.user_id is null)
                  or not public.can_see_person(x) or not public.speaks_for(x, auth.uid());
    -- A code made by someone who can't speak for them any more no longer works: make a new one.
    delete from public.person_invites i where i.person_id = x and not public.speaks_for(x, i.created_by);
    insert into public.person_invites (person_id, code, created_by)
    values (x, left(replace(gen_random_uuid()::text, '-', ''), 12), auth.uid())
    on conflict on constraint person_invites_pkey do nothing;
  end loop;
  return query
    select i.person_id, i.code from public.person_invites i
    where i.person_id = any (coalesce(p_people, '{}'::uuid[])) and public.can_see_person(i.person_id);
end $$;

-- What someone opening a personal invite sees before accepting it.
create or replace function public.person_invite_preview(p_code text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  i public.person_invites;
  ph public.people;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  select * into i from public.person_invites where code = p_code;
  if not found then
    return null;
  end if;
  select * into ph from public.people where id = i.person_id;
  return jsonb_build_object(
    'name', ph.name,
    'invited_by', coalesce((select name from public.people where user_id = i.created_by), 'A friend'),
    'mine', i.created_by = auth.uid(),
    'groups', coalesce((select jsonb_agg(g.name order by g.created_at) from public.groups g
                        where ph.id = any (g.member_ids)), '[]'::jsonb)
  );
end $$;

-- Accept a personal invite: become the person it was made for, with
-- everything recorded for them. Works once.
create or replace function public.claim_person_invite(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.my_person_id();
  i public.person_invites;
  ph public.people;
  first_group uuid;
begin
  if me is null then
    raise exception 'Not signed in';
  end if;
  select * into i from public.person_invites where code = p_code for update;
  if not found then
    raise exception 'This invite link has already been used. Ask whoever sent it to add you again.';
  end if;
  select * into ph from public.people where id = i.person_id;
  if ph.user_id is not null then
    raise exception 'This invite link has already been used. Ask whoever sent it to add you again.';
  end if;
  if i.created_by = auth.uid() then
    raise exception 'This is your own invite for %. Send it to them on WhatsApp.', ph.name;
  end if;
  if not public.speaks_for(ph.id, i.created_by) then
    -- They've since been added to a group whoever sent this isn't in. (A new
    -- code replaces this one when someone who can speak for them asks.)
    raise exception 'This invite is out of date. Ask whoever added you as % for a new one.', ph.name;
  end if;
  select g.id into first_group from public.groups g where ph.id = any (g.member_ids) order by g.created_at limit 1;
  perform public.merge_person(ph.id, me);
  -- The person who sent it and you are friends, even without a group.
  if i.created_by is not null then
    insert into public.contacts (owner, person_id) values (i.created_by, me) on conflict do nothing;
    insert into public.contacts (owner, person_id)
      select auth.uid(), p.id from public.people p where p.user_id = i.created_by
      on conflict do nothing;
    insert into public.notifications (user_id, kind, body, person_id, actor)
    values (i.created_by, 'joined', left(public.actor_name() || ' accepted your invite', 300), me, auth.uid());
  end if;
  return jsonb_build_object('group_id', first_group);
end $$;

-- What someone opening a group's link sees before asking to join. Only the
-- group's name, who runs it and how many are in it: who the members are stays
-- private until they're let in.
create or replace function public.group_preview(p_code text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  g public.groups;
  me uuid := public.my_person_id();
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
    'is_member', me = any (g.member_ids),
    'requested', exists (select 1 from public.join_requests r where r.group_id = g.id and r.person_id = me),
    'owner', coalesce((select name from public.people where user_id = g.created_by), 'the group'),
    'member_count', coalesce(array_length(g.member_ids, 1), 0),
    'members', '[]'::jsonb -- (older versions of the app listed members here)
  );
end $$;

-- Ask to join a group from its link. The person who created the group hears
-- about it and lets you in (or not).
create or replace function public.request_join(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.my_person_id();
  g public.groups;
  inserted uuid;
begin
  if me is null then
    raise exception 'Not signed in';
  end if;
  select * into g from public.groups where invite_code = p_code;
  if not found then
    raise exception 'This invite link is not valid any more. Ask for a new one.';
  end if;
  if me = any (g.member_ids) then
    return jsonb_build_object('group_id', g.id, 'status', 'member');
  end if;
  insert into public.join_requests (group_id, person_id) values (g.id, me)
    on conflict (group_id, person_id) do nothing
    returning id into inserted;
  -- (asking again after taking a request back doesn't notify again for a day)
  if inserted is not null and not exists (
    select 1 from public.notifications n
    where n.actor = auth.uid() and n.kind = 'request' and n.group_id = g.id and n.created_at > now() - interval '1 day'
  ) then
    if g.created_by is not null then
      insert into public.notifications (user_id, kind, body, group_id, actor)
      values (g.created_by, 'request', left(public.actor_name() || ' asked to join ' || g.name, 300), g.id, auth.uid());
    else
      perform public.notify_people(g.member_ids, 'request', public.actor_name() || ' asked to join ' || g.name, g.id);
    end if;
  end if;
  return jsonb_build_object('group_id', g.id, 'status', 'requested');
end $$;

-- Let someone in. Pass p_as to make them the placeholder that was added for
-- them (they take over everything recorded for it), or null to add them as a
-- new member.
create or replace function public.approve_join_request(p_request uuid, p_as uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  r public.join_requests;
  g public.groups;
  requester public.people;
  approver uuid := public.my_person_id();
begin
  if approver is null then
    raise exception 'Not signed in';
  end if;
  select * into r from public.join_requests where id = p_request for update;
  if not found then
    raise exception 'That request isn''t waiting any more.';
  end if;
  if not public.can_approve(r.group_id) then
    raise exception 'Only the person who created this group can let people in.';
  end if;
  select * into g from public.groups where id = r.group_id for update;
  select * into requester from public.people where id = r.person_id;
  delete from public.join_requests where id = r.id;
  if requester.id = any (g.member_ids) then
    return g.id;
  end if;
  if p_as is not null then
    if not (p_as = any (g.member_ids)) then
      raise exception 'That person isn''t in this group.';
    end if;
    if exists (select 1 from public.people where id = p_as and user_id is not null) then
      raise exception 'That person already has their own account.';
    end if;
    if not public.speaks_for(p_as, auth.uid()) then
      raise exception '% is also in groups you''re not in, so only whoever added % can link them. Let them in as someone new instead.',
        (select name from public.people where id = p_as), (select name from public.people where id = p_as);
    end if;
    perform public.merge_person(p_as, requester.id);
  else
    perform public.set_quiet(true);
    update public.groups set member_ids = member_ids || requester.id, updated_at = now() where id = g.id;
    perform public.set_quiet(false);
  end if;
  -- You're friends now, both ways.
  insert into public.contacts (owner, person_id) values (auth.uid(), requester.id) on conflict do nothing;
  if requester.user_id is not null then
    insert into public.contacts (owner, person_id) values (requester.user_id, approver) on conflict do nothing;
  end if;
  perform public.notify_people(array[requester.id], 'approved',
    public.actor_name() || ' let you into ' || g.name, g.id);
  return g.id;
end $$;

-- Turn a request down (whoever lets people in), or take back your own.
create or replace function public.decline_join_request(p_request uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  r public.join_requests;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  select * into r from public.join_requests where id = p_request;
  if not found then
    return;
  end if;
  if not (public.can_approve(r.group_id) or r.person_id = public.my_person_id()) then
    raise exception 'Only the person who created this group can turn requests down.';
  end if;
  delete from public.join_requests where id = p_request;
end $$;

-- Versions of the app before join requests joined straight away; they must
-- ask now like everyone else.
create or replace function public.join_group(p_code text, p_claim uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  raise exception 'Cosmic Balance has been updated. Close the app, open it again and ask to join.';
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

-- Remove a friend you're settled up with. They leave the groups you created
-- (only those without expenses or payments of theirs), money recorded between
-- you outside groups is cleared (it must add up to nothing), and they leave
-- your friends list. Not possible while they're in a group someone else
-- created, or in the expenses of one of yours.
create or replace function public.remove_friend(p_person uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.my_person_id();
  p public.people;
  g record;
  x text := p_person::text;
begin
  if me is null then
    raise exception 'Not signed in';
  end if;
  if p_person = me then
    raise exception 'You can''t remove yourself.';
  end if;
  select * into p from public.people where id = p_person;
  if not found or not public.can_see_person(p_person) then
    return; -- already gone
  end if;

  for g in select * from public.groups where me = any (member_ids) and p_person = any (member_ids) for update loop
    if g.created_by is distinct from auth.uid() then
      raise exception '% is in %, which % created. Ask them to take % out of that group first.',
        p.name, g.name, coalesce((select name from public.people where user_id = g.created_by), 'someone else'), p.name;
    end if;
    if exists (select 1 from public.expenses e where e.group_id = g.id and e.data::text like '%' || x || '%')
       or exists (select 1 from public.payments q where q.group_id = g.id and q.data::text like '%' || x || '%') then
      raise exception '% is in the expenses of %. To remove %, delete that group first.', p.name, g.name, p.name;
    end if;
  end loop;

  if exists (
    select 1 from (
      select t.data ->> 'currency' as cur,
             sum(case when t.from_person = me then (t.data ->> 'amount')::numeric
                      else -(t.data ->> 'amount')::numeric end) as total
      from public.transfers t
      where (t.from_person = me and t.to_person = p_person) or (t.from_person = p_person and t.to_person = me)
      group by 1
    ) s where s.total <> 0
  ) then
    raise exception 'You and % still have money to settle. Settle up first.', p.name;
  end if;

  -- Quietly: nothing changes for them that they need to hear about.
  perform public.set_quiet(true);
  update public.groups set member_ids = array_remove(member_ids, p_person), updated_at = now()
    where me = any (member_ids) and p_person = any (member_ids) and created_by = auth.uid();
  delete from public.transfers t
    where (t.from_person = me and t.to_person = p_person) or (t.from_person = p_person and t.to_person = me);
  delete from public.contacts where owner = auth.uid() and person_id = p_person;
  delete from public.join_requests r where r.person_id = p_person and public.can_approve(r.group_id);

  -- Someone you added who never joined: gone for good, unless others still use them.
  if p.user_id is null and p.created_by = auth.uid() then
    if exists (select 1 from public.groups where p_person = any (member_ids))
       or exists (select 1 from public.contacts where person_id = p_person)
       or exists (select 1 from public.transfers where p_person in (from_person, to_person))
       or exists (select 1 from public.expenses where data::text like '%' || x || '%')
       or exists (select 1 from public.payments where data::text like '%' || x || '%') then
      update public.people set created_by = null where id = p_person;
    else
      delete from public.people where id = p_person;
    end if;
  end if;
  perform public.set_quiet(false);

  if public.can_see_person(p_person) then
    raise exception '% is still part of something you can see (for example money you recorded between % and someone else), so they can''t be removed.', p.name, p.name;
  end if;
end $$;

-- Notifications ------------------------------------------------------------

create or replace function public.mark_notifications_read()
returns void language sql security definer set search_path = public as $$
  update public.notifications set read_at = now() where user_id = auth.uid() and read_at is null;
$$;

-- This phone wants notifications (or stops wanting them).
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  -- Only the browsers' own push services (and, in local tests only, this machine).
  if (p_endpoint !~ '^https://(fcm\.googleapis\.com|android\.googleapis\.com|[a-z0-9-]+(\.[a-z0-9-]+)*\.push\.apple\.com|updates\.push\.services\.mozilla\.com|[a-z0-9-]+(\.[a-z0-9-]+)*\.notify\.windows\.com)/[^@[:space:]]*$'
      and not (p_endpoint ~ '^http://localhost:[0-9]+/[^@[:space:]]*$'
               and exists (select 1 from public.app_settings where key = 'allow_local_push' and value = 'on')))
     or char_length(p_endpoint) > 1000
     or coalesce(char_length(p_p256dh), 0) not between 1 and 200
     or coalesce(char_length(p_auth), 0) not between 1 and 100 then
    raise exception 'That isn''t a notification address this app can use.';
  end if;
  insert into public.push_subscriptions (endpoint, user_id, p256dh, auth)
  values (p_endpoint, auth.uid(), p_p256dh, p_auth)
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
                                       created_at = now();
  -- At most 10 phones per person: the oldest go.
  delete from public.push_subscriptions
    where user_id = auth.uid()
      and endpoint not in (select endpoint from public.push_subscriptions where user_id = auth.uid()
                           order by created_at desc limit 10);
end $$;

create or replace function public.delete_push_subscription(p_endpoint text)
returns void language sql security definer set search_path = public as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
$$;

-- The public half of the push key pair (null until send-push has run once).
create or replace function public.push_public_key()
returns text language sql stable security definer set search_path = public as $$
  select public_key from public.push_keys where id = 1
$$;

-- For the send-push function only (it runs with the project's secret key).
create or replace function public.push_keys_get()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('public_key', public_key, 'private_key', private_key) from public.push_keys where id = 1
$$;

create or replace function public.push_keys_init(p_public text, p_private jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  insert into public.push_keys (id, public_key, private_key) values (1, p_public, p_private)
    on conflict (id) do nothing;
  return public.push_keys_get();
end $$;

-- Hands out notifications that haven't been sent to phones yet, each with
-- the phones to send it to, and marks them sent.
create or replace function public.claim_push_batch(p_limit int default 200)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  out jsonb;
begin
  delete from public.notifications where created_at < now() - interval '60 days';
  update public.notifications set pushed_at = now()
    where pushed_at is null and created_at < now() - interval '1 day';
  with batch as (
    select id from public.notifications
    where pushed_at is null
    order by created_at
    limit greatest(1, least(coalesce(p_limit, 200), 500))
    for update skip locked
  ), done as (
    update public.notifications n set pushed_at = now() from batch where n.id = batch.id
    returning n.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', d.id, 'kind', d.kind, 'body', d.body, 'group_id', d.group_id, 'person_id', d.person_id,
           'unread', (select count(*) from public.notifications u where u.user_id = d.user_id and u.read_at is null),
           'subscriptions', coalesce((select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth))
                                      from public.push_subscriptions s where s.user_id = d.user_id), '[]'::jsonb))), '[]'::jsonb)
    into out from done d;
  return out;
end $$;

-- A phone that's gone (uninstalled the app, turned notifications off).
create or replace function public.drop_push_subscription(p_endpoint text)
returns void language sql security definer set search_path = public as $$
  delete from public.push_subscriptions where endpoint = p_endpoint;
$$;

-- What happened, for the people it concerns ----------------------------------

create or replace function public.on_expense_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  gid uuid;
  gname text;
  who uuid[];
  verb text;
begin
  if auth.uid() is null then
    return null;
  end if;
  if tg_op = 'DELETE' then
    gid := old.group_id;
    who := public.expense_people(old.data);
    verb := 'deleted';
  elsif tg_op = 'INSERT' then
    gid := new.group_id;
    who := public.expense_people(new.data);
    verb := 'added';
  else
    if new.data is not distinct from old.data then
      return null;
    end if;
    gid := new.group_id;
    who := public.expense_people(new.data) || public.expense_people(old.data);
    verb := 'edited';
  end if;
  select name into gname from public.groups where id = gid;
  if gname is null then
    return null; -- the whole group is being deleted
  end if;
  perform public.notify_people(who, 'expense', public.actor_name() || ' ' || verb || ' an expense in ' || gname, gid);
  return null;
end $$;

create or replace function public.on_payment_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r public.payments;
  gname text;
begin
  if auth.uid() is null then
    return null;
  end if;
  r := case when tg_op = 'DELETE' then old else new end;
  if r.settlement_id is not null then
    return null; -- part of an overall settle-up: told once, with that
  end if;
  select name into gname from public.groups where id = r.group_id;
  if gname is null then
    return null;
  end if;
  perform public.notify_people(
    array[(r.data ->> 'from')::uuid, (r.data ->> 'to')::uuid], 'payment',
    public.actor_name() || case when tg_op = 'DELETE' then ' deleted a payment in ' else ' recorded a payment in ' end || gname,
    r.group_id);
  return null;
exception when invalid_text_representation then
  return null;
end $$;

create or replace function public.on_transfer_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r public.transfers;
  what text;
  verb text;
begin
  if auth.uid() is null then
    return null;
  end if;
  if tg_op = 'UPDATE' and new.data is not distinct from old.data
     and new.from_person = old.from_person and new.to_person = old.to_person then
    return null;
  end if;
  r := case when tg_op = 'DELETE' then old else new end;
  what := case when r.data ->> 'kind' = 'settlement' then 'a settle-up' else 'a transfer' end;
  verb := case tg_op when 'INSERT' then ' recorded ' when 'UPDATE' then ' edited ' else ' deleted ' end;
  perform public.notify_people(
    array[r.from_person, r.to_person] || case when tg_op = 'UPDATE' then array[old.from_person, old.to_person] else '{}'::uuid[] end,
    'transfer', public.actor_name() || verb || what || ' with you', null, public.my_person_id());
  return null;
end $$;

create or replace function public.on_group_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  added uuid[];
begin
  if auth.uid() is null then
    return null;
  end if;
  if tg_op = 'INSERT' then
    added := new.member_ids;
  else
    select coalesce(array_agg(m), '{}'::uuid[]) into added
      from unnest(new.member_ids) m where not (m = any (old.member_ids));
  end if;
  if cardinality(added) > 0 then
    perform public.notify_people(added, 'added', public.actor_name() || ' added you to ' || new.name, new.id);
  end if;
  return null;
end $$;

drop trigger if exists expenses_notify on public.expenses;
create trigger expenses_notify after insert or update or delete on public.expenses
  for each row execute function public.on_expense_change();
drop trigger if exists payments_notify on public.payments;
create trigger payments_notify after insert or delete on public.payments
  for each row execute function public.on_payment_change();
drop trigger if exists transfers_notify on public.transfers;
create trigger transfers_notify after insert or update or delete on public.transfers
  for each row execute function public.on_transfer_change();
drop trigger if exists groups_notify on public.groups;
create trigger groups_notify after insert or update of member_ids on public.groups
  for each row execute function public.on_group_change();

-- New notifications: ask the send-push function to deliver them to phones.
-- Needs the pg_net extension (turned on below when available); without it,
-- the app still asks for delivery after each change it makes.
create or replace function public.kick_push()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  url text;
begin
  if not exists (select 1 from new_rows) then
    return null; -- nobody to tell
  end if;
  select value into url from public.app_settings where key = 'push_function_url';
  if coalesce(url, '') = '' or to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then
    return null;
  end if;
  begin
    execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 8000)'
      using url, '{}'::jsonb, '{"Content-Type": "application/json"}'::jsonb;
  exception when others then
    null; -- delivery is best effort; the app asks again after its next change
  end;
  return null;
end $$;

drop trigger if exists notifications_push on public.notifications;
create trigger notifications_push after insert on public.notifications
  referencing new table as new_rows
  for each statement execute function public.kick_push();

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net with schema extensions;
  end if;
exception when others then
  raise notice 'pg_net could not be turned on (%). Turn it on under Database → Extensions.', sqlerrm;
end $$;

insert into public.app_settings (key, value)
values ('push_function_url', 'https://jwmnmrmocilfrqohhezf.supabase.co/functions/v1/send-push')
on conflict (key) do nothing;

-- Who can call what. New functions are callable by everyone by default in
-- Supabase, so start from nothing and allow signed-in people only.
revoke all on function public.merge_person(uuid, uuid), public.person_for_account(uuid),
  public.set_quiet(boolean), public.notify_people(uuid[], text, text, uuid, uuid), public.actor_name(),
  public.expense_people(jsonb), public.on_expense_change(), public.on_payment_change(),
  public.on_transfer_change(), public.on_group_change(), public.kick_push()
  from public, anon, authenticated;
-- Only the send-push function (with the project's secret key) uses these.
revoke all on function public.push_keys_get(), public.push_keys_init(text, jsonb),
  public.claim_push_batch(int), public.drop_push_subscription(text)
  from public, anon, authenticated;
grant execute on function public.push_keys_get(), public.push_keys_init(text, jsonb),
  public.claim_push_batch(int), public.drop_push_subscription(text)
  to service_role;
revoke all on function public.my_person_id(), public.is_member(uuid), public.can_see_person(uuid),
  public.can_approve(uuid), public.speaks_for(uuid, uuid),
  public.ensure_me(text), public.add_person_by_email(text, text), public.set_person_email(uuid, text),
  public.set_group_members(uuid, uuid[], uuid[]), public.group_preview(text),
  public.join_group(text, uuid), public.reset_invite_code(uuid),
  public.person_invite_codes(uuid[]), public.person_invite_preview(text), public.claim_person_invite(text),
  public.request_join(text), public.approve_join_request(uuid, uuid), public.decline_join_request(uuid),
  public.remove_friend(uuid), public.mark_notifications_read(),
  public.save_push_subscription(text, text, text), public.delete_push_subscription(text), public.push_public_key()
  from public, anon;
grant execute on function public.my_person_id(), public.is_member(uuid), public.can_see_person(uuid),
  public.can_approve(uuid), public.speaks_for(uuid, uuid),
  public.ensure_me(text), public.add_person_by_email(text, text), public.set_person_email(uuid, text),
  public.set_group_members(uuid, uuid[], uuid[]), public.group_preview(text),
  public.join_group(text, uuid), public.reset_invite_code(uuid),
  public.person_invite_codes(uuid[]), public.person_invite_preview(text), public.claim_person_invite(text),
  public.request_join(text), public.approve_join_request(uuid, uuid), public.decline_join_request(uuid),
  public.remove_friend(uuid), public.mark_notifications_read(),
  public.save_push_subscription(text, text, text), public.delete_push_subscription(text), public.push_public_key()
  to authenticated;

-- ---------------------------------------------------------------------------
-- Upgrading from version 1: friends were added by typing their email as a
-- name. Treat those as emails, and link the ones that already have accounts.

update public.people p set email = lower(btrim(u.email))
  from auth.users u
  where p.user_id = u.id and p.email is distinct from lower(btrim(u.email));

-- Runs once (a later rename can't be turned into an email this way).
do $$
declare
  ph record;
  target uuid;
begin
  if exists (select 1 from public.app_settings where key = 'v1_repair_done') then
    return;
  end if;
  update public.people set email = lower(btrim(name)), email_set_by = created_by
    where user_id is null and email is null
      and btrim(name) ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$';
  for ph in
    select p.id as placeholder, u.id as account
    from public.people p
    join auth.users u on public.normalize_email(u.email) = public.normalize_email(p.email)
    where p.user_id is null and public.speaks_for(p.id, coalesce(p.email_set_by, p.created_by))
    order by p.created_at
  loop
    begin
      target := public.person_for_account(ph.account);
      perform public.merge_person(ph.placeholder, target);
    exception when others then
      null; -- already in a group alongside that placeholder: leave it
    end;
  end loop;
  insert into public.app_settings (key, value) values ('v1_repair_done', now()::text) on conflict (key) do nothing;
end $$;

-- ---------------------------------------------------------------------------
-- Live updates: let the app hear about changes made by others.

do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['people', 'groups', 'expenses', 'payments', 'transfers', 'join_requests', 'notifications'] loop
      if not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
