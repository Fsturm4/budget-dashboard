-- Database tests for 20261106000000_reconcile_replace_actuals.sql. Run against a local copy of the
-- database after the Pending Review, access-control, intercompany and reconcile migrations. Uses
-- made-up amounts in April-September 2026 and rolls everything back at the end. Any failed check
-- stops the script.
\set ON_ERROR_STOP on
begin;

create function pg_temp.expect_error(p_sql text, p_message_like text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'expected an error like "%" but the statement succeeded', p_message_like;
exception when others then
  if sqlerrm not like p_message_like then
    raise exception 'expected an error like "%", got "%"', p_message_like, sqlerrm;
  end if;
end $$;

create function pg_temp.rid(p_file text) returns integer language sql as $$
  select max(id) from actuals_replacements where file_names = p_file
$$;

create function pg_temp.active_cents(p_company text, p_month integer, p_slug text) returns integer language sql as $$
  select amount_cents from actuals
   where company = p_company and category_slug = p_slug and year = 2026 and month = p_month and status = 'active'
$$;

-- Everything stored for a company, every status: any unintended write shows as a changed hash.
create function pg_temp.company_hash(p_company text) returns text language sql as $$
  select md5(coalesce(string_agg(a::text, '|' order by id), '')) from actuals a where company = p_company
$$;

-- One month of the p_months payload, with the fingerprint a preview would have captured.
create function pg_temp.month_json(p_company text, p_month integer, p_net integer, p_raw jsonb, p_after jsonb,
                                   p_pending jsonb default '[]', p_ack jsonb default '[]') returns jsonb language sql as $$
  select jsonb_build_object('month', p_month, 'qb_net_income_cents', p_net, 'raw_items', p_raw, 'pending', p_pending,
                            'expected_fingerprint', actuals_fingerprint(p_company, 2026, p_month),
                            'expected_after', p_after, 'acknowledged_corrections', p_ack)
$$;

-- Made-up categories and mappings (production's own categories are not in the baseline).
insert into categories (slug, display_name, section, display_order, variance_direction) values
  ('turf_pro_net_revenue',        'Turf Pro Net Revenue',        'revenue', 1, 'higher_is_better'),
  ('greenace_net_revenue',        'GreenAce Net Revenue',        'revenue', 2, 'higher_is_better'),
  ('subcontract_labor',           'Subcontract Labor',           'cogs',    1, 'lower_is_better'),
  ('insurance_health',            'Insurance - Health',          'opex',    1, 'lower_is_better'),
  ('insurance_general_liability', 'Insurance - General Liability','opex',   2, 'lower_is_better'),
  ('repairs_and_maintenance',     'Repairs & Maintenance (House)','opex',   3, 'lower_is_better'),
  ('office_expense',              'Office Expense',              'opex',    4, 'lower_is_better'),
  ('interest_income',             'Interest Income',             'other',   1, 'higher_is_better')
  on conflict (slug) do nothing;
insert into mappings (company, raw_label, category_slug) values
  ('turf_pro', '4000 Sales',                  'turf_pro_net_revenue'),
  ('turf_pro', '5050 Subcontract Labor',      'subcontract_labor'),
  ('turf_pro', '6235 Insurance - Health',     'insurance_health'),
  ('turf_pro', '6240 Insurance - Liability',  'insurance_general_liability'),
  ('turf_pro', '6700 Repairs and Maintenance','repairs_and_maintenance'),
  ('turf_pro', '6800 Office Expense',         'office_expense'),
  ('greenace', '4000 Sales',                  'greenace_net_revenue'),
  ('greenace', '6506 Insurance - Health',     'insurance_health')
  on conflict (company, raw_label) do nothing;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d1', 'owner@example.com'),
  ('00000000-0000-0000-0000-0000000000e1', 'stranger@example.com');
insert into dashboard_users (user_id, email) values ('00000000-0000-0000-0000-0000000000d1', 'owner@example.com');

-- Existing books, written through the real upload function as the signed-in owner.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}', true);
set local role authenticated;

select upload_monthly_actuals(2026, 4, '[]', '[]',
  '[{"category_slug":"turf_pro_net_revenue","amount_cents":1000000},{"category_slug":"insurance_health","amount_cents":258700},{"category_slug":"office_expense","amount_cents":100000}]',
  '[{"category_slug":"greenace_net_revenue","amount_cents":500000},{"category_slug":"insurance_health","amount_cents":20000}]');
select upload_monthly_actuals(2026, 5, '[]', '[]',
  '[{"category_slug":"turf_pro_net_revenue","amount_cents":900000},{"category_slug":"insurance_health","amount_cents":15725},{"category_slug":"office_expense","amount_cents":100000}]',
  '[{"category_slug":"greenace_net_revenue","amount_cents":400000}]');
select upload_monthly_actuals(2026, 6, '[]', '[]',
  '[{"category_slug":"turf_pro_net_revenue","amount_cents":950000},{"category_slug":"insurance_health","amount_cents":37550},{"category_slug":"office_expense","amount_cents":100000}]',
  '[{"category_slug":"greenace_net_revenue","amount_cents":400000}]');
select upload_monthly_actuals(2026, 7, '[]', '[]',
  '[{"category_slug":"turf_pro_net_revenue","amount_cents":1000000},{"category_slug":"subcontract_labor","amount_cents":500000},{"category_slug":"office_expense","amount_cents":100000}]',
  '[{"category_slug":"greenace_net_revenue","amount_cents":400000}]');
select upload_monthly_actuals(2026, 8, '[]', '[]',
  '[{"category_slug":"turf_pro_net_revenue","amount_cents":1000000},{"category_slug":"subcontract_labor","amount_cents":500000},{"category_slug":"insurance_health","amount_cents":99800},{"category_slug":"office_expense","amount_cents":100000}]',
  '[{"category_slug":"greenace_net_revenue","amount_cents":800000}]');
select upload_monthly_actuals(2026, 9, '[]', '[]',
  '[{"category_slug":"turf_pro_net_revenue","amount_cents":1000000},{"category_slug":"pending_opex","amount_cents":31500}]',
  '[{"category_slug":"greenace_net_revenue","amount_cents":400000}]',
  '[{"raw_label":"9999 Suspense","qb_section":"Expenses","amount_cents":31500}]', '[]');
-- July already carries a separate correction (Subcontract Labor 500000 -> 515000), as in production.
select apply_correction((select id from actuals where company = 'turf_pro' and month = 7 and category_slug = 'subcontract_labor' and status = 'active'),
  'subcontract_labor', 'turf_pro', 2026, 7, 515000, 'CT Landscaping $5,000 and Tree Tech $150');
-- A $3,000 intercompany check in August (Turf Pro Subcontract Labor / GreenAce Net Revenue).
select record_intercompany_transfer(2026, 8, '9001', '2026-08-04', 300000, '2026-08-04', 'DEP1', 300000, 'test');

reset role;
create temp table ga_hash as select pg_temp.company_hash('greenace') as h;
create temp table elim_before as select * from active_intercompany_eliminations;
grant select on ga_hash, elim_before to authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}', true);
set local role authenticated;

