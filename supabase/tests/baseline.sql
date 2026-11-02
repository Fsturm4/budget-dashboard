-- Production schema as of 2026-11-02 (Postgres 17), recreated for local migration
-- tests. Contains no financial data. The Supabase roles, grants and the small
-- auth schema stand in for what Supabase provides on the hosted project.

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt()->>'sub', '')::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;

create table public.categories (
  slug               text primary key,
  display_name       text not null,
  section            text not null check (section = any (array['revenue','cogs','opex','other'])),
  display_order      integer not null,
  variance_direction text not null check (variance_direction = any (array['higher_is_better','lower_is_better']))
);

create table public.budget (
  id                  serial primary key,
  category_slug       text not null references public.categories(slug),
  year                integer not null,
  annual_budget_cents integer not null,
  jan_cents integer not null default 0, feb_cents integer not null default 0,
  mar_cents integer not null default 0, apr_cents integer not null default 0,
  may_cents integer not null default 0, jun_cents integer not null default 0,
  jul_cents integer not null default 0, aug_cents integer not null default 0,
  sep_cents integer not null default 0, oct_cents integer not null default 0,
  nov_cents integer not null default 0, dec_cents integer not null default 0,
  unique (category_slug, year)
);

create table public.budget_revisions (
  id                   serial primary key,
  category_slug        text not null references public.categories(slug),
  year                 integer not null,
  month                integer not null check (month >= 1 and month <= 12),
  revised_budget_cents integer not null,
  reason               text not null,
  created_at           timestamptz not null default now()
);

create table public.assumptions (
  id             serial primary key,
  assumption_key text not null,
  display_name   text not null,
  value_text     text not null,
  notes          text,
  created_at     timestamptz not null default now()
);

create table public.mappings (
  id            serial primary key,
  company       text not null check (company = any (array['turf_pro','greenace'])),
  raw_label     text not null,
  category_slug text not null references public.categories(slug),
  created_at    timestamptz not null default now(),
  unique (company, raw_label)
);

create table public.uploads (
  id              serial primary key,
  company         text not null,
  year            integer not null,
  month           integer not null check (month >= 1 and month <= 12),
  status          text not null check (status = any (array['success','failed_unmapped','failed_duplicate'])),
  source          text not null check (source = any (array['quickbooks_upload','qb_initialization'])),
  unmapped_labels text[],
  created_at      timestamptz not null default now()
);

create table public.raw_uploads (
  id           serial primary key,
  upload_id    integer not null references public.uploads(id),
  raw_label    text not null,
  amount_cents integer not null,
  created_at   timestamptz not null default now()
);

create table public.actuals (
  id            serial primary key,
  category_slug text not null references public.categories(slug),
  company       text not null,
  year          integer not null,
  month         integer not null check (month >= 1 and month <= 12),
  amount_cents  integer not null,
  status        text not null check (status = any (array['active','superseded'])),
  upload_id     integer references public.uploads(id),
  created_at    timestamptz not null default now()
);
create unique index actuals_one_active_per_slot on public.actuals (category_slug, company, year, month) where (status = 'active');

create table public.corrections (
  id                     serial primary key,
  original_actual_id     integer not null references public.actuals(id),
  category_slug          text not null,
  company                text not null,
  year                   integer not null,
  month                  integer not null check (month >= 1 and month <= 12),
  corrected_amount_cents integer not null,
  reason                 text not null,
  created_at             timestamptz not null default now()
);

create function public.apply_correction(p_original_actual_id integer, p_category_slug text, p_company text, p_year integer, p_month integer, p_corrected_amount_cents integer, p_reason text)
returns void language plpgsql security definer as $function$
declare
  v_new_actual_id integer;
begin
  update actuals set status = 'superseded' where id = p_original_actual_id and status = 'active';
  if not found then
    raise exception 'Original actual (id=%) not found or already superseded', p_original_actual_id;
  end if;
  insert into actuals (category_slug, company, year, month, amount_cents, status, upload_id)
    values (p_category_slug, p_company, p_year, p_month, p_corrected_amount_cents, 'active', null)
    returning id into v_new_actual_id;
  insert into corrections (original_actual_id, category_slug, company, year, month, corrected_amount_cents, reason)
    values (p_original_actual_id, p_category_slug, p_company, p_year, p_month, p_corrected_amount_cents, p_reason);
end;
$function$;

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

grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant execute on all functions in schema public to anon, authenticated, service_role;

-- Supabase's default privileges: objects created later are granted to these roles too.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
