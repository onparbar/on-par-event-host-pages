begin;

create table if not exists public.kitchen_event_snapshots (
  event_id text primary key,
  booking_id text,
  event_name text not null,
  event_date date not null,
  status text,
  source_updated_at timestamptz,
  source_snapshot jsonb not null,
  synced_at timestamptz not null default now()
);

create index if not exists kitchen_event_snapshots_event_date_idx
  on public.kitchen_event_snapshots (event_date);

create table if not exists public.kitchen_checklists (
  event_id text primary key
    references public.kitchen_event_snapshots (event_id) on delete cascade,
  event_date date not null,
  rule_version text not null,
  checklist jsonb not null,
  source_updated_at timestamptz,
  generated_at timestamptz not null default now()
);

create index if not exists kitchen_checklists_event_date_idx
  on public.kitchen_checklists (event_date);

create table if not exists public.kitchen_manual_assignments (
  event_id text primary key,
  bwa text not null default ''
    check (char_length(bwa) <= 120),
  updated_at timestamptz not null default now()
);

create table if not exists public.kitchen_sync_runs (
  event_date date primary key,
  status text not null
    check (status in ('running', 'success', 'error')),
  started_at timestamptz not null,
  completed_at timestamptz,
  last_successful_sync_at timestamptz,
  event_count integer not null default 0
    check (event_count >= 0),
  error_message text,
  updated_at timestamptz not null default now()
);

create table if not exists public.kitchen_webhook_receipts (
  receipt_id text primary key,
  trigger_type text,
  source_event_id text,
  source_event_date date,
  signature_timestamp text not null,
  payload_hash text not null,
  status text not null
    check (status in ('processing', 'processed', 'ignored', 'failed')),
  error_message text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists kitchen_webhook_receipts_received_at_idx
  on public.kitchen_webhook_receipts (received_at);

create index if not exists kitchen_webhook_receipts_source_event_idx
  on public.kitchen_webhook_receipts (source_event_id);

create table if not exists public.kitchen_oauth_token_state (
  provider text primary key
    check (provider = 'tripleseat'),
  encrypted_tokens text not null,
  encryption_version smallint not null default 1
    check (encryption_version = 1),
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.kitchen_event_snapshots enable row level security;
alter table public.kitchen_checklists enable row level security;
alter table public.kitchen_manual_assignments enable row level security;
alter table public.kitchen_sync_runs enable row level security;
alter table public.kitchen_webhook_receipts enable row level security;
alter table public.kitchen_oauth_token_state enable row level security;

revoke all on table public.kitchen_event_snapshots
  from public, anon, authenticated;
revoke all on table public.kitchen_checklists
  from public, anon, authenticated;
revoke all on table public.kitchen_manual_assignments
  from public, anon, authenticated;
revoke all on table public.kitchen_sync_runs
  from public, anon, authenticated;
revoke all on table public.kitchen_webhook_receipts
  from public, anon, authenticated;
revoke all on table public.kitchen_oauth_token_state
  from public, anon, authenticated;

grant usage on schema public to service_role;
grant select, insert, update, delete
  on table public.kitchen_event_snapshots
  to service_role;
grant select, insert, update, delete
  on table public.kitchen_checklists
  to service_role;
grant select, insert, update, delete
  on table public.kitchen_manual_assignments
  to service_role;
grant select, insert, update, delete
  on table public.kitchen_sync_runs
  to service_role;
grant select, insert, update, delete
  on table public.kitchen_webhook_receipts
  to service_role;
grant select, insert, update, delete
  on table public.kitchen_oauth_token_state
  to service_role;

comment on table public.kitchen_event_snapshots is
  'Redacted, normalized Tripleseat event data used by the OPE kitchen dashboard.';
comment on table public.kitchen_manual_assignments is
  'Manual Food Runner/BWA assignments kept separate from Tripleseat synchronization.';
comment on table public.kitchen_oauth_token_state is
  'AES-256-GCM ciphertext only; never stores plaintext Tripleseat tokens.';

commit;
