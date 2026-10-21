-- Phase 2 only: apply after the checked-RPC application is promoted and verified.
-- Do not batch this with the compatibility expansion during a live rollout.
-- Emergency rollback, only with the previous application rollback coordinated:
--   begin;
--   drop trigger event_host_checklists_require_checked_save on public.event_host_checklists;
--   grant execute on function public.save_event_host_floor_plan(jsonb, text, text) to service_role;
--   commit;
-- This restores old server writes; it does not remove data, columns, or history.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $$
begin
  if to_regprocedure('public.save_event_host_floor_plan_checked(jsonb,text,text)') is null
    or coalesce(position('event_host.checklist_checked_save' in pg_get_functiondef(to_regprocedure('public.save_event_host_checklist_checked(jsonb,timestamptz,boolean)'))), 0) = 0
    or coalesce(position('save_event_host_floor_plan_checked' in pg_get_functiondef(to_regprocedure('public.save_event_host_floor_plan(jsonb,text,text)'))), 0) = 0 then
    raise exception 'Install and verify the staff-workflow compatibility expansion before the write cutover.';
  end if;
end;
$$;

create or replace function public.event_host_enforce_checked_checklist_write()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if current_setting('event_host.checklist_checked_save', true) is distinct from new.event_id::text then
    raise exception using errcode = 'PT409', message = 'Reload Event Host before saving. This older application version cannot save checklists safely.';
  end if;
  return new;
end;
$$;

revoke all on function public.event_host_enforce_checked_checklist_write()
  from public, anon, authenticated;

create trigger event_host_checklists_require_checked_save
  before insert or update on public.event_host_checklists
  for each row execute function public.event_host_enforce_checked_checklist_write();

-- Retire the old server writer only after production uses the checked RPC.
revoke all on function public.save_event_host_floor_plan(jsonb, text, text)
  from public, anon, authenticated, service_role;

commit;
