begin;

create table if not exists public.event_food_product_mappings (
  id uuid primary key default gen_random_uuid(),
  canonical_product_key text not null,
  source_system text not null check (source_system in ('TRIPLESEAT', 'EVENT_HOST', 'VIP')),
  source_product_key text not null,
  source_product_name text not null,
  aliases jsonb not null default '[]'::jsonb check (jsonb_typeof(aliases) = 'array'),
  display_name text not null,
  pan_size text not null check (pan_size in ('THIRD_PAN', 'HALF_PAN', 'FULL_PAN', 'TRAY', 'EACH', 'DOZEN', 'BOWL', 'REFILL', 'NOT_APPLICABLE')),
  preparation_station text not null check (preparation_station in ('EXPO', 'FRYER', 'GRILL', 'COLD_PREP')),
  gotab_product_uuid text,
  mapping_status text not null default 'NEEDS_MAPPING' check (mapping_status in ('NEEDS_MAPPING', 'MAPPED', 'VERIFIED', 'DISABLED')),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_system, source_product_key, pan_size)
);

create table if not exists public.event_food_requests (
  id uuid primary key default gen_random_uuid(),
  event_id text not null,
  event_name text not null,
  tripleseat_event_id text,
  tripleseat_booking_id text,
  source_type text not null check (source_type in ('TRIPLESEAT_CONTRACT', 'EVENT_HOST_ADDON', 'VIP_ADDON', 'REFILL', 'CORRECTION', 'CANCELLATION')),
  source_record_id text not null,
  source_version bigint not null check (source_version > 0),
  canonical_product_key text not null,
  original_source_name text not null,
  display_name text not null,
  pan_size text not null check (pan_size in ('THIRD_PAN', 'HALF_PAN', 'FULL_PAN', 'TRAY', 'EACH', 'DOZEN', 'BOWL', 'REFILL', 'NOT_APPLICABLE')),
  quantity integer not null check (quantity > 0),
  preparation_station text not null check (preparation_station in ('EXPO', 'FRYER', 'GRILL', 'COLD_PREP')),
  event_area text,
  food_service_time timestamptz not null,
  prep_due_at timestamptz not null,
  requester_name text,
  request_notes text,
  dietary_notes text,
  allergy_notes text,
  approval_status text not null check (approval_status in ('DRAFT', 'AWAITING_APPROVAL', 'APPROVED', 'HELD', 'CANCELLED')),
  dispatch_status text not null check (dispatch_status in ('DRAFT', 'SCHEDULED', 'HELD', 'QUEUED_FOR_KITCHEN', 'SENDING', 'SENT_TO_GOTAB', 'CONFIRMED_BY_GOTAB', 'FAILED', 'NEEDS_PRODUCT_MAPPING', 'NEEDS_REVIEW', 'CORRECTED', 'CANCELLED')),
  gotab_product_uuid text,
  gotab_tab_uuid text,
  gotab_order_uuid text,
  gotab_item_uuid text,
  external_id text not null,
  idempotency_key text not null unique,
  retry_count integer not null default 0 check (retry_count >= 0),
  failure_reason text,
  dispatched_at timestamptz,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, source_type, source_record_id, source_version)
);

