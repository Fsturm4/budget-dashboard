-- Intercompany reconciliation: one record per Turf Pro check to GreenAce, each creating two linked
-- eliminations (Turf Pro Subcontract Labor and GreenAce Net Revenue) that only combined views add.
-- Imported actuals, corrections and QuickBooks classifications are never touched.
-- Requires the dashboard access-control migration (is_dashboard_user).
-- The functions below are the only way to write these tables: they run with the owner's rights,
-- check the caller is a dashboard user, and are closed to anonymous users.

begin;

create table public.intercompany_transfers (
  id                    serial primary key,
  year                  integer not null,
  month                 integer not null check (month between 1 and 12),
  check_number          text not null check (btrim(check_number) <> ''),
  check_date            date not null,
  amount_cents          integer not null check (amount_cents > 0),
  deposit_date          date not null,
  deposit_reference     text not null check (btrim(deposit_reference) <> ''),
  deposit_amount_cents  integer not null check (deposit_amount_cents > 0),
  note                  text,
  status                text not null check (status in ('active', 'awaiting_period_review', 'voided')),
  void_reason           text,
  voided_at             timestamptz,
  voided_by             uuid,
  created_at            timestamptz not null default now()
);
create unique index intercompany_transfers_one_per_check
  on public.intercompany_transfers (check_number) where status <> 'voided';

create table public.intercompany_eliminations (
  id             serial primary key,
  transfer_id    integer not null references public.intercompany_transfers(id),
  company        text not null check (company in ('turf_pro', 'greenace')),
  category_slug  text not null references public.categories(slug),
  amount_cents   integer not null check (amount_cents < 0),
  unique (transfer_id, company)
);

-- Months confirmed to have no intercompany transfers ("None this month").
create table public.intercompany_reviewed_months (
  year         integer not null,
  month        integer not null check (month between 1 and 12),
  reviewed_at  timestamptz not null default now(),
  primary key (year, month)
);

-- What combined views add: eliminations of active transfers only.
create view public.active_intercompany_eliminations with (security_invoker = true) as
  select e.category_slug, e.company, t.year, t.month, e.amount_cents
    from public.intercompany_eliminations e
    join public.intercompany_transfers t on t.id = e.transfer_id
   where t.status = 'active';

