-- Database tests for 20261122000000_sep_ira_expense.sql. Run against a local copy
-- of the database after all earlier migrations and this one. Read-only apart from
-- one made-up December upload by a made-up signed-in user, rolled back at the end.
-- Any failed check stops the script.
\set ON_ERROR_STOP on
begin;

do $$ begin
  assert (select section from categories where slug = 'sep_ira_expense') = 'opex', 'category is an operating expense';
  assert (select category_slug from mappings where company = 'greenace' and raw_label = '6770 SEP IRA Expense') = 'sep_ira_expense', 'GreenAce 6770 is mapped';
  assert (select count(*) from mappings where category_slug = 'sep_ira_expense') = 1, 'no other mapping was added';
  assert (select annual_budget_cents from budget where category_slug = 'sep_ira_expense' and year = 2026) = 2000000, 'annual budget is $20,000';
  assert (select jan_cents + feb_cents + mar_cents + apr_cents + may_cents + jun_cents + jul_cents + aug_cents + sep_cents + oct_cents + nov_cents
            from budget where category_slug = 'sep_ira_expense' and year = 2026) = 0, 'nothing budgeted before December';
  assert (select dec_cents from budget where category_slug = 'sep_ira_expense' and year = 2026) = 2000000, 'December carries the contribution';
  assert (select count(*) from actuals where category_slug = 'sep_ira_expense') = 0, 'no actuals were created';
end $$;

-- A QuickBooks upload carrying account 6770 lands in the new category.
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000d1', 'sep-test@example.com');
insert into dashboard_users (user_id, email) values ('00000000-0000-0000-0000-0000000000d1', 'sep-test@example.com');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}', true);
set local role authenticated;
select upload_monthly_actuals(2026, 12,
  '[]', '[{"raw_label":"6770 SEP IRA Expense","amount_cents":2000000}]',
  '[]', '[{"category_slug":"sep_ira_expense","amount_cents":2000000}]');
reset role;
do $$ begin
  assert (select amount_cents from actuals
           where company = 'greenace' and category_slug = 'sep_ira_expense' and year = 2026 and month = 12 and status = 'active') = 2000000,
         'December upload wrote the SEP actual';
end $$;

rollback;
