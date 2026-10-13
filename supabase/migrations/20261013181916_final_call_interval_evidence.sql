begin;

-- Receipts contain only the minimal service projection, never raw Tripleseat payloads.
create table public.entertainment_source_reads (
  id uuid primary key,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  recorded_at timestamptz not null default clock_timestamp()
);
alter table public.entertainment_source_reads enable row level security;
revoke all on public.entertainment_source_reads from public, anon, authenticated, service_role;
grant select, insert on public.entertainment_source_reads to service_role;
create index entertainment_source_reads_recorded_idx on public.entertainment_source_reads(recorded_at);
create index entertainment_reservations_overlap_idx on public.entertainment_reservations(start_at, end_at) where active;
create index entertainment_events_overlap_idx on public.entertainment_event_snapshots(event_start_at, event_end_at) where active;

-- An invoker RPC keeps the existing service role boundary. No browser grants.
create function public.final_call_read_entertainment_interval(p_start timestamptz, p_end timestamptz)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare result jsonb;
begin
  if p_start is null or p_end is null or not isfinite(p_start) or not isfinite(p_end) or
    p_end <= p_start or p_end - p_start > interval '34 days' then
    raise exception 'Invalid entertainment interval';
  end if;
  select jsonb_build_object(
    'read_at', statement_timestamp(),
    'events', (select coalesce(jsonb_agg(to_jsonb(e)), '[]'::jsonb) from (
      select * from public.entertainment_event_snapshots
      where active and (event_start_at is null or event_end_at is null or
        not isfinite(event_start_at) or not isfinite(event_end_at) or event_end_at <= event_start_at or
        (event_start_at < p_end and event_end_at > p_start))
      order by event_id limit 10001
    ) e),
    'reservations', (select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) from (
      select * from public.entertainment_reservations
      where active and (not isfinite(start_at) or not isfinite(end_at) or end_at <= start_at or
        (start_at < p_end and end_at > p_start))
      order by id limit 10001
    ) r)
  ) into result;
  if jsonb_array_length(result->'events') > 10000 or jsonb_array_length(result->'reservations') > 10000 then
    raise exception 'Entertainment interval exceeds safe row limit';
  end if;
  return result;
end;
$$;
revoke all on function public.final_call_read_entertainment_interval(timestamptz,timestamptz) from public, anon, authenticated;
grant execute on function public.final_call_read_entertainment_interval(timestamptz,timestamptz) to service_role;

commit;
