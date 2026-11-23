-- Reverses 20261122000000_sep_ira_expense.sql. Refuses once any SEP IRA figure
-- has been imported or corrected, because rolling back would discard records;
-- from then, fix forward.

begin;

do $$
begin
  if exists (select 1 from public.actuals where category_slug = 'sep_ira_expense')
     or exists (select 1 from public.corrections where category_slug = 'sep_ira_expense') then
    raise exception 'SEP IRA Expense has recorded figures; rollback would discard records. Nothing was changed.';
  end if;
end $$;

delete from public.budget     where category_slug = 'sep_ira_expense';
delete from public.mappings   where category_slug = 'sep_ira_expense';
delete from public.categories where slug = 'sep_ira_expense';

commit;
