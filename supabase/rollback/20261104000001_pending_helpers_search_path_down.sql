-- Returns the two Pending Review helper functions to an unpinned search path.

begin;

alter function public.pending_category_for(text) reset search_path;
alter function public.pending_signed_cents(text, integer) reset search_path;

commit;