insert into public.event_food_product_mappings (
  canonical_product_key, source_system, source_product_key, source_product_name,
  aliases, display_name, pan_size, preparation_station, mapping_status
) values
  ('taco-beef', 'EVENT_HOST', 'taco-beef', 'Taco Bar Beef', '["Beef", "Taco Beef"]', 'Taco Bar Beef', 'THIRD_PAN', 'GRILL', 'NEEDS_MAPPING'),
  ('taco-chicken', 'EVENT_HOST', 'taco-chicken', 'Taco Bar Chicken', '["Chicken", "Taco Chicken"]', 'Taco Bar Chicken', 'THIRD_PAN', 'GRILL', 'NEEDS_MAPPING'),
  ('taco-black-beans', 'EVENT_HOST', 'taco-black-beans', 'Black Beans', '["Beans", "Taco Black Beans"]', 'Black Beans', 'THIRD_PAN', 'EXPO', 'NEEDS_MAPPING'),
  ('taco-tortillas', 'EVENT_HOST', 'taco-tortillas', 'Tortillas', '["Flour Tortillas", "Tortilla Pack"]', 'Tortillas', 'NOT_APPLICABLE', 'COLD_PREP', 'NEEDS_MAPPING'),
  ('taco-lettuce-wraps', 'EVENT_HOST', 'taco-lettuce-wraps', 'Lettuce Wraps', '["Lettuce Wrap", "Wraps"]', 'Lettuce Wraps', 'NOT_APPLICABLE', 'COLD_PREP', 'NEEDS_MAPPING'),
  ('taco-cold-sides', 'EVENT_HOST', 'taco-cold-sides', 'Cold Side Set', '["Cold Sides", "Taco Toppings"]', 'Taco Cold Sides', 'NOT_APPLICABLE', 'COLD_PREP', 'NEEDS_MAPPING'),
  ('wing-wings', 'EVENT_HOST', 'wing-wings', 'Wings', '["Traditional Wings", "Traditional Chicken Wings", "Chicken Wings"]', 'Wings', 'THIRD_PAN', 'FRYER', 'NEEDS_MAPPING'),
  ('wing-celery', 'EVENT_HOST', 'wing-celery', 'Celery', '["Celery Sticks", "Celery Half Sticks"]', 'Celery', 'NOT_APPLICABLE', 'COLD_PREP', 'NEEDS_MAPPING'),
  ('wing-fries', 'EVENT_HOST', 'wing-fries', 'Fries', '["French Fries", "Fry Platter"]', 'Fries', 'THIRD_PAN', 'FRYER', 'NEEDS_MAPPING'),
  ('appetizer-tater-kegs', 'EVENT_HOST', 'appetizer-tater-kegs', 'Tater Kegs', '["Tater Keg", "Loaded Tater Kegs"]', 'Tater Kegs', 'THIRD_PAN', 'FRYER', 'NEEDS_MAPPING'),
  ('appetizer-tater-kegs', 'EVENT_HOST', 'appetizer-tater-kegs', 'Tater Kegs', '["Tater Keg", "Loaded Tater Kegs"]', 'Tater Kegs', 'HALF_PAN', 'FRYER', 'NEEDS_MAPPING'),
  ('appetizer-mozzarella-sticks', 'EVENT_HOST', 'appetizer-mozzarella-sticks', 'Mozzarella Sticks', '["Mozz Sticks", "Mozzarella Stick"]', 'Mozzarella Sticks', 'THIRD_PAN', 'FRYER', 'NEEDS_MAPPING'),
  ('appetizer-mozzarella-sticks', 'EVENT_HOST', 'appetizer-mozzarella-sticks', 'Mozzarella Sticks', '["Mozz Sticks", "Mozzarella Stick"]', 'Mozzarella Sticks', 'HALF_PAN', 'FRYER', 'NEEDS_MAPPING'),
  ('appetizer-chicken-tenders', 'EVENT_HOST', 'appetizer-chicken-tenders', 'Chicken Tenders', '["Chicken Tender", "Tenders"]', 'Chicken Tenders', 'THIRD_PAN', 'FRYER', 'NEEDS_MAPPING'),
  ('appetizer-chicken-tenders', 'EVENT_HOST', 'appetizer-chicken-tenders', 'Chicken Tenders', '["Chicken Tender", "Tenders"]', 'Chicken Tenders', 'HALF_PAN', 'FRYER', 'NEEDS_MAPPING'),
  ('platter-tater-kegs', 'EVENT_HOST', 'platter-tater-kegs', 'Tater Kegs', '["Tater Keg Platter", "Tater Kegs Platter"]', 'Tater Kegs', 'THIRD_PAN', 'FRYER', 'NEEDS_MAPPING'),
  ('platter-tater-kegs', 'EVENT_HOST', 'platter-tater-kegs', 'Tater Kegs', '["Tater Keg Platter", "Tater Kegs Platter"]', 'Tater Kegs', 'HALF_PAN', 'FRYER', 'NEEDS_MAPPING'),
  ('platter-chicken-tenders', 'EVENT_HOST', 'platter-chicken-tenders', 'Chicken Tenders', '["Chicken Tender Platter", "Tenders Platter"]', 'Chicken Tenders', 'THIRD_PAN', 'FRYER', 'NEEDS_MAPPING'),
  ('platter-chicken-tenders', 'EVENT_HOST', 'platter-chicken-tenders', 'Chicken Tenders', '["Chicken Tender Platter", "Tenders Platter"]', 'Chicken Tenders', 'HALF_PAN', 'FRYER', 'NEEDS_MAPPING'),
  ('platter-mozzarella-sticks', 'EVENT_HOST', 'platter-mozzarella-sticks', 'Mozzarella Sticks', '["Mozzarella Stick Platter", "Mozz Sticks"]', 'Mozzarella Sticks', 'THIRD_PAN', 'FRYER', 'NEEDS_MAPPING'),
  ('platter-mozzarella-sticks', 'EVENT_HOST', 'platter-mozzarella-sticks', 'Mozzarella Sticks', '["Mozzarella Stick Platter", "Mozz Sticks"]', 'Mozzarella Sticks', 'HALF_PAN', 'FRYER', 'NEEDS_MAPPING'),
  ('platter-wings', 'EVENT_HOST', 'platter-wings', 'Wings', '["Wing Platter", "Traditional Wings Platter"]', 'Wings', 'THIRD_PAN', 'FRYER', 'NEEDS_MAPPING'),
  ('platter-wings', 'EVENT_HOST', 'platter-wings', 'Wings', '["Wing Platter", "Traditional Wings Platter"]', 'Wings', 'HALF_PAN', 'FRYER', 'NEEDS_MAPPING'),
  ('platter-fries', 'EVENT_HOST', 'platter-fries', 'Fries', '["Fry Platter", "French Fries Platter"]', 'Fries', 'THIRD_PAN', 'FRYER', 'NEEDS_MAPPING'),
  ('platter-fries', 'EVENT_HOST', 'platter-fries', 'Fries', '["Fry Platter", "French Fries Platter"]', 'Fries', 'HALF_PAN', 'FRYER', 'NEEDS_MAPPING'),
  ('platter-veggie-tray', 'EVENT_HOST', 'platter-veggie-tray', 'Veggie Tray', '["Vegetable Tray", "Assorted Vegetables"]', 'Veggie Tray', 'TRAY', 'COLD_PREP', 'NEEDS_MAPPING'),
  ('dessert-platter', 'EVENT_HOST', 'dessert-platter', 'Assorted Desserts', '["Cookies", "Dessert Platter", "Assorted Deserts"]', 'Assorted Desserts', 'TRAY', 'COLD_PREP', 'NEEDS_MAPPING'),
  ('sauce-marinara', 'EVENT_HOST', 'sauce-marinara', 'Marinara', '["Marinara Sauce", "Marinara Bowl"]', 'Marinara', 'BOWL', 'COLD_PREP', 'NEEDS_MAPPING'),
  ('sauce-ranch', 'EVENT_HOST', 'sauce-ranch', 'Ranch', '["Ranch Sauce", "Ranch Bowl"]', 'Ranch', 'BOWL', 'COLD_PREP', 'NEEDS_MAPPING'),
  ('addon:wings', 'EVENT_HOST', 'addon:wings', 'Wings', '["Wing Platter", "Wings"]', 'Wings', 'THIRD_PAN', 'FRYER', 'NEEDS_MAPPING'),
  ('addon:wings', 'EVENT_HOST', 'addon:wings', 'Wings', '["Wing Platter", "Wings"]', 'Wings', 'HALF_PAN', 'FRYER', 'NEEDS_MAPPING'),
  ('addon:tater-kegs', 'EVENT_HOST', 'addon:tater-kegs', 'Tater Kegs', '["Tater Keg Platter", "Tater Kegs"]', 'Tater Kegs', 'THIRD_PAN', 'FRYER', 'NEEDS_MAPPING'),
  ('addon:tater-kegs', 'EVENT_HOST', 'addon:tater-kegs', 'Tater Kegs', '["Tater Keg Platter", "Tater Kegs"]', 'Tater Kegs', 'HALF_PAN', 'FRYER', 'NEEDS_MAPPING'),
  ('addon:mozzarella-sticks', 'EVENT_HOST', 'addon:mozzarella-sticks', 'Mozzarella Sticks', '["Mozzarella Stick Platter", "Mozz Sticks"]', 'Mozzarella Sticks', 'THIRD_PAN', 'FRYER', 'NEEDS_MAPPING'),
  ('addon:mozzarella-sticks', 'EVENT_HOST', 'addon:mozzarella-sticks', 'Mozzarella Sticks', '["Mozzarella Stick Platter", "Mozz Sticks"]', 'Mozzarella Sticks', 'HALF_PAN', 'FRYER', 'NEEDS_MAPPING'),
  ('addon:fry-platters', 'EVENT_HOST', 'addon:fry-platters', 'Fries', '["Fry Platter", "French Fries"]', 'Fries', 'THIRD_PAN', 'FRYER', 'NEEDS_MAPPING'),
  ('addon:fry-platters', 'EVENT_HOST', 'addon:fry-platters', 'Fries', '["Fry Platter", "French Fries"]', 'Fries', 'HALF_PAN', 'FRYER', 'NEEDS_MAPPING'),
  ('addon:chicken-tenders', 'EVENT_HOST', 'addon:chicken-tenders', 'Chicken Tenders', '["Chicken Tender Platter", "Tenders"]', 'Chicken Tenders', 'THIRD_PAN', 'FRYER', 'NEEDS_MAPPING'),
  ('addon:chicken-tenders', 'EVENT_HOST', 'addon:chicken-tenders', 'Chicken Tenders', '["Chicken Tender Platter", "Tenders"]', 'Chicken Tenders', 'HALF_PAN', 'FRYER', 'NEEDS_MAPPING'),
  ('addon:veggie-tray', 'EVENT_HOST', 'addon:veggie-tray', 'Veggie Tray', '["Veggie Tray Platter", "Vegetable Tray"]', 'Veggie Tray', 'TRAY', 'COLD_PREP', 'NEEDS_MAPPING'),
  ('addon:dessert-platter', 'EVENT_HOST', 'addon:dessert-platter', 'Assorted Desserts', '["Assorted Desert Platter", "Dessert Platter"]', 'Assorted Desserts', 'TRAY', 'COLD_PREP', 'NEEDS_MAPPING'),
  ('addon:ranch', 'EVENT_HOST', 'addon:ranch', 'Ranch', '["Ranch Sauce", "Ranch Bowl"]', 'Ranch', 'BOWL', 'COLD_PREP', 'NEEDS_MAPPING'),
  ('addon:bbq-sauce', 'EVENT_HOST', 'addon:bbq-sauce', 'BBQ Sauce', '["BBQ", "Barbecue Sauce"]', 'BBQ Sauce', 'BOWL', 'COLD_PREP', 'NEEDS_MAPPING'),
  ('addon:garlic-parm', 'EVENT_HOST', 'addon:garlic-parm', 'Garlic Parm', '["Garlic Parmesan", "Garlic Parm Sauce"]', 'Garlic Parm', 'BOWL', 'COLD_PREP', 'NEEDS_MAPPING'),
  ('addon:buffalo-sauce', 'EVENT_HOST', 'addon:buffalo-sauce', 'Buffalo Sauce', '["Buffalo", "Buffalo Wing Sauce"]', 'Buffalo Sauce', 'BOWL', 'COLD_PREP', 'NEEDS_MAPPING'),
  ('refill-lettuce', 'EVENT_HOST', 'refill-lettuce', 'Lettuce Refill', '["Refill Lettuce", "Lettuce"]', 'Refill Lettuce', 'REFILL', 'COLD_PREP', 'NEEDS_MAPPING'),
  ('refill-lettuce-wraps', 'EVENT_HOST', 'refill-lettuce-wraps', 'Lettuce Wrap Refill', '["Refill Lettuce Wraps", "Lettuce Wraps"]', 'Refill Lettuce Wraps', 'REFILL', 'COLD_PREP', 'NEEDS_MAPPING'),
  ('refill-tomato', 'EVENT_HOST', 'refill-tomato', 'Tomato Refill', '["Refill Tomato", "Tomatoes"]', 'Refill Tomato', 'REFILL', 'COLD_PREP', 'NEEDS_MAPPING'),
  ('refill-onion', 'EVENT_HOST', 'refill-onion', 'Onion Refill', '["Refill Onion", "Onions"]', 'Refill Onion', 'REFILL', 'COLD_PREP', 'NEEDS_MAPPING'),
  ('refill-sour-cream', 'EVENT_HOST', 'refill-sour-cream', 'Sour Cream Refill', '["Refill Sour Cream", "Sour Cream"]', 'Refill Sour Cream', 'REFILL', 'COLD_PREP', 'NEEDS_MAPPING'),
  ('refill-salsa', 'EVENT_HOST', 'refill-salsa', 'Salsa Refill', '["Refill Salsa", "Salsa"]', 'Refill Salsa', 'REFILL', 'COLD_PREP', 'NEEDS_MAPPING'),
  ('refill-cheese', 'EVENT_HOST', 'refill-cheese', 'Cheese Refill', '["Refill Cheese", "Cheese"]', 'Refill Cheese', 'REFILL', 'COLD_PREP', 'NEEDS_MAPPING'),
  ('refill-tortillas', 'EVENT_HOST', 'refill-tortillas', 'Tortilla Refill', '["Refill Tortillas", "Tortillas"]', 'Refill Tortillas', 'REFILL', 'COLD_PREP', 'NEEDS_MAPPING'),
  ('refill-taco-beef', 'EVENT_HOST', 'refill-taco-beef', 'Taco Beef Refill', '["Refill Beef", "Taco Beef Refill"]', 'Refill Taco Beef', 'REFILL', 'GRILL', 'NEEDS_MAPPING'),
  ('refill-taco-chicken', 'EVENT_HOST', 'refill-taco-chicken', 'Taco Chicken Refill', '["Refill Chicken", "Taco Chicken Refill"]', 'Refill Taco Chicken', 'REFILL', 'GRILL', 'NEEDS_MAPPING'),
  ('refill-black-beans', 'EVENT_HOST', 'refill-black-beans', 'Black Beans Refill', '["Refill Black Beans", "Beans Refill"]', 'Refill Black Beans', 'REFILL', 'EXPO', 'NEEDS_MAPPING')
