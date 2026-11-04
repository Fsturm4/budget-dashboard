-- Pending Review: lets a month import with QuickBooks accounts that have no
-- mapping, holding each one in an "Uncategorized – Pending Review" line inside
-- its own P&L section until it is reclassified. Additive only: existing rows,
-- tables and the correction function are not changed. The upload function is
-- replaced by one that behaves identically when no pending accounts are sent.

begin;

insert into public.categories (slug, display_name, section, display_order, variance_direction) values
  ('pending_revenue', 'Uncategorized – Pending Review', 'revenue', 99, 'higher_is_better'),
  ('pending_cogs',    'Uncategorized – Pending Review', 'cogs',    99, 'lower_is_better'),
  ('pending_opex',    'Uncategorized – Pending Review', 'opex',    99, 'lower_is_better'),
  ('pending_other',   'Uncategorized – Pending Review', 'other',   99, 'higher_is_better');

create table public.pending_items (
  id                     serial primary key,
  upload_id              integer not null references public.uploads(id),
  company                text not null check (company in ('turf_pro', 'greenace')),
  year                   integer not null,
  month                  integer not null check (month between 1 and 12),
  qb_section             text not null check (qb_section in ('Income', 'Cost of Goods Sold', 'Expenses', 'Other Income', 'Other Expenses')),
  raw_label              text not null,
  amount_cents           integer not null,  -- as shown in QuickBooks
  status                 text not null default 'pending' check (status in ('pending', 'resolved')),
  resolved_category_slug text references public.categories(slug),
  resolution_reason      text,
  resolved_at            timestamptz,
  created_at             timestamptz not null default now(),
  check ((status = 'pending') = (resolved_at is null))
);

-- Readable by the dashboard; written only through the two functions below.
revoke all on public.pending_items from anon, authenticated;
grant select on public.pending_items to anon, authenticated;

-- Dashboard category that holds a pending account from each QuickBooks section.
create function public.pending_category_for(p_qb_section text) returns text
language sql immutable as $$
  select case p_qb_section
    when 'Income'             then 'pending_revenue'
    when 'Cost of Goods Sold' then 'pending_cogs'
    when 'Expenses'           then 'pending_opex'
    when 'Other Income'       then 'pending_other'
    when 'Other Expenses'     then 'pending_other'
  end
$$;

-- The dashboard's single Other bucket is signed (income +, expense −).
create function public.pending_signed_cents(p_qb_section text, p_amount_cents integer) returns integer
language sql immutable as $$
  select case when p_qb_section = 'Other Expenses' then -p_amount_cents else p_amount_cents end
$$;

drop function public.upload_monthly_actuals(integer, integer, jsonb, jsonb, jsonb, jsonb);

create function public.upload_monthly_actuals(
  p_year integer, p_month integer,
  p_tp_raw_items jsonb, p_ga_raw_items jsonb,
  p_tp_actuals jsonb, p_ga_actuals jsonb,
  p_tp_pending jsonb default '[]', p_ga_pending jsonb default '[]'
) returns jsonb language plpgsql security definer set search_path = public as $function$
declare
  v_tp_upload_id integer;
  v_ga_upload_id integer;
begin
  -- Everything below runs in one transaction: any failure writes nothing.
  insert into uploads (company, year, month, status, source, unmapped_labels)
    values ('turf_pro', p_year, p_month, 'success', 'quickbooks_upload',
            (select array_agg(item->>'raw_label') from jsonb_array_elements(p_tp_pending) as item))
    returning id into v_tp_upload_id;
  insert into uploads (company, year, month, status, source, unmapped_labels)
    values ('greenace', p_year, p_month, 'success', 'quickbooks_upload',
            (select array_agg(item->>'raw_label') from jsonb_array_elements(p_ga_pending) as item))
    returning id into v_ga_upload_id;

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

  insert into pending_items (upload_id, company, year, month, qb_section, raw_label, amount_cents)
    select v_tp_upload_id, 'turf_pro', p_year, p_month, item->>'qb_section', item->>'raw_label', (item->>'amount_cents')::integer
    from jsonb_array_elements(p_tp_pending) as item
    union all
    select v_ga_upload_id, 'greenace', p_year, p_month, item->>'qb_section', item->>'raw_label', (item->>'amount_cents')::integer
    from jsonb_array_elements(p_ga_pending) as item;

  -- Each pending line must equal the accounts it holds, and vice versa.
  if exists (
    select 1
    from (select company, pending_category_for(qb_section) as slug,
                 sum(pending_signed_cents(qb_section, amount_cents)) as cents
          from pending_items where upload_id in (v_tp_upload_id, v_ga_upload_id)
          group by 1, 2) items
    full join (select company, category_slug as slug, amount_cents as cents
               from actuals where upload_id in (v_tp_upload_id, v_ga_upload_id)
                 and category_slug like 'pending\_%') lines
      using (company, slug)
    where items.cents is distinct from lines.cents
  ) then
    raise exception 'Pending Review totals do not match the pending accounts. Nothing was saved.';
  end if;

  return jsonb_build_object('tp_upload_id', v_tp_upload_id, 'ga_upload_id', v_ga_upload_id);