-- 1. An unmapped account stops the replacement, names the account, and writes nothing.
select pg_temp.expect_error($$
  select replace_company_actuals('turf_pro', 2026, 'tp-april.xlsx', 'Corrected April', jsonb_build_array(
    pg_temp.month_json('turf_pro', 4, 641300,
      '[{"raw_label":"4000 Sales","qb_section":"Income","amount_cents":1000000},{"raw_label":"6233 Insurance - General","qb_section":"Expenses","amount_cents":258700},{"raw_label":"6800 Office Expense","qb_section":"Expenses","amount_cents":100000}]',
      '[{"category_slug":"turf_pro_net_revenue","amount_cents":1000000},{"category_slug":"insurance_general_liability","amount_cents":258700},{"category_slug":"office_expense","amount_cents":100000}]')))
$$, '%none was approved for: "6233 Insurance - General"%');
do $$ begin
  assert (select count(*) from actuals_replacements) = 0, 'rejected replacement left no audit row';
  assert pg_temp.active_cents('turf_pro', 4, 'insurance_health') = 258700, 'April untouched after rejection';
  assert not exists (select 1 from mappings where raw_label like '6233%'), 'no mapping was guessed';
end $$;

-- 2. A mapping approved into the wrong section, or over an existing mapping, is refused.
select pg_temp.expect_error($$
  select replace_company_actuals('turf_pro', 2026, 'tp-april.xlsx', 'x', jsonb_build_array(
    pg_temp.month_json('turf_pro', 4, 641300,
      '[{"raw_label":"4000 Sales","qb_section":"Income","amount_cents":1000000},{"raw_label":"6233 Insurance - General","qb_section":"Expenses","amount_cents":258700},{"raw_label":"6800 Office Expense","qb_section":"Expenses","amount_cents":100000}]',
      '[]')),
    '[{"raw_label":"6233 Insurance - General","qb_section":"Expenses","category_slug":"subcontract_labor"}]')
$$, '%does not belong in the Expenses section%');
select pg_temp.expect_error($$
  select replace_company_actuals('turf_pro', 2026, 'tp-april.xlsx', 'x', jsonb_build_array(
    pg_temp.month_json('turf_pro', 4, 641300, '[]', '[]')),
    '[{"raw_label":"6240 Insurance - Liability","qb_section":"Expenses","category_slug":"insurance_health"}]')
$$, '%already mapped%');