create function public.record_intercompany_transfer(
  p_year integer, p_month integer, p_check_number text, p_check_date date, p_amount_cents integer,
  p_deposit_date date, p_deposit_reference text, p_deposit_amount_cents integer, p_note text
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_check_month    date := date_trunc('month', p_check_date);
  v_deposit_month  date := date_trunc('month', p_deposit_date);
  v_reporting      date := make_date(p_year, p_month, 1);
  v_subcontract    integer;
  v_revenue        integer;
  v_month_recorded integer;
  v_deposit_used   integer;
  v_transfer_id    integer;
begin
  if not public.is_dashboard_user() then
    raise exception 'Not authorized';
  end if;
  if v_reporting not in (v_check_month, v_deposit_month) then
    raise exception 'The reporting month must be the month of the check or of the deposit';
  end if;

  -- Serialize writers so the limits below cannot be exceeded by two transfers at once.
  lock table public.intercompany_transfers in share row exclusive mode;

  if exists (select 1 from intercompany_transfers where check_number = btrim(p_check_number) and status <> 'voided') then
    raise exception 'Check % is already recorded', btrim(p_check_number);
  end if;

  select amount_cents into v_subcontract from actuals
   where company = 'turf_pro' and category_slug = 'subcontract_labor'
     and year = p_year and month = p_month and status = 'active';
  select amount_cents into v_revenue from actuals
   where company = 'greenace' and category_slug = 'greenace_net_revenue'
     and year = p_year and month = p_month and status = 'active';
  if v_subcontract is null or v_revenue is null then
    raise exception 'Upload both companies for %/% before recording a transfer', p_month, p_year;
  end if;

  select coalesce(sum(amount_cents), 0) into v_month_recorded from intercompany_transfers
   where year = p_year and month = p_month and status <> 'voided';
  if v_month_recorded + p_amount_cents > v_subcontract then
    raise exception 'Transfers for %/% would exceed Turf Pro Subcontract Labor', p_month, p_year;
  end if;
  if v_month_recorded + p_amount_cents > v_revenue then
    raise exception 'Transfers for %/% would exceed GreenAce Net Revenue', p_month, p_year;
  end if;

  select coalesce(sum(amount_cents), 0) into v_deposit_used from intercompany_transfers
   where deposit_date = p_deposit_date and deposit_reference = btrim(p_deposit_reference)
     and deposit_amount_cents = p_deposit_amount_cents and status <> 'voided';
  if v_deposit_used + p_amount_cents > p_deposit_amount_cents then
    raise exception 'Checks linked to this deposit would total more than the deposit';
  end if;

  insert into intercompany_transfers (year, month, check_number, check_date, amount_cents,
                                      deposit_date, deposit_reference, deposit_amount_cents, note, status)
  values (p_year, p_month, btrim(p_check_number), p_check_date, p_amount_cents,
          p_deposit_date, btrim(p_deposit_reference), p_deposit_amount_cents, nullif(btrim(p_note), ''),
          case when v_check_month = v_deposit_month then 'active' else 'awaiting_period_review' end)
  returning id into v_transfer_id;

  insert into intercompany_eliminations (transfer_id, company, category_slug, amount_cents) values
    (v_transfer_id, 'turf_pro', 'subcontract_labor',    -p_amount_cents),
    (v_transfer_id, 'greenace', 'greenace_net_revenue', -p_amount_cents);

  return v_transfer_id;
end $$;

create function public.void_intercompany_transfer(p_transfer_id integer, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_dashboard_user() then
    raise exception 'Not authorized';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'A reason is required to void a transfer';
  end if;
  update intercompany_transfers
     set status = 'voided', void_reason = btrim(p_reason), voided_at = now(), voided_by = auth.uid()
   where id = p_transfer_id and status <> 'voided';
  if not found then
    raise exception 'Transfer % not found or already voided', p_transfer_id;
  end if;
end $$;

create function public.confirm_intercompany_period(p_transfer_id integer) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_dashboard_user() then
    raise exception 'Not authorized';
  end if;
  update intercompany_transfers set status = 'active'
   where id = p_transfer_id and status = 'awaiting_period_review';
  if not found then
    raise exception 'Transfer % is not awaiting period review', p_transfer_id;
  end if;
end $$;

create function public.mark_intercompany_month_reviewed(p_year integer, p_month integer) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_dashboard_user() then
    raise exception 'Not authorized';
  end if;
  insert into intercompany_reviewed_months (year, month) values (p_year, p_month);
end $$;

alter table public.intercompany_transfers       enable row level security;
alter table public.intercompany_eliminations    enable row level security;
alter table public.intercompany_reviewed_months enable row level security;
create policy dashboard_users_only on public.intercompany_transfers       for select to authenticated using (public.is_dashboard_user());
create policy dashboard_users_only on public.intercompany_eliminations    for select to authenticated using (public.is_dashboard_user());
create policy dashboard_users_only on public.intercompany_reviewed_months for select to authenticated using (public.is_dashboard_user());

revoke all on public.intercompany_transfers, public.intercompany_eliminations,
              public.intercompany_reviewed_months, public.active_intercompany_eliminations
  from public, anon, authenticated;
grant select on public.intercompany_transfers, public.intercompany_eliminations,
                public.intercompany_reviewed_months, public.active_intercompany_eliminations
  to authenticated;
revoke all on sequence public.intercompany_transfers_id_seq, public.intercompany_eliminations_id_seq
  from public, anon, authenticated;

revoke execute on function public.record_intercompany_transfer(integer, integer, text, date, integer, date, text, integer, text),
                           public.void_intercompany_transfer(integer, text),
                           public.confirm_intercompany_period(integer),
                           public.mark_intercompany_month_reviewed(integer, integer)
  from public, anon;
grant execute on function public.record_intercompany_transfer(integer, integer, text, date, integer, date, text, integer, text),
                          public.void_intercompany_transfer(integer, text),
                          public.confirm_intercompany_period(integer),
                          public.mark_intercompany_month_reviewed(integer, integer)
  to authenticated;

notify pgrst, 'reload schema';

commit;
