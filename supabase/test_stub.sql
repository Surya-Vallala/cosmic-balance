-- A small stand-in for the parts of Supabase that schema.sql relies on, so
-- the access rules can be tested on a plain local Postgres (16+).
-- Roles (anon, authenticated, service_role) are created once per server:
--   create role anon nologin; create role authenticated nologin;
--   create role service_role nologin bypassrls;

create schema if not exists auth;

-- Like Supabase: extensions live in their own schema, which is on the search
-- path for the SQL editor but not inside functions that pin search_path.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
do $$
begin
  execute format('alter database %I set search_path = "$user", public, extensions', current_database());
end $$;

create table if not exists auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
-- (for stubs made before these columns were added)
alter table auth.users add column if not exists raw_user_meta_data jsonb not null default '{}'::jsonb;
alter table auth.users add column if not exists created_at timestamptz not null default now();

-- Like Supabase: the signed-in user's id from the request's JWT claims.
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(current_setting('request.jwt.claim.sub', true),
                         current_setting('request.jwt.claims', true)::jsonb ->> 'sub'), '')::uuid
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- Like Supabase: new tables and functions in public are open to the API
-- roles by default, so row level security and explicit revokes do the work.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;
