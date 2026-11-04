-- Database tests for 20261103000000_pending_review.sql. Run against a local copy
-- of the database after the migration. Uses made-up amounts in December 2026 and
-- rolls everything back at the end. Any failed check stops the script.
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

create function pg_temp.active_cents(p_company text, p_slug text) returns integer language sql as $$
  select amount_cents from actuals
   where company = p_company and category_slug = p_slug and year = 2026 and month = 12 and status = 'active'
$$;

-- 1. The live dashboard's current call (six arguments, no pending accounts) still works unchanged.
select upload_monthly_actuals(2026, 12,
  '[{"raw_label":"4100 Lawn Service Income","amount_cents":100000}]', '[{"raw_label":"4100 Lawn Service Income","amount_cents":50000}]',
  '[{"category_slug":"turf_pro_net_revenue","amount_cents":100000}]', '[{"category_slug":"greenace_net_revenue","amount_cents":50000}]');
do $$ begin
  assert pg_temp.active_cents('turf_pro', 'turf_pro_net_revenue') = 100000, 'six-argument upload wrote Turf Pro revenue';
  assert pg_temp.active_cents('greenace', 'greenace_net_revenue') = 50000, 'six-argument upload wrote GreenAce revenue';
  assert (select count(*) from uploads where month = 12 and unmapped_labels is not null) = 0, 'no pending labels recorded';
  assert (select count(*) from pending_items) = 0, 'no pending items written';
end $$;

-- 2. A second import of the same month fails and writes nothing.
select pg_temp.expect_error($$
  select upload_monthly_actuals(2026, 12, '[]', '[]',
    '[{"category_slug":"turf_pro_net_revenue","amount_cents":1}]', '[]')
$$, '%actuals_one_active_per_slot%');
do $$ begin
  assert (select count(*) from uploads where month = 12) = 2, 'failed duplicate wrote no upload records';
end $$;

-- 3. Clear December so the pending tests start from an empty month.
delete from actuals where month = 12 and year = 2026;
delete from raw_uploads where upload_id in (select id from uploads where month = 12 and year = 2026);
delete from uploads where month = 12 and year = 2026;

-- 4. Pending totals that don't match their accounts are rejected and nothing is written.
select pg_temp.expect_error($$
  select upload_monthly_actuals(2026, 12, '[]', '[{"raw_label":"8999 Unassigned Expense","amount_cents":61240}]',
    '[]', '[{"category_slug":"pending_other","amount_cents":61240}]',
    '[]', '[{"raw_label":"8999 Unassigned Expense","qb_section":"Other Expenses","amount_cents":61240}]')
$$, 'Pending Review totals do not match%');
select pg_temp.expect_error($$
  select upload_monthly_actuals(2026, 12, '[]', '[]', '[]', '[{"category_slug":"pending_other","amount_cents":-5}]')
$$, 'Pending Review totals do not match%');
do $$ begin
  assert (select count(*) from uploads where month = 12) = 0, 'rejected pending uploads wrote nothing';
  assert (select count(*) from pending_items) = 0, 'rejected pending uploads wrote no pending items';
end $$;

-- 5. Pending accounts import into their own section, signed for the Other bucket.
select upload_monthly_actuals(2026, 12,
  '[{"raw_label":"4100 Lawn Service Income","amount_cents":90000},{"raw_label":"6990 Unassigned Charge","amount_cents":4050}]',
  '[{"raw_label":"4100 Lawn Service Income","amount_cents":30000},{"raw_label":"7010 Bank Interest","amount_cents":200},{"raw_label":"8999 Unassigned Expense","amount_cents":61240}]',
  '[{"category_slug":"turf_pro_net_revenue","amount_cents":90000},{"category_slug":"pending_opex","amount_cents":4050}]',
  '[{"category_slug":"greenace_net_revenue","amount_cents":30000},{"category_slug":"other_income_expense","amount_cents":200},{"category_slug":"pending_other","amount_cents":-61240}]',
  '[{"raw_label":"6990 Unassigned Charge","qb_section":"Expenses","amount_cents":4050}]',
  '[{"raw_label":"8999 Unassigned Expense","qb_section":"Other Expenses","amount_cents":61240}]');
