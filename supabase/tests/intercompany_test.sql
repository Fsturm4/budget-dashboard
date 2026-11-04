-- Database tests for 20261105000000_intercompany_reconciliation.sql. Run against a local copy of the
-- database after the access-control and intercompany migrations. Uses made-up amounts in November and
-- December 2026 and a made-up account, and rolls everything back at the end. Any failed check stops the script.
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

-- Made-up books: December Turf Pro Subcontract Labor $30,000 (of which $1,000 outside contractors),
-- GreenAce Net Revenue $40,000; November the same, so cross-month transfers can be tested.
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000d1', 'owner@example.com');
insert into dashboard_users (user_id, email) values ('00000000-0000-0000-0000-0000000000d1', 'owner@example.com');
insert into actuals (category_slug, company, year, month, amount_cents, status) values
  ('subcontract_labor',    'turf_pro', 2026, 12, 3000000, 'active'),
  ('greenace_net_revenue', 'greenace', 2026, 12, 4000000, 'active'),
  ('subcontract_labor',    'turf_pro', 2026, 11, 3000000, 'active'),
  ('greenace_net_revenue', 'greenace', 2026, 11, 4000000, 'active');
create temp table actuals_before as select * from actuals;
grant select on actuals_before to authenticated;

-- Everything below runs as the signed-in dashboard user, through the API roles.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}', true);
set local role authenticated;

-- 1. One check creates one transfer and two equal eliminations.
select record_intercompany_transfer(2026, 12, '9001', '2026-12-04', 1500000, '2026-12-04', 'DEPOSIT', 2000000, 'first check');
do $$ begin
  assert (select count(*) from intercompany_transfers) = 1, 'one transfer';
  assert (select status from intercompany_transfers where check_number = '9001') = 'active', 'same-month transfer is active';
  assert (select count(*) from intercompany_eliminations) = 2, 'two eliminations';
  assert (select sum(amount_cents) from active_intercompany_eliminations where company = 'turf_pro' and category_slug = 'subcontract_labor') = -1500000, 'Turf Pro Subcontract Labor elimination';
  assert (select sum(amount_cents) from active_intercompany_eliminations where company = 'greenace' and category_slug = 'greenace_net_revenue') = -1500000, 'GreenAce Net Revenue elimination';
end $$;

-- 2. The same check cannot be recorded twice.
select pg_temp.expect_error($$
  select record_intercompany_transfer(2026, 12, ' 9001 ', '2026-12-04', 100, '2026-12-04', 'DEPOSIT', 2000000, null)
$$, 'Check 9001 is already recorded');

-- 3. A second check may share the deposit, but checks cannot exceed it; the remainder stays revenue.
select record_intercompany_transfer(2026, 12, '9002', '2026-12-04', 500000, '2026-12-04', 'DEPOSIT', 2000000, null);
select pg_temp.expect_error($$
  select record_intercompany_transfer(2026, 12, '9003', '2026-12-04', 1, '2026-12-04', 'DEPOSIT', 2000000, null)
$$, 'Checks linked to this deposit would total more than the deposit');

-- 4. A month's transfers cannot exceed Turf Pro Subcontract Labor, so outside contractors stay in COGS
--    ($30,000 - $20,000 recorded leaves $10,000; $9,000 is intercompany, $1,000 is outside).
select record_intercompany_transfer(2026, 12, '9004', '2026-12-18', 900000, '2026-12-18', 'DEPOSIT', 900000, null);
select pg_temp.expect_error($$
  select record_intercompany_transfer(2026, 12, '9005', '2026-12-20', 100001, '2026-12-20', 'DEPOSIT', 100001, null)
$$, 'Transfers for 12/2026 would exceed Turf Pro Subcontract Labor');

-- 5. The same limit applies to GreenAce Net Revenue.
reset role;
update actuals set amount_cents = 2950000 where company = 'greenace' and month = 12 and year = 2026;
set local role authenticated;
select pg_temp.expect_error($$
  select record_intercompany_transfer(2026, 12, '9005', '2026-12-20', 100000, '2026-12-20', 'DEPOSIT', 100000, null)
$$, 'Transfers for 12/2026 would exceed GreenAce Net Revenue');
reset role;
update actuals set amount_cents = 4000000 where company = 'greenace' and month = 12 and year = 2026;
set local role authenticated;

-- 6. A month that is not uploaded cannot take a transfer; the reporting month must be the check's or deposit's.
select pg_temp.expect_error($$
  select record_intercompany_transfer(2026, 10, '9006', '2026-10-02', 100, '2026-10-02', 'DEPOSIT', 100, null)
$$, 'Upload both companies for 10/2026%');
select pg_temp.expect_error($$
  select record_intercompany_transfer(2026, 11, '9006', '2026-12-02', 100, '2026-12-02', 'DEPOSIT', 100, null)
$$, 'The reporting month must be the month of the check or of the deposit');

-- 7. A check and deposit in different months wait for period review and do not count until confirmed,
--    but do count towards the limits.
select record_intercompany_transfer(2026, 11, '9007', '2026-11-30', 200000, '2026-12-01', 'DEPOSIT', 200000, 'crosses month end');
do $$ begin
  assert (select status from intercompany_transfers where check_number = '9007') = 'awaiting_period_review', 'cross-month transfer awaits review';
  assert (select count(*) from active_intercompany_eliminations where month = 11) = 0, 'awaiting transfer not counted';
