begin;

with refill_mappings(source_key, display_name, station, product_uuid) as (
  values
    ('taco-beef', 'Beef', 'GRILL', 'prd_bGlSvHq~dy9QbtdEXqBKW5Y0'),
    ('taco-chicken', 'Chicken', 'GRILL', 'prd_XrI9ZCzsIteJV0Gqz6S2j5Fr'),
    ('taco-black-beans', 'Black Beans', 'EXPO', 'prd_v9fl2nUni3QQAME8OeZvrSOQ'),
    ('taco-tortillas', 'Tortillas', 'COLD_PREP', 'prd_gamBENwj2AJBUbUIw~boSC2e'),
    ('taco-lettuce-wraps', 'Lettuce Wraps', 'COLD_PREP', 'prd_xGcUZCrlmWRjQWHNLVJrbypQ'),
    ('taco-tomatoes', 'Tomatoes', 'COLD_PREP', 'prd_Sy0RFPDLIbkfujg73Y2UxAh2'),
    ('taco-lettuce', 'Lettuce', 'COLD_PREP', 'prd_Q29IkXou3SgXNiYKW0OaYq9E'),
    ('taco-sour-cream', 'Sour Cream', 'COLD_PREP', 'prd_tagjc7bj9rjp2ji41BbNkMbs'),
    ('taco-diced-onion', 'Diced Onion', 'COLD_PREP', 'prd_U_nN8bGXnhg8e6DrgJEIWXxk'),
    ('taco-shredded-cheese', 'Shredded Cheese', 'COLD_PREP', 'prd_diqzv5vanLasQhulIvB7mBxL'),
    ('taco-salsa', 'Salsa', 'COLD_PREP', 'prd_HZCkuArB1_UbPCQ0RFQNfqNM'),
    ('appetizer-refill-tater-kegs', 'Tater Kegs', 'FRYER', 'prd_4EGxn~hzX94JKyomJjb9f09T'),
    ('appetizer-refill-mozzarella-sticks', 'Mozzarella Sticks', 'FRYER', 'prd_r9_GAyvRBsWq9ZGdv9YWxvqL'),
    ('appetizer-refill-chicken-tenders', 'Chicken Tenders', 'FRYER', 'prd_x1R9l1G~G3JvH9QsgbFYlWR6'),
    ('appetizer-refill-marinara', 'Marinara', 'COLD_PREP', 'prd_xPjiPxpYWKMD86DlMazf~tvX'),
    ('appetizer-refill-ranch', 'Ranch', 'COLD_PREP', 'prd_wM9dm63TdPWBKXszBSuaJKhu'),
    ('wing-refill-wings', 'Wings', 'FRYER', 'prd_Ygwt7EFZ1Za6XPC50OBinTq3'),
    ('wing-refill-fries', 'Fries', 'FRYER', 'prd_L2rZUgTm4zy06mSc2JZky5BP'),
    ('wing-refill-ranch', 'Ranch', 'COLD_PREP', 'prd_wM9dm63TdPWBKXszBSuaJKhu'),
    ('wing-refill-bbq', 'BBQ', 'COLD_PREP', 'prd_a7f6Zpe_0WsCxf_yftoeP1pA'),
    ('wing-refill-garlic-parm', 'Garlic Parm', 'COLD_PREP', 'prd_PTAj89JiWG_7Y6ZqUwxbvLpc'),
    ('wing-refill-buffalo', 'Buffalo Sauce', 'COLD_PREP', 'prd_vKYxPhSn1KFaofG7ZzJi_Wll')
), pan_sizes(pan_size) as (
  values ('NOT_APPLICABLE'), ('THIRD_PAN'), ('HALF_PAN')
)
insert into public.event_food_product_mappings (
  canonical_product_key,
  source_system,
  source_product_key,
  source_product_name,
  aliases,
  display_name,
  pan_size,
  preparation_station,
  gotab_product_uuid,
  mapping_status,
  verified_at
)
select
  'addon:' || refill_mappings.source_key,
  'EVENT_HOST',
  'addon:' || refill_mappings.source_key,
  refill_mappings.display_name,
  '[]'::jsonb,
  refill_mappings.display_name,
  pan_sizes.pan_size,
  refill_mappings.station,
  refill_mappings.product_uuid,
  'VERIFIED',
  now()
from refill_mappings
cross join pan_sizes
on conflict (source_system, source_product_key, pan_size) do update set
  gotab_product_uuid = excluded.gotab_product_uuid,
  mapping_status = excluded.mapping_status,
  verified_at = excluded.verified_at,
  updated_at = now();

commit;