end;
$function$;

-- Moves one pending account into a regular category in the same section.
create function public.resolve_pending_item(
  p_pending_item_id integer, p_category_slug text, p_reason text, p_save_mapping boolean default false
) returns void language plpgsql security definer set search_path = public as $function$
declare
  v_item           pending_items;
  v_pending_slug   text;
  v_signed_cents   integer;
  v_target_section text;
  v_source         actuals;
  v_target         actuals;
  v_reason         text;
begin
  select * into v_item from pending_items where id = p_pending_item_id for update;
  if not found then
    raise exception 'Pending item % not found.', p_pending_item_id;
  end if;
  if v_item.status <> 'pending' then
    raise exception 'This account has already been reclassified.';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required.';
  end if;

  v_pending_slug := pending_category_for(v_item.qb_section);
  v_signed_cents := pending_signed_cents(v_item.qb_section, v_item.amount_cents);

  select section into v_target_section from categories where slug = p_category_slug;
  if v_target_section is null or p_category_slug like 'pending\_%'
     or v_target_section <> (select section from categories where slug = v_pending_slug) then
    raise exception 'Category % is not in the same section as this account.', p_category_slug;
  end if;
  if v_target_section = 'revenue' and p_category_slug <> v_item.company || '_net_revenue' then
    raise exception 'Revenue can only be reclassified to the same company''s revenue.';
  end if;

  v_reason := format('Reclassified %s (%s) from Pending Review to %s: %s',
                     v_item.raw_label, v_item.qb_section, p_category_slug, trim(p_reason));

  select * into v_source from actuals
   where category_slug = v_pending_slug and company = v_item.company
     and year = v_item.year and month = v_item.month and status = 'active'
   for update;
  if not found then
    raise exception 'The Pending Review line for this month is missing.';
  end if;
  update actuals set status = 'superseded' where id = v_source.id;
  insert into actuals (category_slug, company, year, month, amount_cents, status, upload_id)
    values (v_pending_slug, v_item.company, v_item.year, v_item.month, v_source.amount_cents - v_signed_cents, 'active', null);
  insert into corrections (original_actual_id, category_slug, company, year, month, corrected_amount_cents, reason)
    values (v_source.id, v_pending_slug, v_item.company, v_item.year, v_item.month, v_source.amount_cents - v_signed_cents, v_reason);

  select * into v_target from actuals
   where category_slug = p_category_slug and company = v_item.company
     and year = v_item.year and month = v_item.month and status = 'active'
   for update;
  if found then
    update actuals set status = 'superseded' where id = v_target.id;
    insert into actuals (category_slug, company, year, month, amount_cents, status, upload_id)
      values (p_category_slug, v_item.company, v_item.year, v_item.month, v_target.amount_cents + v_signed_cents, 'active', null);
    insert into corrections (original_actual_id, category_slug, company, year, month, corrected_amount_cents, reason)
      values (v_target.id, p_category_slug, v_item.company, v_item.year, v_item.month, v_target.amount_cents + v_signed_cents, v_reason);
  else
    -- No existing row to supersede; the resolved pending item is the audit record.
    insert into actuals (category_slug, company, year, month, amount_cents, status, upload_id)
      values (p_category_slug, v_item.company, v_item.year, v_item.month, v_signed_cents, 'active', null);
  end if;

  update pending_items
     set status = 'resolved', resolved_category_slug = p_category_slug,
         resolution_reason = trim(p_reason), resolved_at = now()
   where id = v_item.id;

  if p_save_mapping then
    -- Never replaces a mapping that already exists for this label.
    insert into mappings (company, raw_label, category_slug)
      values (v_item.company, v_item.raw_label, p_category_slug)
      on conflict (company, raw_label) do nothing;
  end if;
end;
$function$;

-- Same access as the existing functions today; tightened by the security project.
grant execute on function public.upload_monthly_actuals(integer, integer, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) to anon, authenticated, service_role;
grant execute on function public.resolve_pending_item(integer, text, text, boolean) to anon, authenticated, service_role;

-- If the access-control migration is already in place, follow its rules instead.
do $$
begin
  if to_regprocedure('public.is_dashboard_user()') is not null then
    alter table public.pending_items enable row level security;
    create policy dashboard_users_only on public.pending_items for all to authenticated
      using (public.is_dashboard_user()) with check (public.is_dashboard_user());
    revoke all on public.pending_items from anon;
    grant insert, update on public.pending_items to authenticated;
    grant usage on sequence public.pending_items_id_seq to authenticated;
    alter function public.upload_monthly_actuals(integer, integer, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) security invoker;
    alter function public.resolve_pending_item(integer, text, text, boolean) security invoker;
    revoke execute on function public.upload_monthly_actuals(integer, integer, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) from public, anon;
    revoke execute on function public.resolve_pending_item(integer, text, text, boolean) from public, anon;
    revoke execute on function public.pending_category_for(text) from public, anon;
    revoke execute on function public.pending_signed_cents(text, integer) from public, anon;
    grant execute on function public.pending_category_for(text) to authenticated;
    grant execute on function public.pending_signed_cents(text, integer) to authenticated;
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
