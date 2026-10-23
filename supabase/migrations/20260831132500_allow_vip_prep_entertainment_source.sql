alter table public.entertainment_reservations
  drop constraint if exists entertainment_reservations_source_check;

alter table public.entertainment_reservations
  add constraint entertainment_reservations_source_check
  check (source in ('tripleseat', 'vip-prep', 'event-host-fallback', 'manual'));