-- 3. Totals that do not reproduce QuickBooks' Net Income are refused.
select pg_temp.expect_error($$
  select replace_company_actuals('turf_pro', 2026, 'tp-april.xlsx', 'x', jsonb_build_array(
    pg_temp.month_json('turf_pro', 4, 999999,
      '[{"raw_label":"4000 Sales","qb_section":"Income","amount_cents":1000000},{"raw_label":"6233 Insurance - General","qb_section":"Expenses","amount_cents":258700},{"raw_label":"6800 Office Expense","qb_section":"Expenses","amount_cents":100000}]',
      '[{"category_slug":"turf_pro_net_revenue","amount_cents":1000000},{"category_slug":"insurance_general_liability","amount_cents":258700},{"category_slug":"office_expense","amount_cents":100000}]')),
    '[{"raw_label":"6233 Insurance - General","qb_section":"Expenses","category_slug":"insurance_general_liability"}]')
$$, '%QuickBooks reports%');

-- 4. A preview that differs from what the database computes is refused.
select pg_temp.expect_error($$
  select replace_company_actuals('turf_pro', 2026, 'tp-april.xlsx', 'x', jsonb_build_array(
    pg_temp.month_json('turf_pro', 4, 641300,
      '[{"raw_label":"4000 Sales","qb_section":"Income","amount_cents":1000000},{"raw_label":"6233 Insurance - General","qb_section":"Expenses","amount_cents":258700},{"raw_label":"6800 Office Expense","qb_section":"Expenses","amount_cents":100000}]',
      '[{"category_slug":"turf_pro_net_revenue","amount_cents":1000000},{"category_slug":"insurance_health","amount_cents":258700},{"category_slug":"office_expense","amount_cents":100000}]')),
    '[{"raw_label":"6233 Insurance - General","qb_section":"Expenses","category_slug":"insurance_general_liability"}]')
$$, '%differ from the preview%');

-- 5. A stale preview (stored figures changed after it was made) is refused.
select pg_temp.expect_error($$
  select replace_company_actuals('turf_pro', 2026, 'tp-april.xlsx', 'x', jsonb_build_array(
    jsonb_set(pg_temp.month_json('turf_pro', 4, 641300,
      '[{"raw_label":"4000 Sales","qb_section":"Income","amount_cents":1000000},{"raw_label":"6233 Insurance - General","qb_section":"Expenses","amount_cents":258700},{"raw_label":"6800 Office Expense","qb_section":"Expenses","amount_cents":100000}]',
      '[{"category_slug":"turf_pro_net_revenue","amount_cents":1000000},{"category_slug":"insurance_general_liability","amount_cents":258700},{"category_slug":"office_expense","amount_cents":100000}]'),
      '{expected_fingerprint}', '"stale"')),
    '[{"raw_label":"6233 Insurance - General","qb_section":"Expenses","category_slug":"insurance_general_liability"}]')
$$, '%changed after this preview%');

