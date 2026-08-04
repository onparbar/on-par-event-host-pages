begin;

alter table public.kitchen_event_add_ons
  add column if not exists revision bigint not null default 1
    check (revision > 0);

comment on column public.kitchen_event_add_ons.revision is
  'Optimistic concurrency version for conflict-safe Event Host edits.';

commit;
