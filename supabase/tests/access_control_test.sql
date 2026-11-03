-- Database tests for 20261104000000_dashboard_access_control.sql. Run against a
-- local copy after the migration, where at least one authorized user exists.
-- Rolls everything back at the end. Any failed check stops the script.
\set ON_ERROR_STOP on
begin;

-- Runs p_sql as the given role and signed-in user; returns the error text, or 'ok'.
create function pg_temp.run_as(p_role text, p_user uuid, p_sql text) returns text language plpgsql as $$
declare
  v_result text := 'ok';
begin
  perform set_config('request.jwt.claims', coalesce(json_build_object('sub', p_user, 'role', p_role)::text, ''), true);
  execute format('set local role %I', p_role);
  begin
    execute p_sql;
  exception when others then
    v_result := sqlerrm;
  end;
  reset role;
  return v_result;
end $$;

create function pg_temp.count_as(p_role text, p_user uuid, p_table text) returns bigint language plpgsql as $$
declare
  v_count bigint;
begin
  perform set_config('request.jwt.claims', coalesce(json_build_object('sub', p_user, 'role', p_role)::text, ''), true);
  execute format('set local role %I', p_role);
  execute format('select count(*) from public.%I', p_table) into v_count;
  reset role;
  return v_count;
end $$;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000b', 'someone-else@example.com');

do $$
declare
  v_authorized uuid := (select user_id from public.dashboard_users limit 1);
  v_outsider   uuid := '00000000-0000-0000-0000-00000000000b';
  v_upload     text := $sql$select upload_monthly_actuals(2026, 12, '[]', '[]', '[{"category_slug":"education","amount_cents":1}]', '[]')$sql$;
  v_result     text;
  v_total      bigint;
  t            record;
begin
  -- Anonymous visitors (the public anon key): no table and no function.
  for t in select tablename from pg_tables where schemaname = 'public' loop
    v_result := pg_temp.run_as('anon', null, format('select 1 from public.%I limit 1', t.tablename));
    assert v_result like 'permission denied%', format('anon can read %s: %s', t.tablename, v_result);
    v_result := pg_temp.run_as('anon', null, format('delete from public.%I', t.tablename));
    assert v_result like 'permission denied%', format('anon can delete from %s: %s', t.tablename, v_result);
  end loop;
  assert pg_temp.run_as('anon', null, v_upload) like 'permission denied%', 'anon can call upload_monthly_actuals';
  assert pg_temp.run_as('anon', null, 'select apply_correction(1, ''postage'', ''turf_pro'', 2026, 1, 0, ''x'')') like 'permission denied%', 'anon can call apply_correction';

  -- Signed in but not on the list: sees nothing, changes nothing.
  for t in select tablename from pg_tables where schemaname = 'public' and tablename <> 'dashboard_users' loop
    assert pg_temp.count_as('authenticated', v_outsider, t.tablename) = 0, format('outsider can read %s', t.tablename);
  end loop;
  assert pg_temp.run_as('authenticated', v_outsider, 'select 1 from public.dashboard_users') like 'permission denied%', 'outsider can read dashboard_users';
  assert pg_temp.run_as('authenticated', v_outsider, v_upload) like '%row-level security%', 'outsider can upload';
  assert pg_temp.run_as('authenticated', v_outsider, 'insert into mappings (company, raw_label, category_slug) values (''turf_pro'', ''x'', ''education'')') like '%row-level security%', 'outsider can add a mapping';
  assert pg_temp.run_as('authenticated', v_outsider, format('select apply_correction(%s, ''postage'', ''turf_pro'', 2026, 1, 0, ''x'')', (select min(id) from actuals where status = 'active'))) like '%not found or already superseded%', 'outsider can correct an actual';
  v_total := (select sum(amount_cents) from actuals);
  perform pg_temp.run_as('authenticated', v_outsider, 'update actuals set amount_cents = 0');
  perform pg_temp.run_as('authenticated', v_outsider, 'delete from corrections');
  assert (select sum(amount_cents) from actuals) = v_total, 'outsider update changed actuals';
  assert (select count(*) from corrections) > 0, 'outsider delete removed corrections';

  -- Authorized user: full dashboard access, through the same functions as today.
  assert pg_temp.count_as('authenticated', v_authorized, 'actuals') = (select count(*) from actuals), 'authorized user sees all actuals';
  assert pg_temp.count_as('authenticated', v_authorized, 'categories') = (select count(*) from categories), 'authorized user sees all categories';
  v_result := pg_temp.run_as('authenticated', v_authorized, v_upload);
  assert v_result = 'ok', format('authorized upload failed: %s', v_result);
  v_result := pg_temp.run_as('authenticated', v_authorized, format('select apply_correction(%s, ''education'', ''turf_pro'', 2026, 12, 2, ''test'')',
    (select id from actuals where month = 12 and category_slug = 'education' and status = 'active')));
  assert v_result = 'ok', format('authorized correction failed: %s', v_result);
  v_result := pg_temp.run_as('authenticated', v_authorized, 'insert into mappings (company, raw_label, category_slug) values (''turf_pro'', ''test label'', ''education'')');
  assert v_result = 'ok', format('authorized mapping insert failed: %s', v_result);

  -- Every other write the dashboard makes today, exactly as PostgREST issues it.
  v_result := pg_temp.run_as('authenticated', v_authorized,   -- Settings: add or edit a mapping (upsert)
    'insert into mappings (company, raw_label, category_slug) values (''turf_pro'', ''test label'', ''postage'')
     on conflict (company, raw_label) do update set category_slug = excluded.category_slug returning *');
  assert v_result = 'ok' and (select category_slug from mappings where raw_label = 'test label') = 'postage', format('authorized mapping upsert failed: %s', v_result);
  v_result := pg_temp.run_as('authenticated', v_authorized,   -- Settings: save an assumption
    'insert into assumptions (assumption_key, display_name, value_text, notes) values (''test_key'', ''Test'', ''1'', null) returning *');
  assert v_result = 'ok', format('authorized assumption insert failed: %s', v_result);
  v_result := pg_temp.run_as('authenticated', v_authorized,   -- Upload: failed-unmapped audit record + raw lines
    'with u as (insert into uploads (company, year, month, status, source, unmapped_labels)
                values (''turf_pro'', 2026, 11, ''failed_unmapped'', ''quickbooks_upload'', array[''x'']) returning id)
     insert into raw_uploads (upload_id, raw_label, amount_cents) select id, ''x'', 1 from u returning *');
  assert v_result = 'ok', format('authorized failed-upload audit write failed: %s', v_result);
  v_result := pg_temp.run_as('authenticated', v_authorized,   -- Audit Log: corrections with their original actual
    'select c.*, a.upload_id, a.month, a.company, a.year, a.amount_cents
       from corrections c join actuals a on a.id = c.original_actual_id');
  assert v_result = 'ok', format('authorized audit read failed: %s', v_result);
  assert pg_temp.run_as('authenticated', v_authorized, 'select 1 from public.dashboard_users') like 'permission denied%', 'dashboard_users is not readable from the app';
end $$;

\echo 'All access control database tests passed.'
rollback;
