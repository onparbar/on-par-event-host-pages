-- Read-only prerequisite checks. Run on the verified Event Host project.
-- Every row must say PASS before applying the source migration.
begin read only;
with objects as (
  select to_regclass('public.entertainment_event_snapshots') as events,
    to_regclass('public.entertainment_reservations') as reservations,
    (select oid from pg_roles where rolname = 'service_role') as service
), expected_columns(table_name, column_name, data_type) as (values
  ('entertainment_event_snapshots', 'event_id', 'text'),
  ('entertainment_event_snapshots', 'event_start_at', 'timestamp with time zone'),
  ('entertainment_event_snapshots', 'event_end_at', 'timestamp with time zone'),
  ('entertainment_event_snapshots', 'active', 'boolean'),
  ('entertainment_reservations', 'id', 'text'),
  ('entertainment_reservations', 'start_at', 'timestamp with time zone'),
  ('entertainment_reservations', 'end_at', 'timestamp with time zone'),
  ('entertainment_reservations', 'active', 'boolean')
), checks(check_name, passed) as (
  select 'existing_schedule_tables', events is not null and reservations is not null from objects
  union all
  select 'required_columns', not exists (
    select 1 from expected_columns e where not exists (
      select 1 from pg_attribute a
      where a.attrelid = to_regclass('public.' || e.table_name)
        and a.attname = e.column_name and not a.attisdropped
        and format_type(a.atttypid, a.atttypmod) = e.data_type
    )
  )
  union all
  select 'supabase_roles', count(*) = 3 from pg_roles
    where rolname in ('anon', 'authenticated', 'service_role')
  union all
  select 'service_can_read_existing_schedule',
    has_table_privilege(service, events, 'SELECT') and
    has_table_privilege(service, reservations, 'SELECT') from objects
  union all
  select 'service_bypasses_schedule_rls', coalesce((
    select rolbypassrls from pg_roles where rolname = 'service_role'
  ), false)
  union all
  select 'source_migration_objects_absent',
    to_regclass('public.entertainment_source_reads') is null and
    to_regprocedure('public.final_call_read_entertainment_interval(timestamptz,timestamptz)') is null and
    to_regclass('public.entertainment_source_reads_recorded_idx') is null and
    to_regclass('public.entertainment_reservations_overlap_idx') is null and
    to_regclass('public.entertainment_events_overlap_idx') is null
)
select check_name, case when passed then 'PASS' else 'STOP' end as result
from checks order by check_name;
rollback;
