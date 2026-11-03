-- Removes the intercompany reconciliation tables and functions.
-- Refuses once any transfer or reviewed month exists: from then, void transfers instead.

begin;

do $$
begin
  if exists (select 1 from public.intercompany_transfers) or exists (select 1 from public.intercompany_reviewed_months) then
    raise exception 'Intercompany records exist, so rolling back would discard them. Nothing was changed; void transfers instead.';
  end if;
end $$;

drop function public.record_intercompany_transfer(integer, integer, text, date, integer, date, text, integer, text);
drop function public.void_intercompany_transfer(integer, text);
drop function public.confirm_intercompany_period(integer);
drop function public.mark_intercompany_month_reviewed(integer, integer);
drop view public.active_intercompany_eliminations;
drop table public.intercompany_eliminations;
drop table public.intercompany_transfers;
drop table public.intercompany_reviewed_months;

notify pgrst, 'reload schema';

commit;
