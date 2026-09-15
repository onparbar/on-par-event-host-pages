# GoTab Event Food production checklist

- [ ] Confirm the integration has no payment scopes, payment endpoints, guest payment fields, charges, authorizations, captures, or refunds.
- [ ] Confirm every test and production Event Food request is $0 and uses only the dedicated internal Event Food customer.

## Environment

- [ ] Rotate any credentials previously shared outside Vercel.
- [ ] Add `GOTAB_API_ACCESS_ID`, `GOTAB_API_ACCESS_SECRET`, and `GOTAB_LOCATION_UUID` as server-only Vercel variables.
- [ ] Add verified `GOTAB_EVENT_SPOT_UUID` and the On Par business number as `GOTAB_EVENT_CUSTOMER_PHONE`.
- [ ] Add a new `GOTAB_WEBHOOK_SECRET` directly in Vercel and GoTab Integration Dashboard.
- [ ] Set `EVENT_KDS_ENABLED=false` and `EVENT_KDS_DRY_RUN=true`.
- [ ] Set and approve `EVENT_KDS_DEFAULT_PREP_LEAD_MINUTES`.

## Capability and catalog

- [ ] Credentials authenticate and exact configured location is authorized.
- [ ] Menus/categories/products can be read.
- [ ] Spots, stations, station groups, and customer have been verified through supported APIs or GoTab Manager.
- [ ] Event Food category, hidden internal menu, spot, and customer exist.
- [ ] Provisioning manifest reviewed; unrelated catalog records unchanged.
- [ ] Every canonical product/pan combination has a GoTab UUID and one prep station.

## Safety

- [ ] Database migration applied and RLS/service-role permissions verified.
- [ ] Duplicate Tripleseat and GoTab webhook tests pass.
- [ ] Duplicate submit and retry tests pass.
- [ ] Dry-run payload contains no guest contact or credentials.
- [ ] Kill switch prevents all order creation.
- [ ] Missing mapping/station/pan/quantity prevents dispatch and creates an exception.

## Physical KDS acceptance

- [ ] `OPE KDS Integration Test` ticket displays the correct event and request label.
- [ ] Expo sees full context without duplicate actionable prep.
- [ ] Fryer receives only Fryer products.
- [ ] Grill receives only Grill products.
- [ ] Cold Prep receives cold products, or Expo receives them when Cold Prep is absent.
- [ ] Pan size and quantity are readable.
- [ ] Two separate salsa refills create two separate tickets.
- [ ] Correction and cancellation workflow is understood by staff.

## Enablement and rollback

- [ ] One authorized test ticket succeeds before live event dispatch is enabled.
- [ ] Existing Event Host Kitchen dashboard remains available as backup.
- [ ] Enable only after approval: `EVENT_KDS_ENABLED=true`, `EVENT_KDS_DRY_RUN=false`.
- [ ] Roll back by setting `EVENT_KDS_ENABLED=false`; preserve all request, dispatch, and audit records.
