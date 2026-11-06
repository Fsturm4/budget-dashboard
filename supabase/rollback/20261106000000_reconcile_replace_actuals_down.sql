-- Removes the Reconcile / Replace Actuals tables and functions.
-- Refuses once any replacement exists: from then, restore replacements instead, because dropping
-- the tables would discard the audit trail of what was replaced.

begin;

do $$
begin
  if exists (select 1 from public.actuals_replacements) then
    raise exception 'Replacements exist, so rolling back would discard their audit trail. Nothing was changed; restore them instead.';
  end if;
end $$;

drop function public.restore_actuals_replacement(integer, text);
drop function public.replace_company_actuals(text, integer, text, text, jsonb, jsonb);
drop function public.actuals_fingerprint(text, integer, integer);
drop function public.dashboard_section_for(text);
drop table public.actuals_replacement_mappings;
drop table public.actuals_replacement_lines;
drop table public.actuals_replacement_months;
drop table public.actuals_replacements;

alter table public.uploads drop constraint uploads_source_check;
alter table public.uploads add constraint uploads_source_check
  check (source = any (array['quickbooks_upload', 'qb_initialization']));

notify pgrst, 'reload schema';

commit;
