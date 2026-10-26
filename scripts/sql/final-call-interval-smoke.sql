-- Run only after every structural verification row is PASS.
-- Exercise the RPC under the actual service role, within a read-only transaction.
-- Run the entire file as one submission. Only a PASS marker is returned.
-- No reservation or receipt is written.
begin read only;
set local role service_role;
do $$
declare snapshot jsonb;
begin
  snapshot := public.final_call_read_entertainment_interval(
    date_trunc('day', now()), date_trunc('day', now()) + interval '1 day'
  );
  if jsonb_typeof(snapshot->'events') is distinct from 'array'
    or jsonb_typeof(snapshot->'reservations') is distinct from 'array'
    or snapshot->>'read_at' is null then
    raise exception 'STOP: service interval response has an invalid shape';
  end if;
end;
$$;
rollback;
-- Keep the result last so clients that show only the final result display it.
select 'service_interval_read' as check_name, 'PASS' as result;
