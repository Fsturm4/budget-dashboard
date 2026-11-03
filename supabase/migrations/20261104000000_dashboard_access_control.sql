-- Access control: only signed-in users listed in dashboard_users can read or
-- change any dashboard data. Before this, the public anon key could read and
-- modify every table.
--
-- Apply only AFTER the dashboard's sign-in screen is deployed and the authorized
-- person has a Supabase Auth account. Exactly one account is authorized: the
-- email that replaces __AUTHORIZED_EMAIL__ in the SQL sent at apply time (kept
-- out of this public repository). It refuses to run if that account does not
-- exist or the placeholder was not filled in, so it cannot lock everyone out.

begin;

create table public.dashboard_users (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  email    text not null,
  added_at timestamptz not null default now()
);
alter table public.dashboard_users enable row level security;  -- no policies: read only by is_dashboard_user()
revoke all on public.dashboard_users from anon, authenticated;

insert into public.dashboard_users (user_id, email)
  select id, email from auth.users where lower(email) = lower('__AUTHORIZED_EMAIL__');

do $$
begin
  if (select count(*) from public.dashboard_users) <> 1 then
    raise exception 'The authorized email has no Supabase Auth account (or was not filled in), so this would lock everyone out. Nothing was changed.';
  end if;
end $$;

create function public.is_dashboard_user() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.dashboard_users where user_id = auth.uid())
$$;
revoke all on function public.is_dashboard_user() from public, anon;
grant execute on function public.is_dashboard_user() to authenticated;

-- Every dashboard table: no anonymous access; authorized users only.
do $$
declare
  t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' and tablename <> 'dashboard_users' loop
    execute format('alter table public.%I enable row level security', t.tablename);
    execute format('create policy dashboard_users_only on public.%I for all to authenticated
                    using (public.is_dashboard_user()) with check (public.is_dashboard_user())', t.tablename);
    execute format('revoke all on public.%I from anon', t.tablename);
  end loop;
end $$;
revoke all on all sequences in schema public from anon;

-- The data functions run as the signed-in user, so the policies above apply to
-- them too. Pending Review's functions are included if that migration is in place.
do $$
declare
  f record;
begin
  for f in select p.oid::regprocedure as signature
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public'
              and p.proname in ('upload_monthly_actuals', 'apply_correction', 'resolve_pending_item') loop
    execute format('alter function %s security invoker set search_path = public', f.signature);
    execute format('revoke execute on function %s from public, anon', f.signature);
    execute format('grant execute on function %s to authenticated', f.signature);
  end loop;
  if to_regclass('public.pending_items') is not null then
    grant insert, update on public.pending_items to authenticated;
    grant usage on sequence public.pending_items_id_seq to authenticated;
  end if;
end $$;

-- Tables and functions created later are not opened to anonymous users by default.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from public, anon;

notify pgrst, 'reload schema';

commit;
