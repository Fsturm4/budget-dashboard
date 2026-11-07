-- Fix for replace_company_actuals under Supabase's safe-update protection.
-- PostgREST connections load the pg-safeupdate extension, which rejects any DELETE without a
-- WHERE clause. The function emptied its working tables with bare "delete from _raw;" (and
-- _pending, _after, _diff), so every call through the API failed with
-- "DELETE requires a WHERE clause" before changing anything. TRUNCATE on these per-transaction
-- temporary tables does the same job and is not a row-level DELETE, so safe-update stays on.
-- Nothing else changes: same signature, grants, checks and behaviour.

create or replace function public.replace_company_actuals(
  p_company text, p_year integer, p_file_names text, p_reason text,
  p_months jsonb, p_new_mappings jsonb default '[]'
) returns integer
language plpgsql security definer set search_path = public as $function$
declare
  v_user_id        uuid := auth.uid();
  v_replacement_id integer;
  v_mapping        record;
  v_new_mapping_id integer;
  v_month_json     jsonb;
  v_month          integer;
  v_seen_months    integer[] := '{}';
  v_upload_id      integer;
  v_pending_labels text[];
  v_old_pending    integer[];
  v_line           record;
  v_new_actual_id  integer;
  v_changes        integer;
  v_item           jsonb;
  v_raw            record;
  v_net            integer;