do $$ begin
  assert pg_temp.active_cents('greenace', 'pending_other') = -61240, 'unassigned expense held negative in Other';
  assert pg_temp.active_cents('turf_pro', 'pending_opex') = 4050, 'unknown expense held in operating expenses';
  assert (select count(*) from pending_items where status = 'pending') = 2, 'two pending items';
  assert (select unmapped_labels from uploads where month = 12 and company = 'greenace') = array['8999 Unassigned Expense'], 'GreenAce upload lists its pending label';
  assert (select unmapped_labels from uploads where month = 12 and company = 'turf_pro') = array['6990 Unassigned Charge'], 'Turf Pro upload lists its pending label';
end $$;

-- 6. Reclassification is limited to the same section and the same company's revenue.
select pg_temp.expect_error(format('select resolve_pending_item(%s, %L, %L)',
  (select id from pending_items where raw_label = '8999 Unassigned Expense'), 'professional_fees', 'test'), '%not in the same section%');
select pg_temp.expect_error(format('select resolve_pending_item(%s, %L, %L)',
  (select id from pending_items where raw_label = '8999 Unassigned Expense'), 'pending_other', 'test'), '%not in the same section%');
select pg_temp.expect_error(format('select resolve_pending_item(%s, %L, %L)',
  (select id from pending_items where raw_label = '8999 Unassigned Expense'), 'other_income_expense', '  '), 'A reason is required.');

-- 7. Reclassifying into a category that already has a row moves the amount once.
select resolve_pending_item((select id from pending_items where raw_label = '8999 Unassigned Expense'), 'other_income_expense', 'Reviewed (example)', false);
do $$ begin
  assert pg_temp.active_cents('greenace', 'pending_other') = 0, 'pending Other emptied';
  assert pg_temp.active_cents('greenace', 'other_income_expense') = 200 - 61240, 'Other includes the reclassified expense once';
  assert (select count(*) from corrections where month = 12) = 2, 'both sides recorded as corrections';
  assert (select status from pending_items where raw_label = '8999 Unassigned Expense') = 'resolved', 'item marked resolved';
  assert not exists (select 1 from mappings where raw_label = '8999 Unassigned Expense'), 'no mapping saved unless asked';
end $$;
select pg_temp.expect_error(format('select resolve_pending_item(%s, %L, %L)',
  (select id from pending_items where raw_label = '8999 Unassigned Expense'), 'other_income_expense', 'again'), 'This account has already been reclassified.');

-- 8. Reclassifying into a category with no row creates it; an optional mapping never replaces an existing one.
insert into mappings (company, raw_label, category_slug) values ('turf_pro', '6990 Unassigned Charge', 'bank_fees');
select resolve_pending_item((select id from pending_items where raw_label = '6990 Unassigned Charge'), 'education', 'Training course (example)', true);
do $$ begin
  assert pg_temp.active_cents('turf_pro', 'education') = 4050, 'new Education row created';
  assert pg_temp.active_cents('turf_pro', 'pending_opex') = 0, 'pending operating line emptied';
  assert (select category_slug from mappings where company = 'turf_pro' and raw_label = '6990 Unassigned Charge') = 'bank_fees', 'existing mapping kept';
end $$;

-- 9. Month totals are unchanged by reclassification; no amount was duplicated.
do $$ begin
  assert (select sum(case c.section when 'revenue' then a.amount_cents when 'other' then a.amount_cents else -a.amount_cents end)
            from actuals a join categories c on c.slug = a.category_slug
           where a.year = 2026 and a.month = 12 and a.status = 'active') = 90000 + 30000 + 200 - 4050 - 61240,
         'combined Net Income unchanged after reclassification';
end $$;

-- 10. The existing correction function still works on the new rows.
select apply_correction((select id from actuals where company = 'turf_pro' and category_slug = 'education' and month = 12 and status = 'active'),
  'education', 'turf_pro', 2026, 12, 4000, 'test correction');
do $$ begin
  assert pg_temp.active_cents('turf_pro', 'education') = 4000, 'apply_correction still works';
end $$;

\echo 'All Pending Review database tests passed.'
rollback;
