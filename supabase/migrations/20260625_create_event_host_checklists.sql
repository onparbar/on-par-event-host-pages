create table if not exists public.event_host_checklists (
  event_id bigint primary key,
  event_name text not null,
  event_date date not null,
  poc text not null default '',
  bwa text not null default '',
  extras_added text not null default '',
  remaining_drink_card_balance text not null default '',
  tasks jsonb not null default '{}'::jsonb,
  entertainment jsonb not null default '{}'::jsonb,
  food jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'submitted')),
  submitted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.event_host_checklists enable row level security;

drop policy if exists "event_host_checklists_no_public_access" on public.event_host_checklists;
create policy "event_host_checklists_no_public_access"
on public.event_host_checklists
as restrictive
for all
to anon, authenticated
using (false)
with check (false);

grant usage on schema public to service_role;
grant select, insert, update on public.event_host_checklists to service_role;
