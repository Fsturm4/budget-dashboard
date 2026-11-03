-- Emergency undo of 20261104000000_dashboard_access_control.sql: restores the
-- previous open access (anon key can read and write everything). No financial
-- data is touched. Use only if signing in fails and the dashboard must work now.

begin;

do $$
declare
  t record;
  f record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' and tablename <> 'dashboard_users' loop
    execute format('drop policy if exists dashboard_users_only on public.%I', t.tablename);
    execute format('alter table public.%I disable row level security', t.tablename);
    if t.tablename = 'pending_items' then
      revoke insert, update on public.pending_items from authenticated;
      grant select on public.pending_items to anon;
    else
      execute format('grant all on public.%I to anon', t.tablename);
    end if;
  end loop;

  for f in select p.oid::regprocedure as signature
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public'
              and p.proname in ('upload_monthly_actuals', 'apply_correction', 'resolve_pending_item') loop
    execute format('alter function %s security definer', f.signature);
    execute format('grant execute on function %s to public, anon, authenticated', f.signature);
  end loop;
end $$;
grant all on all sequences in schema public to anon;

alter default privileges in schema public grant all on tables to anon;
alter default privileges in schema public grant all on sequences to anon;
alter default privileges in schema public grant execute on functions to public, anon;

drop function public.is_dashboard_user();
drop table public.dashboard_users;

notify pgrst, 'reload schema';

commit;
