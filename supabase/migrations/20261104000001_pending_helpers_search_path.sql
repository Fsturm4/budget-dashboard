-- Pins the search path of the two Pending Review helper functions, as every other
-- dashboard function already does (Supabase advisor: function_search_path_mutable).
-- Neither reads a table, so their results do not change.

begin;

alter function public.pending_category_for(text) set search_path = public;
alter function public.pending_signed_cents(text, integer) set search_path = public;

commit;