-- 6. A month with nothing stored, an unknown company, a repeated month, and a non-reviewer are refused.
select pg_temp.expect_error($$
  select replace_company_actuals('turf_pro', 2026, 'f.xlsx', 'x', jsonb_build_array(
    jsonb_build_object('month', 11, 'qb_net_income_cents', 0, 'raw_items', '[]'::jsonb, 'expected_fingerprint', 'x', 'expected_after', '[]'::jsonb)))
$$, '%has no stored figures%');
select pg_temp.expect_error($$ select replace_company_actuals('acme', 2026, 'f.xlsx', 'x', '[{"month":4}]') $$, 'Unknown company%');
select pg_temp.expect_error($$
  select replace_company_actuals('turf_pro', 2026, 'f.xlsx', 'x', jsonb_build_array(
    jsonb_build_object('month', 4, 'qb_net_income_cents', 0, 'raw_items', '[]'::jsonb, 'expected_fingerprint', actuals_fingerprint('turf_pro', 2026, 4), 'expected_after', '[]'::jsonb),
    jsonb_build_object('month', 4, 'qb_net_income_cents', 0, 'raw_items', '[]'::jsonb, 'expected_fingerprint', 'x', 'expected_after', '[]'::jsonb)))
$$, '%more than once%');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}', true);
select pg_temp.expect_error($$ select replace_company_actuals('turf_pro', 2026, 'f.xlsx', 'x', '[{"month":4}]') $$, 'Not authorized');
select pg_temp.expect_error($$ select restore_actuals_replacement(0, 'x') $$, 'Not authorized');
reset role;
set local role anon;
select pg_temp.expect_error($$ select replace_company_actuals('turf_pro', 2026, 'f.xlsx', 'x', '[{"month":4}]') $$, 'permission denied%');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}', true);
set local role authenticated;

-- 7. Replace one company-month: April moves $2,587.00 from Insurance - Health to the new account
--    6233 (approved by the user as General Liability). Adds a category with no prior row and
--    removes one that is now zero. Net income is unchanged.
select replace_company_actuals('turf_pro', 2026, 'tp-april.xlsx', 'QuickBooks recategorized', jsonb_build_array(
  pg_temp.month_json('turf_pro', 4, 641300,
    '[{"raw_label":"4000 Sales","qb_section":"Income","amount_cents":1000000},{"raw_label":"6233 Insurance - General","qb_section":"Expenses","amount_cents":258700},{"raw_label":"6800 Office Expense","qb_section":"Expenses","amount_cents":100000}]',
    '[{"category_slug":"turf_pro_net_revenue","amount_cents":1000000},{"category_slug":"insurance_general_liability","amount_cents":258700},{"category_slug":"office_expense","amount_cents":100000}]')),
  '[{"raw_label":"6233 Insurance - General","qb_section":"Expenses","category_slug":"insurance_general_liability"}]');
do $$ begin
  assert pg_temp.active_cents('turf_pro', 4, 'insurance_general_liability') = 258700, 'category with no prior row now active';
  assert pg_temp.active_cents('turf_pro', 4, 'insurance_health') is null, 'zeroed category has no active row';
  assert pg_temp.active_cents('turf_pro', 4, 'turf_pro_net_revenue') = 1000000, 'unchanged category untouched';
  assert (select status from actuals where company = 'turf_pro' and month = 4 and category_slug = 'insurance_health') = 'superseded', 'old row kept as superseded';
  assert (select count(*) from actuals where company = 'turf_pro' and month = 4 and category_slug = 'turf_pro_net_revenue') = 1, 'unchanged row not duplicated';
  assert (select count(*) from mappings where raw_label = '6233 Insurance - General' and category_slug = 'insurance_general_liability') = 1, 'approved mapping saved';
  assert (select count(*) from actuals_replacement_mappings) = 1, 'mapping approval audited';
  assert (select count(*) from actuals_replacement_lines where replacement_id = pg_temp.rid('tp-april.xlsx')) = 2, 'two changed categories recorded';
  assert (select before_cents from actuals_replacement_lines where month = 4 and category_slug = 'insurance_health') = 258700
     and (select after_cents from actuals_replacement_lines where month = 4 and category_slug = 'insurance_general_liability') = 258700, 'before and after amounts recorded';
  assert (select count(*) from uploads where source = 'reconciliation' and month = 4 and company = 'turf_pro') = 1, 'upload record written';
  assert (select count(*) from raw_uploads r join uploads u on u.id = r.upload_id where u.source = 'reconciliation' and u.month = 4) = 3, 'raw QuickBooks lines kept';
  assert (select file_names from actuals_replacements where id = pg_temp.rid('tp-april.xlsx')) = 'tp-april.xlsx', 'file name audited';
  assert pg_temp.company_hash('greenace') = (select h from ga_hash), 'GreenAce unchanged (every row, every status)';
end $$;