end $$;
select confirm_intercompany_period((select id from intercompany_transfers where check_number = '9007'));
do $$ begin
  assert (select sum(amount_cents) from active_intercompany_eliminations where month = 11) = -400000, 'confirmed transfer counted on both sides';
end $$;
select pg_temp.expect_error($$
  select confirm_intercompany_period((select id from intercompany_transfers where check_number = '9007'))
$$, 'Transfer % is not awaiting period review');

-- 8. Every month's Turf Pro elimination equals its GreenAce elimination and its recorded checks.
do $$ begin
  assert not exists (
    select 1 from intercompany_transfers t
     where t.status = 'active'
     group by t.year, t.month
    having sum(t.amount_cents) <> -(select sum(amount_cents) from active_intercompany_eliminations e where e.year = t.year and e.month = t.month and e.company = 'turf_pro')
        or sum(t.amount_cents) <> -(select sum(amount_cents) from active_intercompany_eliminations e where e.year = t.year and e.month = t.month and e.company = 'greenace')
  ), 'eliminations equal checks on both sides';
end $$;

-- 9. Voiding needs a reason, removes both eliminations together, deletes nothing, and frees the check number.
select pg_temp.expect_error($$
  select void_intercompany_transfer((select id from intercompany_transfers where check_number = '9002'), ' ')
$$, 'A reason is required to void a transfer');
select void_intercompany_transfer((select id from intercompany_transfers where check_number = '9002'), 'entered in error');
do $$ begin
  assert (select status from intercompany_transfers where check_number = '9002') = 'voided', 'voided';
  assert (select voided_by from intercompany_transfers where check_number = '9002') = '00000000-0000-0000-0000-0000000000d1', 'who voided';
  assert (select count(*) from intercompany_eliminations) = 8, 'eliminations kept';
  assert (select sum(amount_cents) from active_intercompany_eliminations where month = 12 and company = 'turf_pro') = -2400000, 'voided transfer no longer counted';
end $$;
select pg_temp.expect_error($$
  select void_intercompany_transfer((select id from intercompany_transfers where check_number = '9002'), 'again')
$$, 'Transfer % not found or already voided');
select record_intercompany_transfer(2026, 12, '9002', '2026-12-04', 500000, '2026-12-04', 'DEPOSIT', 2000000, 're-entered');

-- 10. A month can be marked as having no transfers, once.
select mark_intercompany_month_reviewed(2026, 10);
select pg_temp.expect_error($$ select mark_intercompany_month_reviewed(2026, 10) $$, '%intercompany_reviewed_months_pkey%');

-- 11. Imported actuals are never touched.
do $$ begin
  assert (select count(*) from actuals) = (select count(*) from actuals_before), 'no actuals added or removed';
  assert not exists (select * from actuals except select * from actuals_before), 'no actuals changed';
end $$;

-- 12. The tables can only be written through the functions.
select pg_temp.expect_error($$ insert into intercompany_transfers (year, month, check_number, check_date, amount_cents, deposit_date, deposit_reference, deposit_amount_cents, status) values (2026, 12, 'x', '2026-12-01', 1, '2026-12-01', 'x', 1, 'active') $$, 'permission denied%');
select pg_temp.expect_error($$ insert into intercompany_eliminations (transfer_id, company, category_slug, amount_cents) values (1, 'turf_pro', 'subcontract_labor', -1) $$, 'permission denied%');
select pg_temp.expect_error($$ update intercompany_transfers set amount_cents = 1 $$, 'permission denied%');
select pg_temp.expect_error($$ delete from intercompany_eliminations $$, 'permission denied%');
select pg_temp.expect_error($$ insert into intercompany_reviewed_months (year, month) values (2026, 9) $$, 'permission denied%');

-- 13. A signed-in account that is not on the allowlist sees nothing and cannot record.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e2","role":"authenticated"}', true);
do $$ begin
  assert (select count(*) from intercompany_transfers) = 0, 'other account sees no transfers';
  assert (select count(*) from active_intercompany_eliminations) = 0, 'other account sees no eliminations';
end $$;
select pg_temp.expect_error($$ select record_intercompany_transfer(2026, 12, '9010', '2026-12-04', 1, '2026-12-04', 'D', 1, null) $$, 'Not authorized');
select pg_temp.expect_error($$ select void_intercompany_transfer(1, 'x') $$, 'Not authorized');
select pg_temp.expect_error($$ select confirm_intercompany_period(1) $$, 'Not authorized');
select pg_temp.expect_error($$ select mark_intercompany_month_reviewed(2026, 9) $$, 'Not authorized');

-- 14. Anonymous users can neither read nor call anything.
reset role;
set local role anon;
select pg_temp.expect_error($$ select count(*) from intercompany_transfers $$, 'permission denied%');
select pg_temp.expect_error($$ select count(*) from active_intercompany_eliminations $$, 'permission denied%');
select pg_temp.expect_error($$ select record_intercompany_transfer(2026, 12, '9011', '2026-12-04', 1, '2026-12-04', 'D', 1, null) $$, 'permission denied%');
select pg_temp.expect_error($$ select void_intercompany_transfer(1, 'x') $$, 'permission denied%');
reset role;

rollback;
\echo 'All Intercompany database tests passed.'
