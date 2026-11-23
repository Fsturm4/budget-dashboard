-- SEP IRA Expense: a dedicated Operating Expenses category for QuickBooks
-- account 6770, its GreenAce mapping, and the planned $20,000 contribution on
-- the 2026 budget (December). Additive only: three new rows. No actuals,
-- existing categories, mappings or budget lines are changed.

begin;

insert into public.categories (slug, display_name, section, display_order, variance_direction)
  values ('sep_ira_expense', 'SEP IRA Expense', 'opex', 37, 'lower_is_better');

insert into public.mappings (company, raw_label, category_slug)
  values ('greenace', '6770 SEP IRA Expense', 'sep_ira_expense');

insert into public.budget (category_slug, year, annual_budget_cents, dec_cents)
  values ('sep_ira_expense', 2026, 2000000, 2000000);

commit;