on conflict (source_system, source_product_key, pan_size) do nothing;

-- Verified against the hidden GoTab "Event Food" catalog on 2026-08-11.
-- Multiple Event Host pan-size rows intentionally point to the same GoTab platter product.
update public.event_food_product_mappings
set
  gotab_product_uuid = case
    when canonical_product_key in ('wing-wings', 'platter-wings', 'addon:wings') then 'prd_Ygwt7EFZ1Za6XPC50OBinTq3'
    when canonical_product_key in ('wing-fries', 'platter-fries', 'addon:fry-platters') then 'prd_L2rZUgTm4zy06mSc2JZky5BP'
    when canonical_product_key in ('appetizer-tater-kegs', 'platter-tater-kegs', 'addon:tater-kegs') then 'prd_4EGxn~hzX94JKyomJjb9f09T'
    when canonical_product_key in ('appetizer-mozzarella-sticks', 'platter-mozzarella-sticks', 'addon:mozzarella-sticks') then 'prd_r9_GAyvRBsWq9ZGdv9YWxvqL'
    when canonical_product_key in ('appetizer-chicken-tenders', 'platter-chicken-tenders', 'addon:chicken-tenders') then 'prd_x1R9l1G~G3JvH9QsgbFYlWR6'
    when canonical_product_key in ('platter-veggie-tray', 'addon:veggie-tray') then 'prd_AH1OPNSuHFaiMCT5cixMrLud'
    when canonical_product_key in ('dessert-platter', 'addon:dessert-platter') then 'prd_Q8wldxCOuOiElNL_3pxMpVDP'
    when canonical_product_key in ('taco-beef', 'refill-taco-beef') then 'prd_bGlSvHq~dy9QbtdEXqBKW5Y0'
    when canonical_product_key in ('taco-chicken', 'refill-taco-chicken') then 'prd_XrI9ZCzsIteJV0Gqz6S2j5Fr'
    when canonical_product_key in ('taco-black-beans', 'refill-black-beans') then 'prd_v9fl2nUni3QQAME8OeZvrSOQ'
    when canonical_product_key in ('taco-tortillas', 'refill-tortillas') then 'prd_gamBENwj2AJBUbUIw~boSC2e'
    when canonical_product_key in ('taco-lettuce-wraps', 'refill-lettuce-wraps') then 'prd_xGcUZCrlmWRjQWHNLVJrbypQ'
    when canonical_product_key = 'refill-lettuce' then 'prd_Q29IkXou3SgXNiYKW0OaYq9E'
    when canonical_product_key = 'refill-tomato' then 'prd_Sy0RFPDLIbkfujg73Y2UxAh2'
    when canonical_product_key = 'refill-onion' then 'prd_U_nN8bGXnhg8e6DrgJEIWXxk'
    when canonical_product_key = 'refill-sour-cream' then 'prd_tagjc7bj9rjp2ji41BbNkMbs'
    when canonical_product_key = 'refill-salsa' then 'prd_HZCkuArB1_UbPCQ0RFQNfqNM'
    when canonical_product_key = 'refill-cheese' then 'prd_diqzv5vanLasQhulIvB7mBxL'
    else gotab_product_uuid
  end,
  mapping_status = 'VERIFIED',
  verified_at = now(),
  updated_at = now()
