begin;

create table public.event_host_staff_sessions (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  handoff_hash text not null unique check (handoff_hash ~ '^[0-9a-f]{64}$'),
  employee_id text not null check (employee_id ~ '^[1-9][0-9]{0,15}$'),
  staff_session text not null check (char_length(staff_session) <= 1024 and staff_session ~ '^[A-Za-z0-9_-]+[.][A-Za-z0-9_-]{43}$'),
  staff_session_hash text not null check (staff_session_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create index event_host_staff_sessions_expiry_idx on public.event_host_staff_sessions (expires_at);
alter table public.event_host_staff_sessions enable row level security;
revoke all on public.event_host_staff_sessions from public, anon, authenticated;
grant select, insert, update, delete on public.event_host_staff_sessions to service_role;

-- Keep a revocation even if no downstream sessions exist yet. Group hashes are
-- stable per Staff Tools sign-in, not per employee; another device is unaffected.
create table public.event_host_staff_session_revocations (
  staff_session_hash text primary key check (staff_session_hash ~ '^[0-9a-f]{64}$'),
  revoked_at timestamptz not null default statement_timestamp()
);
alter table public.event_host_staff_session_revocations enable row level security;
revoke all on public.event_host_staff_session_revocations from public, anon, authenticated;
grant select, insert on public.event_host_staff_session_revocations to service_role;

create function public.create_event_host_staff_session(
  p_token_hash text, p_handoff_hash text, p_employee_id text, p_staff_session text, p_expires_at timestamptz
)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  with staff_group as (
    select encode(sha256(convert_to(p_staff_session, 'UTF8')), 'hex') as hash
  ), created as (
    insert into public.event_host_staff_sessions
      (token_hash, handoff_hash, employee_id, staff_session, staff_session_hash, expires_at)
    select p_token_hash, p_handoff_hash, p_employee_id, p_staff_session, staff_group.hash, p_expires_at
      from staff_group
     where not exists (
       select 1 from public.event_host_staff_session_revocations r where r.staff_session_hash = staff_group.hash
     )
    on conflict do nothing
    returning token_hash
  )
  select exists (select 1 from created);
$$;
revoke all on function public.create_event_host_staff_session(text,text,text,text,timestamptz) from public, anon, authenticated;
grant execute on function public.create_event_host_staff_session(text,text,text,text,timestamptz) to service_role;

create function public.find_event_host_staff_session(p_token_hash text)
returns table (employee_id text, staff_session text, expires_at timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  select s.employee_id, s.staff_session, s.expires_at
    from public.event_host_staff_sessions s
   where s.token_hash = p_token_hash and s.revoked_at is null and s.expires_at > statement_timestamp()
     and not exists (
       select 1 from public.event_host_staff_session_revocations r where r.staff_session_hash = s.staff_session_hash
     );
$$;
revoke all on function public.find_event_host_staff_session(text) from public, anon, authenticated;
grant execute on function public.find_event_host_staff_session(text) to service_role;

create table public.event_host_staffing_state (
  id text primary key check (id = 'corporate-parties'),
  version integer not null check (version > 0),
  document jsonb not null check (jsonb_typeof(document) = 'object')
);
alter table public.event_host_staffing_state enable row level security;
revoke all on public.event_host_staffing_state from public, anon, authenticated;
grant select, insert, update on public.event_host_staffing_state to service_role;

create table public.event_host_auth_attempts (
  attempt_key text primary key check (char_length(attempt_key) between 1 and 90),
  window_started timestamptz not null,
  attempts integer not null check (attempts between 1 and 9)
);
create index event_host_auth_attempts_window_idx on public.event_host_auth_attempts (window_started);
alter table public.event_host_auth_attempts enable row level security;
revoke all on public.event_host_auth_attempts from public, anon, authenticated;
grant select, insert, update, delete on public.event_host_auth_attempts to service_role;

create function public.record_event_host_auth_attempt(p_attempt_key text)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  insert into public.event_host_auth_attempts as existing (attempt_key, window_started, attempts)
  values (p_attempt_key, statement_timestamp(), 1)
  on conflict (attempt_key) do update
  set window_started = case
    when existing.window_started <= statement_timestamp() - interval '15 minutes' then statement_timestamp()
    else existing.window_started end,
    attempts = case
      when existing.window_started <= statement_timestamp() - interval '15 minutes' then 1
      else least(existing.attempts + 1, 9) end
  returning attempts <= 8;
$$;
revoke all on function public.record_event_host_auth_attempt(text) from public, anon, authenticated;
grant execute on function public.record_event_host_auth_attempt(text) to service_role;

commit;
