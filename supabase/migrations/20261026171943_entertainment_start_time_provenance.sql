-- Additive metadata only. Legacy rows remain unknown until structured sync or a
-- staff timing change supplies evidence. Do not backfill from guessed times.
alter table public.entertainment_reservations
  add column if not exists start_time_source text,
  add column if not exists source_start_time_source text,
  add column if not exists contracted_duration_minutes numeric;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'entertainment_start_time_source_check' and conrelid = 'public.entertainment_reservations'::regclass) then
    alter table public.entertainment_reservations add constraint entertainment_start_time_source_check
      check (start_time_source in ('contract-explicit', 'event-start-default', 'staff-override'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'entertainment_source_start_time_source_check' and conrelid = 'public.entertainment_reservations'::regclass) then
    alter table public.entertainment_reservations add constraint entertainment_source_start_time_source_check
      check (source_start_time_source in ('contract-explicit', 'event-start-default'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'entertainment_contracted_duration_check' and conrelid = 'public.entertainment_reservations'::regclass) then
    alter table public.entertainment_reservations add constraint entertainment_contracted_duration_check
      check (contracted_duration_minutes > 0 and contracted_duration_minutes < 'Infinity'::numeric);
  end if;
end $$;

comment on column public.entertainment_reservations.start_time_source is
  'Effective start provenance: explicit contract, event-start default, or staff timing override. NULL means legacy evidence not yet recorded.';
comment on column public.entertainment_reservations.source_start_time_source is
  'Latest source timing provenance retained separately from a staff override for review and revert.';
comment on column public.entertainment_reservations.contracted_duration_minutes is
  'Exact purchased source duration in internal minutes; display in hours. NULL means missing or legacy evidence.';
