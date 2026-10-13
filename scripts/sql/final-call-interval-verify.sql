-- Read-only checks; no customer rows or credentials are returned.
-- A PASS here verifies database structure/permissions, not live Tripleseat coverage.
begin read only;
with objects as (
  select to_regclass('public.entertainment_source_reads') as receipts,
    to_regprocedure('public.final_call_read_entertainment_interval(timestamptz,timestamptz)') as rpc,
    (select oid from pg_roles where rolname = 'service_role') as service
), checks(check_name, passed) as (
  select 'receipt_table_and_rls', exists (
    select 1 from pg_class c where c.oid = receipts and c.relkind = 'r' and c.relrowsecurity
  ) from objects
  union all
  select 'service_receipts_append_only',
    has_table_privilege(service, receipts, 'SELECT') and
    has_table_privilege(service, receipts, 'INSERT') and
    not has_table_privilege(service, receipts, 'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') and
    not has_any_column_privilege(service, receipts, 'UPDATE,REFERENCES') from objects
  union all
  select 'browser_receipts_denied', receipts is not null and
    (select count(*) = 2 from pg_roles where rolname in ('anon', 'authenticated')) and
    not exists (
      select 1 from pg_roles r where r.rolname in ('anon', 'authenticated') and (
        has_table_privilege(r.oid, receipts, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') or
        has_any_column_privilege(r.oid, receipts, 'SELECT,INSERT,UPDATE,REFERENCES')
      )
    ) from objects
  union all
  select 'rpc_invoker_stable_jsonb', exists (
    select 1 from pg_proc p where p.oid = rpc and not p.prosecdef
      and p.provolatile = 's' and p.prorettype = 'jsonb'::regtype
      and p.proconfig @> array['search_path=""']
  ) from objects
  union all
  select 'service_rpc_allowed', has_function_privilege(service, rpc, 'EXECUTE') from objects
  union all
  select 'browser_rpc_denied', rpc is not null and
    (select count(*) = 2 from pg_roles where rolname in ('anon', 'authenticated')) and
    not exists (
      select 1 from pg_roles r where r.rolname in ('anon', 'authenticated')
        and has_function_privilege(r.oid, rpc, 'EXECUTE')
    ) from objects
  union all
  select 'three_indexes_ready', count(*) = 3 from pg_index
    where indexrelid in (
      to_regclass('public.entertainment_source_reads_recorded_idx'),
      to_regclass('public.entertainment_reservations_overlap_idx'),
      to_regclass('public.entertainment_events_overlap_idx')
    ) and indisvalid and indisready
)
select check_name, case when passed then 'PASS' else 'STOP' end as result
from checks order by check_name;
rollback;