begin
  if not public.is_dashboard_user() then
    raise exception 'Not authorized';
  end if;
  if p_company not in ('turf_pro', 'greenace') then
    raise exception 'Unknown company %', p_company;
  end if;
  if p_year is null or p_year < 2000 or p_year > 2100 then
    raise exception 'Invalid year';
  end if;
  if coalesce(btrim(p_reason), '') = '' or coalesce(btrim(p_file_names), '') = '' then
    raise exception 'A reason and the uploaded file name are required.';
  end if;
  if jsonb_typeof(p_months) <> 'array' or jsonb_array_length(p_months) = 0 then
    raise exception 'No months were sent.';
  end if;

  if (select count(*) <> count(distinct m->>'month') from jsonb_array_elements(p_months) m) then
    raise exception 'A month appears more than once.';
  end if;

  -- One replacement at a time per company and year.
  perform pg_advisory_xact_lock(hashtext('replace_actuals:' || p_company || ':' || p_year));

  insert into actuals_replacements (company, year, file_names, reason, created_by)
    values (p_company, p_year, btrim(p_file_names), btrim(p_reason), v_user_id)
    returning id into v_replacement_id;

  -- Mappings the user approved: add only if absent; never change an existing one.
  for v_mapping in select * from jsonb_to_recordset(p_new_mappings) as m(raw_label text, qb_section text, category_slug text) loop
    if exists (select 1 from mappings where company = p_company and raw_label = v_mapping.raw_label) then
      raise exception 'An account named "%" is already mapped. Change existing mappings in Settings, not here.', v_mapping.raw_label;
    end if;
    if (select section from categories where slug = v_mapping.category_slug)
         is distinct from dashboard_section_for(v_mapping.qb_section)
       or v_mapping.category_slug like 'pending\_%' then
      raise exception 'Category % does not belong in the % section for "%".', v_mapping.category_slug, v_mapping.qb_section, v_mapping.raw_label;
    end if;
    if v_mapping.category_slug like '%\_net\_revenue' and v_mapping.category_slug <> p_company || '_net_revenue' then
      raise exception 'Revenue can only be mapped to the same company''s revenue.';
    end if;
    insert into mappings (company, raw_label, category_slug)
      values (p_company, v_mapping.raw_label, v_mapping.category_slug) returning id into v_new_mapping_id;
    insert into actuals_replacement_mappings values (v_replacement_id, v_new_mapping_id);
  end loop;

  for v_month_json in select * from jsonb_array_elements(p_months) loop
    v_month := (v_month_json->>'month')::integer;
    if v_month is null or v_month not between 1 and 12 then
      raise exception 'Invalid month';
    end if;
    if v_month = any (v_seen_months) then
      raise exception 'Month % appears more than once.', v_month;
    end if;
    v_seen_months := v_seen_months || v_month;

    -- Lock the month's active rows, then confirm nothing changed since the preview.
    perform 1 from actuals where company = p_company and year = p_year and month = v_month and status = 'active' for update;
    if not found then
      raise exception '% %/% has no stored figures to replace. Use Upload for a new month.', p_company, v_month, p_year;
    end if;
    if actuals_fingerprint(p_company, p_year, v_month) is distinct from v_month_json->>'expected_fingerprint' then
      raise exception 'The stored figures for % %/% changed after this preview was made. Nothing was saved; upload the file again.', p_company, v_month, p_year;
    end if;

    -- Recompute the new figures from the raw lines and the saved mappings.
    create temp table if not exists _raw (month integer, raw_label text, qb_section text, amount_cents integer, category_slug text) on commit drop;
    truncate _raw;
    insert into _raw (month, raw_label, qb_section, amount_cents)
      select v_month, i->>'raw_label', i->>'qb_section', (i->>'amount_cents')::integer
        from jsonb_array_elements(v_month_json->'raw_items') i;
    if exists (select 1 from _raw where qb_section not in ('Income', 'Cost of Goods Sold', 'Expenses', 'Other Income', 'Other Expenses') or qb_section is null) then
      raise exception 'Every QuickBooks line needs a valid section.';
    end if;

    update _raw r set category_slug = m.category_slug
      from mappings m where m.company = p_company and m.raw_label = r.raw_label;

    -- Pending Review accounts: must be exactly the unmapped ones the user approved.
    create temp table if not exists _pending (raw_label text, qb_section text, amount_cents integer) on commit drop;
    truncate _pending;
    insert into _pending select i->>'raw_label', i->>'qb_section', (i->>'amount_cents')::integer
      from jsonb_array_elements(coalesce(v_month_json->'pending', '[]')) i;
    if exists (select 1 from _raw r where r.category_slug is null
                 and not exists (select 1 from _pending p where p.raw_label = r.raw_label and p.qb_section = r.qb_section and p.amount_cents = r.amount_cents)) then
      raise exception 'Month %: no mapping exists and none was approved for: %', v_month,
        (select string_agg('"' || raw_label || '"', ', ') from _raw r where category_slug is null
           and not exists (select 1 from _pending p where p.raw_label = r.raw_label));
    end if;
    if exists (select 1 from _pending p where not exists (select 1 from _raw r where r.raw_label = p.raw_label and r.category_slug is null)) then
      raise exception 'Pending Review was requested for an account that is already mapped.';
    end if;

    -- New figures by category (dashboard signs: Other Expenses are negative in "other").
    create temp table if not exists _after (category_slug text primary key, amount_cents integer) on commit drop;
    truncate _after;
    insert into _after
      select slug, sum(cents)::integer from (
        select r.category_slug as slug,
               case when r.qb_section = 'Other Expenses' and c.section = 'other' then -r.amount_cents else r.amount_cents end as cents
          from _raw r join categories c on c.slug = r.category_slug
         where r.category_slug is not null
        union all
        select pending_category_for(qb_section), pending_signed_cents(qb_section, amount_cents) from _pending
      ) x group by slug;

    -- What the user reviewed must be exactly what is about to be written.
    if exists (
      select 1
        from (select (e->>'category_slug') as slug, (e->>'amount_cents')::integer as cents
                from jsonb_array_elements(v_month_json->'expected_after') e) exp
        full join _after a on a.category_slug = exp.slug
       where exp.cents is distinct from a.amount_cents
    ) then
      raise exception 'The figures for month % differ from the preview you reviewed (a mapping may have changed). Nothing was saved.', v_month;
    end if;

    -- Integrity: the lines reproduce QuickBooks' own Net Income.
    select coalesce(sum(case c.section when 'revenue' then a.amount_cents when 'other' then a.amount_cents else -a.amount_cents end), 0)
      into v_net from _after a join categories c on c.slug = a.category_slug;
    if v_net <> (v_month_json->>'qb_net_income_cents')::integer then
      raise exception 'Month %: the figures add up to a Net Income of % cents but QuickBooks reports % cents. Nothing was saved.',
        v_month, v_net, v_month_json->>'qb_net_income_cents';
    end if;

    -- Differences against the stored month (a missing category counts as zero).
    create temp table if not exists _diff (category_slug text primary key, before_id integer, before_cents integer, after_cents integer, from_correction boolean) on commit drop;
    truncate _diff;
    insert into _diff
      select coalesce(a.category_slug, b.category_slug), b.id, b.amount_cents, a.amount_cents, (b.id is not null and b.upload_id is null)
        from _after a
        full join (select id, category_slug, amount_cents, upload_id from actuals
                    where company = p_company and year = p_year and month = v_month and status = 'active') b
          on b.category_slug = a.category_slug
       where coalesce(a.amount_cents, 0) <> coalesce(b.amount_cents, 0);
    select count(*) into v_changes from _diff;
    if v_changes = 0 then
      raise exception 'Month % is identical to the stored figures; there is nothing to replace.', v_month;
    end if;

    -- Changing a figure that came from a correction needs explicit acknowledgement.
    if exists (select 1 from _diff d where d.from_correction
                 and not (d.category_slug = any (select jsonb_array_elements_text(coalesce(v_month_json->'acknowledged_corrections', '[]'))))) then
      raise exception 'Month %: a figure that was set by an earlier correction would change and was not acknowledged.', v_month;
    end if;

    -- Pending Review accounts the new report holds unchanged (same account, section and amount)
    -- are left exactly as they are; only ones that changed or disappeared are closed.
    select array_agg(p.id) into v_old_pending from pending_items p
     where p.company = p_company and p.year = p_year and p.month = v_month and p.status = 'pending'
       and not exists (select 1 from _pending n where n.raw_label = p.raw_label and n.qb_section = p.qb_section and n.amount_cents = p.amount_cents);

    select array_agg(raw_label) into v_pending_labels from _pending;
    insert into uploads (company, year, month, status, source, unmapped_labels)
      values (p_company, p_year, v_month, 'success', 'reconciliation', v_pending_labels)
      returning id into v_upload_id;
    insert into raw_uploads (upload_id, raw_label, amount_cents)
      select v_upload_id, raw_label, amount_cents from _raw;

    -- Pending accounts held for this month are replaced by the new file's.
    update pending_items set status = 'resolved', resolved_at = now(),
           resolution_reason = 'Replaced by reconciliation #' || v_replacement_id
     where id = any (coalesce(v_old_pending, '{}'));
    insert into pending_items (upload_id, company, year, month, qb_section, raw_label, amount_cents)
      select v_upload_id, p_company, p_year, v_month, n.qb_section, n.raw_label, n.amount_cents from _pending n
       where not exists (select 1 from pending_items p
                          where p.company = p_company and p.year = p_year and p.month = v_month and p.status = 'pending'
                            and p.raw_label = n.raw_label and p.qb_section = n.qb_section and p.amount_cents = n.amount_cents);

    insert into actuals_replacement_months (replacement_id, month, upload_id, qb_net_income_cents, before_fingerprint, after_fingerprint, replaced_pending_ids)
      values (v_replacement_id, v_month, v_upload_id, (v_month_json->>'qb_net_income_cents')::integer,
              v_month_json->>'expected_fingerprint', 'pending', coalesce(v_old_pending, '{}'));

    for v_line in select * from _diff loop
      update actuals set status = 'superseded' where id = v_line.before_id;
      v_new_actual_id := null;
      if coalesce(v_line.after_cents, 0) <> 0 then
        insert into actuals (category_slug, company, year, month, amount_cents, status, upload_id)
          values (v_line.category_slug, p_company, p_year, v_month, v_line.after_cents, 'active', v_upload_id)
          returning id into v_new_actual_id;
      end if;
      insert into actuals_replacement_lines (replacement_id, month, category_slug, before_cents, after_cents, before_actual_id, after_actual_id, overwrote_correction)
        values (v_replacement_id, v_month, v_line.category_slug, v_line.before_cents, v_line.after_cents, v_line.before_id, v_new_actual_id, coalesce(v_line.from_correction, false));
    end loop;

    update actuals_replacement_months set after_fingerprint = actuals_fingerprint(p_company, p_year, v_month)
     where replacement_id = v_replacement_id and month = v_month;
  end loop;

  -- Intercompany eliminations may never exceed the figures they eliminate.
  if exists (
    select 1 from (select category_slug, company, year, month, -sum(amount_cents) as eliminated
                     from active_intercompany_eliminations
                    where company = p_company and year = p_year and month = any (v_seen_months)
                    group by 1, 2, 3, 4) e
    where e.eliminated > coalesce((select amount_cents from actuals a
                                    where a.company = e.company and a.year = e.year and a.month = e.month
                                      and a.category_slug = e.category_slug and a.status = 'active'), 0)
  ) then
    raise exception 'This replacement would leave an intercompany elimination larger than the figure it eliminates. Nothing was saved.';
  end if;

  return v_replacement_id;
end $function$;
