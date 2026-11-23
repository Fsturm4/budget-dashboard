-- 2026 Rent & Lease budget: $1,713.00 a month for July-December ($1,650 rent plus
-- $63 storage), the arrangement in force since July 2026. January-June stay at
-- $4,227.58. The annual figure becomes the sum of the twelve months, $35,643.48.
-- One budget row changes. No actuals change.

do $$
declare changed integer;
begin
  update public.budget
     set jul_cents = 171300, aug_cents = 171300, sep_cents = 171300,
         oct_cents = 171300, nov_cents = 171300, dec_cents = 171300,
         annual_budget_cents = 3564348
   where category_slug = 'rent_and_lease' and year = 2026
     and annual_budget_cents = 5073100 and jul_cents = 422758 and dec_cents = 422758;
  get diagnostics changed = row_count;
  if changed <> 1 then
    raise exception 'Expected to update exactly one Rent & Lease budget row, found %. Nothing was changed.', changed;
  end if;
end $$;