-- 8. The same report again is "identical" (fingerprint is current, no differences).
select pg_temp.expect_error($$
  select replace_company_actuals('turf_pro', 2026, 'tp-april.xlsx', 'again', jsonb_build_array(
    pg_temp.month_json('turf_pro', 4, 641300,
      '[{"raw_label":"4000 Sales","qb_section":"Income","amount_cents":1000000},{"raw_label":"6233 Insurance - General","qb_section":"Expenses","amount_cents":258700},{"raw_label":"6800 Office Expense","qb_section":"Expenses","amount_cents":100000}]',
      '[{"category_slug":"turf_pro_net_revenue","amount_cents":1000000},{"category_slug":"insurance_general_liability","amount_cents":258700},{"category_slug":"office_expense","amount_cents":100000}]')))
$$, '%identical%');
-- ...and replaying the first preview (old fingerprint) is stale.
select pg_temp.expect_error($$
  select replace_company_actuals('turf_pro', 2026, 'tp-april.xlsx', 'replay', jsonb_build_array(
    jsonb_set(pg_temp.month_json('turf_pro', 4, 641300,
      '[{"raw_label":"4000 Sales","qb_section":"Income","amount_cents":1000000},{"raw_label":"6233 Insurance - General","qb_section":"Expenses","amount_cents":258700},{"raw_label":"6800 Office Expense","qb_section":"Expenses","amount_cents":100000}]',
      '[{"category_slug":"turf_pro_net_revenue","amount_cents":1000000},{"category_slug":"insurance_general_liability","amount_cents":258700},{"category_slug":"office_expense","amount_cents":100000}]'),
      '{expected_fingerprint}', to_jsonb((select before_fingerprint from actuals_replacement_months where month = 4)))))
$$, '%changed after this preview%');

-- 9. Atomic: when the second month fails, the first month is not replaced either.
select pg_temp.expect_error($$
  select replace_company_actuals('turf_pro', 2026, 'tp-may-jun.xlsx', 'x', jsonb_build_array(
    pg_temp.month_json('turf_pro', 5, 784275,
      '[{"raw_label":"4000 Sales","qb_section":"Income","amount_cents":900000},{"raw_label":"6700 Repairs and Maintenance","qb_section":"Expenses","amount_cents":15725},{"raw_label":"6800 Office Expense","qb_section":"Expenses","amount_cents":100000}]',
      '[{"category_slug":"turf_pro_net_revenue","amount_cents":900000},{"category_slug":"repairs_and_maintenance","amount_cents":15725},{"category_slug":"office_expense","amount_cents":100000}]'),
    pg_temp.month_json('turf_pro', 6, 1,
      '[{"raw_label":"4000 Sales","qb_section":"Income","amount_cents":950000},{"raw_label":"6700 Repairs and Maintenance","qb_section":"Expenses","amount_cents":37550},{"raw_label":"6800 Office Expense","qb_section":"Expenses","amount_cents":100000}]',
      '[{"category_slug":"turf_pro_net_revenue","amount_cents":950000},{"category_slug":"repairs_and_maintenance","amount_cents":37550},{"category_slug":"office_expense","amount_cents":100000}]')))
$$, '%QuickBooks reports%');
do $$ begin
  assert pg_temp.active_cents('turf_pro', 5, 'insurance_health') = 15725, 'May untouched after a failed multi-month call';
  assert (select count(*) from actuals_replacements) = 1, 'no partial replacement recorded';
end $$;

-- 10. Replace multiple months in one call.
select replace_company_actuals('turf_pro', 2026, 'tp-may-jun.xlsx', 'QuickBooks recategorized', jsonb_build_array(
  pg_temp.month_json('turf_pro', 5, 784275,
    '[{"raw_label":"4000 Sales","qb_section":"Income","amount_cents":900000},{"raw_label":"6700 Repairs and Maintenance","qb_section":"Expenses","amount_cents":15725},{"raw_label":"6800 Office Expense","qb_section":"Expenses","amount_cents":100000}]',
    '[{"category_slug":"turf_pro_net_revenue","amount_cents":900000},{"category_slug":"repairs_and_maintenance","amount_cents":15725},{"category_slug":"office_expense","amount_cents":100000}]'),
  pg_temp.month_json('turf_pro', 6, 812450,
    '[{"raw_label":"4000 Sales","qb_section":"Income","amount_cents":950000},{"raw_label":"6700 Repairs and Maintenance","qb_section":"Expenses","amount_cents":37550},{"raw_label":"6800 Office Expense","qb_section":"Expenses","amount_cents":100000}]',
    '[{"category_slug":"turf_pro_net_revenue","amount_cents":950000},{"category_slug":"repairs_and_maintenance","amount_cents":37550},{"category_slug":"office_expense","amount_cents":100000}]')));
