begin;

-- Standalone Event Host staffing snapshot; independent of Staff Tools sign-in.
create table public.event_host_standalone_staffing_state (
  id text primary key check (id = 'corporate-parties'),
  version integer not null check (version > 0),
  document jsonb not null check (pg_catalog.jsonb_typeof(document) = 'object')
);
alter table public.event_host_standalone_staffing_state enable row level security;
revoke all on table public.event_host_standalone_staffing_state from public, anon, authenticated, service_role;
grant select, insert, update on table public.event_host_standalone_staffing_state to service_role;

create table public.event_host_staffing_admin_attempts (
  attempt_key text primary key check (attempt_key ~ '^[0-9a-f]{64}$'),
  window_started timestamptz not null,
  attempts integer not null check (attempts between 1 and 9)
);
create index event_host_staffing_admin_attempts_window_idx on public.event_host_staffing_admin_attempts (window_started);
alter table public.event_host_staffing_admin_attempts enable row level security;
revoke all on table public.event_host_staffing_admin_attempts from public, anon, authenticated, service_role;
grant select, insert, update on table public.event_host_staffing_admin_attempts to service_role;

create function public.record_event_host_staffing_admin_attempt(p_attempt_key text)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  insert into public.event_host_staffing_admin_attempts as existing (attempt_key, window_started, attempts)
  values (p_attempt_key, pg_catalog.statement_timestamp(), 1)
  on conflict (attempt_key) do update
  set window_started = case
    when existing.window_started <= pg_catalog.statement_timestamp() - interval '15 minutes' then pg_catalog.statement_timestamp()
    else existing.window_started end,
    attempts = case
      when existing.window_started <= pg_catalog.statement_timestamp() - interval '15 minutes' then 1
      else least(existing.attempts + 1, 9) end
  returning attempts <= 8;
$$;
revoke all on function public.record_event_host_staffing_admin_attempt(text) from public, anon, authenticated, service_role;
grant execute on function public.record_event_host_staffing_admin_attempt(text) to service_role;

commit;
