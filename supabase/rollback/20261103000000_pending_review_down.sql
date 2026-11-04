-- Reverses 20261103000000_pending_review.sql and restores the original upload
-- function exactly. Refuses to run once Pending Review has been used, so it can
-- never discard financial records; in that case leave the migration in place.

begin;

do $$
begin
  if exists (select 1 from public.pending_items)
     or exists (select 1 from public.actuals where category_slug like 'pending\_%') then
    raise exception 'Pending Review has already been used; rollback would discard records. Nothing was changed.';
  end if;
end $$;

drop function public.resolve_pending_item(integer, text, text, boolean);
drop function public.upload_monthly_actuals(integer, integer, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb);
drop function public.pending_signed_cents(text, integer);
drop function public.pending_category_for(text);
drop table public.pending_items;
delete from public.categories where slug in ('pending_revenue', 'pending_cogs', 'pending_opex', 'pending_other');

create function public.upload_monthly_actuals(p_year integer, p_month integer, p_tp_raw_items jsonb, p_ga_raw_items jsonb, p_tp_actuals jsonb, p_ga_actuals jsonb)
returns jsonb language plpgsql security definer as $function$
declare
  v_tp_upload_id integer;
  v_ga_upload_id integer;
begin
  insert into uploads (company, year, month, status, source)
    values ('turf_pro', p_year, p_month, 'success', 'quickbooks_upload') returning id into v_tp_upload_id;
  insert into uploads (company, year, month, status, source)
    values ('greenace', p_year, p_month, 'success', 'quickbooks_upload') returning id into v_ga_upload_id;

  insert into raw_uploads (upload_id, raw_label, amount_cents)
    select v_tp_upload_id, item->>'raw_label', (item->>'amount_cents')::integer from jsonb_array_elements(p_tp_raw_items) as item;
  insert into raw_uploads (upload_id, raw_label, amount_cents)
    select v_ga_upload_id, item->>'raw_label', (item->>'amount_cents')::integer from jsonb_array_elements(p_ga_raw_items) as item;

  insert into actuals (category_slug, company, year, month, amount_cents, status, upload_id)
    select item->>'category_slug', 'turf_pro', p_year, p_month, (item->>'amount_cents')::integer, 'active', v_tp_upload_id
    from jsonb_array_elements(p_tp_actuals) as item;
  insert into actuals (category_slug, company, year, month, amount_cents, status, upload_id)
    select item->>'category_slug', 'greenace', p_year, p_month, (item->>'amount_cents')::integer, 'active', v_ga_upload_id
    from jsonb_array_elements(p_ga_actuals) as item;

  return jsonb_build_object('tp_upload_id', v_tp_upload_id, 'ga_upload_id', v_ga_upload_id);
end;
$function$;

grant execute on function public.upload_monthly_actuals(integer, integer, jsonb, jsonb, jsonb, jsonb) to anon, authenticated, service_role;

-- If the access-control migration is in place, keep the restored function under its rules.
do $$
begin
  if to_regprocedure('public.is_dashboard_user()') is not null then
    alter function public.upload_monthly_actuals(integer, integer, jsonb, jsonb, jsonb, jsonb) security invoker;
    revoke execute on function public.upload_monthly_actuals(integer, integer, jsonb, jsonb, jsonb, jsonb) from public, anon;
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