do $$ begin
  assert pg_temp.active_cents('turf_pro', 5, 'repairs_and_maintenance') = 15725 and pg_temp.active_cents('turf_pro', 6, 'repairs_and_maintenance') = 37550, 'both months replaced';
  assert pg_temp.active_cents('turf_pro', 5, 'insurance_health') is null and pg_temp.active_cents('turf_pro', 6, 'insurance_health') is null, 'old category cleared in both months';
  assert (select count(*) from actuals_replacement_months where replacement_id = pg_temp.rid('tp-may-jun.xlsx')) = 2, 'both months audited under one replacement';
  assert pg_temp.company_hash('greenace') = (select h from ga_hash), 'GreenAce still unchanged';
end $$;

-- 11. July holds a separate correction. Reverting it needs explicit acknowledgement, and is
--     otherwise left exactly as it is when the corrected report agrees with it.
select pg_temp.expect_error($$
  select replace_company_actuals('turf_pro', 2026, 'tp-july.xlsx', 'x', jsonb_build_array(
    pg_temp.month_json('turf_pro', 7, 400000,
      '[{"raw_label":"4000 Sales","qb_section":"Income","amount_cents":1000000},{"raw_label":"5050 Subcontract Labor","qb_section":"Cost of Goods Sold","amount_cents":500000},{"raw_label":"6800 Office Expense","qb_section":"Expenses","amount_cents":100000}]',
      '[{"category_slug":"turf_pro_net_revenue","amount_cents":1000000},{"category_slug":"subcontract_labor","amount_cents":500000},{"category_slug":"office_expense","amount_cents":100000}]')))
$$, '%set by an earlier correction%');
select pg_temp.expect_error($$
  select replace_company_actuals('turf_pro', 2026, 'tp-july.xlsx', 'x', jsonb_build_array(
    pg_temp.month_json('turf_pro', 7, 385000,
      '[{"raw_label":"4000 Sales","qb_section":"Income","amount_cents":1000000},{"raw_label":"5050 Subcontract Labor","qb_section":"Cost of Goods Sold","amount_cents":515000},{"raw_label":"6800 Office Expense","qb_section":"Expenses","amount_cents":100000}]',
      '[{"category_slug":"turf_pro_net_revenue","amount_cents":1000000},{"category_slug":"subcontract_labor","amount_cents":515000},{"category_slug":"office_expense","amount_cents":100000}]')))
$$, '%identical%');
do $$ begin
  assert pg_temp.active_cents('turf_pro', 7, 'subcontract_labor') = 515000, 'July correction still in force';
end $$;

-- 12. Intercompany: August's Subcontract Labor rises by the reclassified amount, the $3,000
--     elimination is untouched, and a report that would shrink it below the elimination is refused.
select pg_temp.expect_error($$
  select replace_company_actuals('turf_pro', 2026, 'tp-aug.xlsx', 'x', jsonb_build_array(
    pg_temp.month_json('turf_pro', 8, 700000,
      '[{"raw_label":"4000 Sales","qb_section":"Income","amount_cents":1000000},{"raw_label":"5050 Subcontract Labor","qb_section":"Cost of Goods Sold","amount_cents":200000},{"raw_label":"6800 Office Expense","qb_section":"Expenses","amount_cents":100000}]',
      '[{"category_slug":"turf_pro_net_revenue","amount_cents":1000000},{"category_slug":"subcontract_labor","amount_cents":200000},{"category_slug":"office_expense","amount_cents":100000}]')))
$$, '%larger than the figure it eliminates%');
do $$ begin
  assert pg_temp.active_cents('turf_pro', 8, 'subcontract_labor') = 500000, 'refused intercompany replacement wrote nothing';
end $$;
select replace_company_actuals('turf_pro', 2026, 'tp-aug.xlsx', 'QuickBooks recategorized', jsonb_build_array(
  pg_temp.month_json('turf_pro', 8, 300200,
    '[{"raw_label":"4000 Sales","qb_section":"Income","amount_cents":1000000},{"raw_label":"5050 Subcontract Labor","qb_section":"Cost of Goods Sold","amount_cents":599800},{"raw_label":"6800 Office Expense","qb_section":"Expenses","amount_cents":100000}]',
    '[{"category_slug":"turf_pro_net_revenue","amount_cents":1000000},{"category_slug":"subcontract_labor","amount_cents":599800},{"category_slug":"office_expense","amount_cents":100000}]')));
