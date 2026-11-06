begin;

create table if not exists public.vip_checkins (
  event_id text primary key,
  reservation_id text not null unique,
  booking_date date not null,
  employee_name text not null,
  checked_in_at timestamptz not null default now(),
  check (event_id = 'vip-' || reservation_id)
);

create table if not exists public.vip_initial_food_releases (
  reservation_id text primary key references public.vip_checkins (reservation_id),
  event_id text not null unique references public.vip_checkins (event_id),
  expected_item_count integer not null check (expected_item_count >= 0),
  status text not null default 'PENDING' check (status in ('PENDING', 'NO_FOOD', 'FAILED')),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.vip_checkins enable row level security;
alter table public.vip_initial_food_releases enable row level security;
revoke all on public.vip_checkins, public.vip_initial_food_releases from public, anon, authenticated;
grant select, insert, update on public.vip_checkins, public.vip_initial_food_releases to service_role;

create or replace function public.confirm_vip_checkin(
  p_event_id text,
  p_reservation_id text,
  p_booking_date date,
  p_employee_name text,
  p_expected_item_count integer
) returns public.vip_checkins
language plpgsql
security definer
set search_path = public
as $$
declare
  saved public.vip_checkins;
begin
  if p_event_id <> 'vip-' || p_reservation_id or
     p_employee_name is null or btrim(p_employee_name) = '' or
     p_expected_item_count is null or p_expected_item_count < 0 then
    raise exception 'Invalid VIP check-in request';
  end if;

  insert into public.vip_checkins (event_id, reservation_id, booking_date, employee_name)
  values (p_event_id, p_reservation_id, p_booking_date, p_employee_name)
  on conflict (event_id) do nothing;

  select * into saved from public.vip_checkins where event_id = p_event_id for update;
  if saved.reservation_id is distinct from p_reservation_id then
    raise exception 'VIP check-in reservation conflict';
  end if;

  insert into public.vip_initial_food_releases (
    reservation_id, event_id, expected_item_count, status
  ) values (
    p_reservation_id, p_event_id, p_expected_item_count,
    case when p_expected_item_count = 0 then 'NO_FOOD' else 'PENDING' end
  ) on conflict (reservation_id) do nothing;

  return saved;
end;
$$;

revoke all on function public.confirm_vip_checkin(text, text, date, text, integer) from public, anon, authenticated;
grant execute on function public.confirm_vip_checkin(text, text, date, text, integer) to service_role;

create or replace function public.release_checked_in_vip_dispatches(p_event_id text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  released_count integer;
begin
  if not exists (select 1 from public.vip_checkins where event_id = p_event_id) then
    raise exception 'VIP check-in is required';
  end if;

  update public.event_food_dispatches d
  set status = 'QUEUED', next_attempt_at = now(), locked_at = null,
      locked_by = null, last_error = null, updated_at = now()
  from public.event_food_requests r
  where d.request_id = r.id
    and r.event_id = p_event_id
    and (d.status = 'SCHEDULED' or
         (d.status = 'HELD' and d.last_error = 'VIP check-in required.'))
    and not exists (
      select 1 from public.event_food_dispatches sent
      where sent.request_id = r.id and sent.status = 'SENT'
    );
  get diagnostics released_count = row_count;
  return released_count;
end;
$$;

revoke all on function public.release_checked_in_vip_dispatches(text) from public, anon, authenticated;
grant execute on function public.release_checked_in_vip_dispatches(text) to service_role;

create or replace function public.claim_event_food_dispatches(
  p_worker_id text,
  p_limit integer default 25
) returns setof public.event_food_dispatches
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_worker_id is null or btrim(p_worker_id) = '' then
    raise exception 'worker id is required';
  end if;
  if p_limit < 1 or p_limit > 100 then
    raise exception 'claim limit must be between 1 and 100';
  end if;

  return query
  with due as (
    select d.id
    from public.event_food_dispatches d
    join public.event_food_requests r on r.id = d.request_id
    where d.status in ('SCHEDULED', 'QUEUED', 'FAILED')
      and d.attempt_count < 5
      and d.next_attempt_at <= now()
      and (d.locked_at is null or d.locked_at < now() - interval '5 minutes')
      and (r.event_id not like 'vip-%' or exists (
        select 1 from public.vip_checkins c where c.event_id = r.event_id
      ))
    order by d.next_attempt_at, d.created_at
    for update of d skip locked
    limit p_limit
  )
  update public.event_food_dispatches dispatch
  set status = 'SENDING', locked_at = now(), locked_by = p_worker_id,
      attempt_count = dispatch.attempt_count + 1, updated_at = now()
  from due
  where dispatch.id = due.id
  returning dispatch.*;
end;
$$;

revoke all on function public.claim_event_food_dispatches(text, integer) from public, anon, authenticated;
grant execute on function public.claim_event_food_dispatches(text, integer) to service_role;

commit;
