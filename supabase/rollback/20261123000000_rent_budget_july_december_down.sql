-- Reverses 20261123000000_rent_budget_july_december.sql: restores the original
-- 2026 Rent & Lease budget of $4,227.58 a month and $50,731.00 for the year.

update public.budget
   set jul_cents = 422758, aug_cents = 422758, sep_cents = 422758,
       oct_cents = 422758, nov_cents = 422758, dec_cents = 422758,
       annual_budget_cents = 5073100
 where category_slug = 'rent_and_lease' and year = 2026;