do $$ begin
  assert pg_temp.active_cents('turf_pro', 8, 'subcontract_labor') = 599800, 'August Subcontract Labor increased (COGS)';
  assert pg_temp.active_cents('turf_pro', 8, 'insurance_health') is null, 'August Insurance - Health cleared';
  assert not exists ((select * from active_intercompany_eliminations except select * from elim_before)
                     union all (select * from elim_before except select * from active_intercompany_eliminations)), 'intercompany eliminations unchanged';
  assert pg_temp.company_hash('greenace') = (select h from ga_hash), 'GreenAce still unchanged after August';
end $$;

-- 13. Pending Review: an unmapped account kept in Pending Review by explicit approval replaces the old one.
select pg_temp.expect_error($$
  select replace_company_actuals('turf_pro', 2026, 'tp-sep.xlsx', 'x', jsonb_build_array(
    pg_temp.month_json('turf_pro', 9, 963500,
      '[{"raw_label":"4000 Sales","qb_section":"Income","amount_cents":1000000},{"raw_label":"9999 Suspense","qb_section":"Expenses","amount_cents":31500},{"raw_label":"6800 Office Expense","qb_section":"Expenses","amount_cents":5000}]',
      '[{"category_slug":"turf_pro_net_revenue","amount_cents":1000000},{"category_slug":"pending_opex","amount_cents":31500},{"category_slug":"office_expense","amount_cents":5000}]')))
$$, '%none was approved for%');
select replace_company_actuals('turf_pro', 2026, 'tp-sep.xlsx', 'Added office expense', jsonb_build_array(
  pg_temp.month_json('turf_pro', 9, 963500,
    '[{"raw_label":"4000 Sales","qb_section":"Income","amount_cents":1000000},{"raw_label":"9999 Suspense","qb_section":"Expenses","amount_cents":31500},{"raw_label":"6800 Office Expense","qb_section":"Expenses","amount_cents":5000}]',
    '[{"category_slug":"turf_pro_net_revenue","amount_cents":1000000},{"category_slug":"pending_opex","amount_cents":31500},{"category_slug":"office_expense","amount_cents":5000}]',
    '[{"raw_label":"9999 Suspense","qb_section":"Expenses","amount_cents":31500}]')));
do $$ begin
  assert pg_temp.active_cents('turf_pro', 9, 'pending_opex') = 31500 and pg_temp.active_cents('turf_pro', 9, 'office_expense') = 5000, 'September replaced';
  assert (select count(*) from pending_items where month = 9 and status = 'pending') = 1, 'exactly one pending item (no duplicate)';
  assert (select count(*) from pending_items where month = 9 and status = 'resolved') = 0, 'an unchanged pending account is left untouched, not closed and re-created';
  assert (select amount_cents from pending_items where month = 9 and status = 'pending') = 31500, 'pending amount preserved';
  assert pg_temp.active_cents('turf_pro', 9, 'pending_opex') = 31500, 'pending amount still counted in September totals';
end $$;

-- 14. A later correction blocks restoring the replacement it follows.
select apply_correction((select id from actuals where company = 'turf_pro' and month = 5 and category_slug = 'repairs_and_maintenance' and status = 'active'),
  'repairs_and_maintenance', 'turf_pro', 2026, 5, 20000, 'later fix');
select pg_temp.expect_error($$ select restore_actuals_replacement(pg_temp.rid('tp-may-jun.xlsx'), 'undo') $$, '%changed after this replacement%');
do $$ begin
  assert pg_temp.active_cents('turf_pro', 6, 'repairs_and_maintenance') = 37550, 'refused restore changed nothing (June)';
end $$;

-- 15. Restore the April replacement: previous figures return as new active rows; history is kept.
select restore_actuals_replacement(pg_temp.rid('tp-april.xlsx'), 'Wrong file');
do $$ begin
  assert pg_temp.active_cents('turf_pro', 4, 'insurance_health') = 258700, 'Insurance - Health restored';
  assert pg_temp.active_cents('turf_pro', 4, 'insurance_general_liability') is null, 'General Liability row removed again';
  assert (select status from actuals_replacements where id = pg_temp.rid('tp-april.xlsx')) = 'restored', 'replacement marked restored';
  assert (select count(*) from actuals where company = 'turf_pro' and month = 4 and category_slug = 'insurance_health') = 2 and (select count(*) from actuals where company = 'turf_pro' and month = 4 and category_slug = 'insurance_general_liability' and status = 'superseded') = 1, 'original, restored and superseded replacement rows all kept';
  assert (select count(*) from actuals_replacement_lines where replacement_id = pg_temp.rid('tp-april.xlsx')) = 2, 'audit lines kept';
  assert (select restore_reason from actuals_replacements where id = pg_temp.rid('tp-april.xlsx')) = 'Wrong file', 'restore reason kept';
  assert pg_temp.company_hash('greenace') = (select h from ga_hash), 'GreenAce unchanged through restore';
