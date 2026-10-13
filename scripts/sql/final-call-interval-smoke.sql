-- Run only after every structural verification row is PASS.
-- Exercise the RPC under the actual service role, within a read-only transaction.
-- Only counts are returned; no reservation or receipt is written.
begin read only;
set local role service_role;
with snapshot as (
  select public.final_call_read_entertainment_interval(
    date_trunc('day', now()), date_trunc('day', now()) + interval '1 day'
  ) as value
)
select 'service_interval_read' as check_name,
  case when jsonb_typeof(value->'events') = 'array'
    and jsonb_typeof(value->'reservations') = 'array'
    and value->>'read_at' is not null then 'PASS' else 'STOP' end as result,
  jsonb_array_length(value->'events') as event_count,
  jsonb_array_length(value->'reservations') as reservation_count
from snapshot;
rollback;