where canonical_product_key in (
  'wing-wings', 'platter-wings', 'wing-fries', 'platter-fries',
  'addon:wings', 'addon:fry-platters',
  'appetizer-tater-kegs', 'platter-tater-kegs',
  'addon:tater-kegs',
  'appetizer-mozzarella-sticks', 'platter-mozzarella-sticks',
  'addon:mozzarella-sticks',
  'appetizer-chicken-tenders', 'platter-chicken-tenders',
  'addon:chicken-tenders',
  'platter-veggie-tray', 'addon:veggie-tray', 'dessert-platter', 'addon:dessert-platter',
  'taco-beef', 'refill-taco-beef', 'taco-chicken', 'refill-taco-chicken',
  'taco-black-beans', 'refill-black-beans', 'taco-tortillas', 'refill-tortillas',
  'taco-lettuce-wraps', 'refill-lettuce-wraps', 'refill-lettuce',
  'refill-tomato', 'refill-onion', 'refill-sour-cream', 'refill-salsa', 'refill-cheese'
);

create index if not exists event_food_requests_event_idx on public.event_food_requests (event_id, food_service_time);
create index if not exists event_food_requests_dispatch_idx on public.event_food_requests (dispatch_status, prep_due_at);

create table if not exists public.event_food_dispatches (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.event_food_requests (id) on delete restrict,
  idempotency_key text not null unique,
  action text not null check (action in ('DISPATCH', 'CORRECTION', 'CANCELLATION', 'TEST')),
  status text not null check (status in ('SCHEDULED', 'HELD', 'QUEUED', 'SENDING', 'DRY_RUN', 'SENT', 'CONFIRMED', 'FAILED', 'CANCELLED')),
  scheduled_at timestamptz not null,
  next_attempt_at timestamptz not null,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  locked_at timestamptz,
  locked_by text,
  sanitized_payload jsonb,
  sanitized_response jsonb,
  gotab_tab_uuid text,
  gotab_order_uuid text,
  gotab_item_uuid text,
  last_error text,
  sent_at timestamptz,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists event_food_dispatches_due_idx on public.event_food_dispatches (status, next_attempt_at);

create table if not exists public.event_food_exceptions (
  id uuid primary key default gen_random_uuid(),
  event_id text not null,
  source_type text not null check (source_type in ('TRIPLESEAT_CONTRACT', 'EVENT_HOST_ADDON', 'VIP_ADDON', 'REFILL', 'CORRECTION', 'CANCELLATION')),
  source_version bigint not null check (source_version > 0),
  item_key text not null,
  food_name text not null,
  reason text not null,
  status text not null default 'OPEN' check (status in ('OPEN', 'RESOLVED', 'IGNORED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, source_type, source_version, item_key, reason)
);

create index if not exists event_food_exceptions_open_idx on public.event_food_exceptions (status, created_at desc);

create table if not exists public.event_food_audit_log (
  id bigint generated always as identity primary key,
  event_id text not null,
  request_id uuid references public.event_food_requests (id) on delete restrict,
  dispatch_id uuid references public.event_food_dispatches (id) on delete restrict,
  action text not null,
  actor text not null,
  reason text,
  previous_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.gotab_webhook_receipts (
  receipt_id text primary key,
  event_type text not null,
  target_uuid text,
  location_uuid text,
  payload_hash text not null,
  status text not null check (status in ('PROCESSING', 'PROCESSED', 'IGNORED', 'FAILED')),
  error_message text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

create table if not exists public.gotab_integration_status (
  singleton boolean primary key default true check (singleton),
  connection_status text not null check (connection_status in ('NOT_CONFIGURED', 'CONNECTED', 'ERROR')),
  configured_location_uuid text,
  matched_location_name text,
  matched_location_uuid text,
  product_read_permission text not null default 'NOT_CHECKED',
  product_write_permission text not null default 'NOT_CHECKED',
  order_create_permission text not null default 'NOT_CHECKED',
  spot_read_permission text not null default 'NOT_CHECKED',
  station_read_permission text not null default 'NOT_CHECKED',
  webhook_status text not null default 'NOT_CONFIGURED',
  dry_run boolean not null default true,
  live_dispatch_enabled boolean not null default false,
  last_successful_connection_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);

alter table public.event_food_product_mappings enable row level security;
alter table public.event_food_requests enable row level security;
alter table public.event_food_dispatches enable row level security;
alter table public.event_food_exceptions enable row level security;
alter table public.event_food_audit_log enable row level security;
alter table public.gotab_webhook_receipts enable row level security;
alter table public.gotab_integration_status enable row level security;

revoke all on table public.event_food_product_mappings, public.event_food_requests,
  public.event_food_dispatches, public.event_food_exceptions, public.event_food_audit_log,
  public.gotab_webhook_receipts, public.gotab_integration_status
  from public, anon, authenticated;

grant select, insert, update, delete on table public.event_food_product_mappings,
  public.event_food_requests, public.event_food_dispatches,
  public.event_food_exceptions, public.gotab_webhook_receipts, public.gotab_integration_status to service_role;
grant select, insert on table public.event_food_audit_log to service_role;
grant usage, select on sequence public.event_food_audit_log_id_seq to service_role;

create or replace function public.enqueue_event_food_request(
  p_request jsonb,
  p_dispatch jsonb,
  p_actor text,
  p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_request public.event_food_requests;
  inserted_dispatch public.event_food_dispatches;
begin
  select * into inserted_request
  from public.event_food_requests
  where idempotency_key = p_request->>'idempotency_key';
  if found then
    select * into inserted_dispatch
    from public.event_food_dispatches
    where request_id = inserted_request.id
    order by created_at
    limit 1;
    return jsonb_build_object(
      'request_id', inserted_request.id,
      'dispatch_id', inserted_dispatch.id,
      'duplicate', true
    );
  end if;

  insert into public.event_food_requests (
    event_id, event_name, tripleseat_event_id, tripleseat_booking_id, source_type,
    source_record_id, source_version, canonical_product_key,
    original_source_name, display_name, pan_size, quantity,
    preparation_station, event_area, food_service_time, prep_due_at,
    requester_name, request_notes, dietary_notes, allergy_notes,
    approval_status, dispatch_status, gotab_product_uuid, external_id,
    idempotency_key
  ) values (
    p_request->>'event_id', p_request->>'event_name', p_request->>'tripleseat_event_id', p_request->>'tripleseat_booking_id', p_request->>'source_type',
    p_request->>'source_record_id', (p_request->>'source_version')::bigint, p_request->>'canonical_product_key',
    p_request->>'original_source_name', p_request->>'display_name', p_request->>'pan_size', (p_request->>'quantity')::integer,
    p_request->>'preparation_station', p_request->>'event_area', (p_request->>'food_service_time')::timestamptz,
    (p_request->>'prep_due_at')::timestamptz, p_request->>'requester_name', p_request->>'request_notes',
    p_request->>'dietary_notes', p_request->>'allergy_notes', p_request->>'approval_status',
    p_request->>'dispatch_status', p_request->>'gotab_product_uuid', p_request->>'external_id', p_request->>'idempotency_key'
  ) returning * into inserted_request;

  insert into public.event_food_dispatches (
    request_id, idempotency_key, action, status, scheduled_at,
    next_attempt_at, sanitized_payload
  ) values (
    inserted_request.id, p_dispatch->>'idempotency_key', p_dispatch->>'action',
    p_dispatch->>'status', (p_dispatch->>'scheduled_at')::timestamptz,
    (p_dispatch->>'next_attempt_at')::timestamptz, p_dispatch->'sanitized_payload'
  ) returning * into inserted_dispatch;

  insert into public.event_food_audit_log (
    event_id, request_id, dispatch_id, action, actor, reason, new_value
  ) values (
    inserted_request.event_id, inserted_request.id, inserted_dispatch.id,
    'CREATED', p_actor, p_reason, to_jsonb(inserted_request)
  );

  return jsonb_build_object('request_id', inserted_request.id, 'dispatch_id', inserted_dispatch.id, 'duplicate', false);
end;
$$;

revoke all on function public.enqueue_event_food_request(jsonb, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.enqueue_event_food_request(jsonb, jsonb, text, text) to service_role;

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
    select id
    from public.event_food_dispatches
    where status in ('SCHEDULED', 'QUEUED', 'FAILED')
      and attempt_count < 5
      and next_attempt_at <= now()
      and (locked_at is null or locked_at < now() - interval '5 minutes')
    order by next_attempt_at, created_at
    for update skip locked
    limit p_limit
  )
  update public.event_food_dispatches dispatch
  set status = 'SENDING',
      locked_at = now(),
      locked_by = p_worker_id,
      attempt_count = dispatch.attempt_count + 1,
      updated_at = now()
  from due
  where dispatch.id = due.id
  returning dispatch.*;
end;
$$;

revoke all on function public.claim_event_food_dispatches(text, integer) from public, anon, authenticated;
grant execute on function public.claim_event_food_dispatches(text, integer) to service_role;

create or replace function public.admin_event_food_dispatch_action(
  p_request_id uuid,
  p_action text,
  p_actor text,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_request public.event_food_requests;
  current_dispatch public.event_food_dispatches;
begin
  if p_actor is null or btrim(p_actor) = '' or p_reason is null or btrim(p_reason) = '' then
    raise exception 'actor and reason are required';
  end if;
  select * into current_request from public.event_food_requests where id = p_request_id for update;
  if not found then raise exception 'request not found'; end if;
  select * into current_dispatch from public.event_food_dispatches where request_id = p_request_id order by created_at desc limit 1 for update;
  if not found then raise exception 'dispatch not found'; end if;

  if p_action = 'HOLD' and current_dispatch.status in ('SCHEDULED', 'QUEUED', 'FAILED') then
    update public.event_food_requests set dispatch_status = 'HELD', updated_at = now() where id = p_request_id;
    update public.event_food_dispatches set status = 'HELD', locked_at = null, locked_by = null, updated_at = now() where id = current_dispatch.id;
  elsif p_action = 'SEND_NOW' and current_dispatch.status in ('SCHEDULED', 'HELD', 'FAILED') then
    update public.event_food_requests set dispatch_status = 'QUEUED_FOR_KITCHEN', updated_at = now() where id = p_request_id;
    update public.event_food_dispatches set status = 'QUEUED', next_attempt_at = now(), locked_at = null, locked_by = null, last_error = null, updated_at = now() where id = current_dispatch.id;
  elsif p_action = 'RETRY' and current_dispatch.status = 'FAILED' then
    update public.event_food_requests set dispatch_status = 'QUEUED_FOR_KITCHEN', retry_count = retry_count + 1, failure_reason = null, updated_at = now() where id = p_request_id;
    update public.event_food_dispatches set status = 'QUEUED', next_attempt_at = now(), locked_at = null, locked_by = null, last_error = null, updated_at = now() where id = current_dispatch.id;
  elsif p_action = 'CANCEL' and current_dispatch.status in ('SCHEDULED', 'HELD', 'QUEUED', 'FAILED') then
    update public.event_food_requests set approval_status = 'CANCELLED', dispatch_status = 'CANCELLED', updated_at = now() where id = p_request_id;
    update public.event_food_dispatches set status = 'CANCELLED', locked_at = null, locked_by = null, updated_at = now() where id = current_dispatch.id;
  else
    raise exception 'action is not valid for the current dispatch status';
  end if;

  insert into public.event_food_audit_log (event_id, request_id, dispatch_id, action, actor, reason, previous_value, new_value)
  select current_request.event_id, current_request.id, current_dispatch.id, p_action, p_actor, p_reason,
    jsonb_build_object('request', to_jsonb(current_request), 'dispatch', to_jsonb(current_dispatch)),
    jsonb_build_object('request', to_jsonb(r), 'dispatch', to_jsonb(d))
  from public.event_food_requests r, public.event_food_dispatches d
  where r.id = current_request.id and d.id = current_dispatch.id;

  return jsonb_build_object('request_id', current_request.id, 'action', p_action);
end;
$$;

revoke all on function public.admin_event_food_dispatch_action(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.admin_event_food_dispatch_action(uuid, text, text, text) to service_role;

commit;