end $$;
select pg_temp.expect_error($$ select restore_actuals_replacement(pg_temp.rid('tp-april.xlsx'), 'again') $$, '%already restored%');

-- 16. Restoring the September replacement brings the earlier pending item back exactly once.
select restore_actuals_replacement(pg_temp.rid('tp-sep.xlsx'), 'undo September');
do $$ begin
  assert pg_temp.active_cents('turf_pro', 9, 'office_expense') is null and pg_temp.active_cents('turf_pro', 9, 'pending_opex') = 31500, 'September back to original';
  assert (select count(*) from pending_items where month = 9 and status = 'pending') = 1, 'one pending item after restore';
end $$;

-- 16b. If the report's amount for the held account differs ($615 instead of $315), the old pending item is closed
--      (kept as history), a new one holds the new amount, nothing is dropped from totals, and restore brings $315 back.
select replace_company_actuals('turf_pro', 2026, 'tp-sep-615.xlsx', 'Held amount changed', jsonb_build_array(
  pg_temp.month_json('turf_pro', 9, 938500,
    '[{"raw_label":"4000 Sales","qb_section":"Income","amount_cents":1000000},{"raw_label":"9999 Suspense","qb_section":"Expenses","amount_cents":61500}]',
    '[{"category_slug":"turf_pro_net_revenue","amount_cents":1000000},{"category_slug":"pending_opex","amount_cents":61500}]',
    '[{"raw_label":"9999 Suspense","qb_section":"Expenses","amount_cents":61500}]')));
do $$ begin
  assert pg_temp.active_cents('turf_pro', 9, 'pending_opex') = 61500, 'changed pending amount is in the totals';
  assert (select count(*) from pending_items where month = 9 and status = 'pending') = 1 and (select amount_cents from pending_items where month = 9 and status = 'pending') = 61500, 'one pending item at the new amount';
  assert (select count(*) from pending_items where month = 9 and status = 'resolved' and amount_cents = 31500) = 1, 'old pending item closed, not deleted';
end $$;
select restore_actuals_replacement(pg_temp.rid('tp-sep-615.xlsx'), 'undo');
do $$ begin
  assert pg_temp.active_cents('turf_pro', 9, 'pending_opex') = 31500, 'restored to the original pending amount';
  assert (select count(*) from pending_items where month = 9 and status = 'pending') = 1 and (select amount_cents from pending_items where month = 9 and status = 'pending') = 31500, 'one pending item at the original amount after restore';
end $$;

-- 17. Replace GreenAce alone: Turf Pro is untouched.
reset role;
create temp table tp_hash as select pg_temp.company_hash('turf_pro') as h;
grant select on tp_hash to authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}', true);
set local role authenticated;
select replace_company_actuals('greenace', 2026, 'ga-april.xlsx', 'Revenue corrected', jsonb_build_array(
  pg_temp.month_json('greenace', 4, 520000,
    '[{"raw_label":"4000 Sales","qb_section":"Income","amount_cents":540000},{"raw_label":"6506 Insurance - Health","qb_section":"Expenses","amount_cents":20000}]',
    '[{"category_slug":"greenace_net_revenue","amount_cents":540000},{"category_slug":"insurance_health","amount_cents":20000}]')));
do $$ begin
  assert pg_temp.active_cents('greenace', 4, 'greenace_net_revenue') = 540000, 'GreenAce April replaced';
  assert pg_temp.company_hash('turf_pro') = (select h from tp_hash), 'Turf Pro unchanged (every row, every status)';
end $$;

-- 18. The audit tables are read-only to the dashboard's API role.
select pg_temp.expect_error($$ insert into actuals_replacements (company, year, file_names, reason, created_by) values ('turf_pro', 2026, 'x', 'x', gen_random_uuid()) $$, 'permission denied%');
select pg_temp.expect_error($$ delete from actuals_replacement_lines where true $$, 'permission denied%');

rollback;
\echo reconcile_replace_test: all checks passed
