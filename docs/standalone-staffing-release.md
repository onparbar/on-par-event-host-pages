# Event Host: standalone staffing release

This release is independent of Staff Tools and ShiftFlow. It adds the 7shifts-based team editor, home-card staffing alerts, and Kitchen and Checklist suggestions. It does not include a Staff Tools route, employee sign-in change, credential, or new scheduled job. While Staff Tools sign-in is off, only a signed-in staffing Admin can see the staffing roster, names, alerts, and form suggestions; ordinary Event Host access is unchanged. VIP cards still say **Shift Lead**.

## Review before activation

1. Confirm the production baseline and rollback deployment. Review the separate standalone migration in this branch: it adds only the staffing snapshot, Admin attempt limiter, and its service-only function. It does not consume or alter the pending Staff Tools migrations or the retained pairing database.
2. Exercise the exact release using an isolated synthetic database and a synthetic schedule. Verify service-only privileges, RLS, Admin sign-in and rate limiting, correct event/date identity, no signed-out roster or prefills, stale-version rejection, multi-select, removal and moves, and blocked double-booking. Verify all new writes are denied in the shared read-only Preview; test writes only on an isolated synthetic setup. Validate a redacted real contract against the generated Kitchen Sheet before promotion.
3. On separate go-live approval, apply only the reviewed migration to the exact Event Host project and verify its permissions. Configure the exact HTTPS origin, a new strong Admin passphrase, and approved server-only 7shifts access for the verified company/location and exactly one Corporate Parties station, role or department ID. Use the existing server-side session secret when it meets the strong Admin requirements. Do not disclose staff schedules or copy production data into previews.
4. Deploy with staffing off first when practical. When ready, enable `EVENT_HOST_STAFFING_ADMIN_ENABLED` for the verified release and sign in separately as Admin. Enabling it replaces the legacy Admin PIN with the passphrase; it does not change the ordinary staff access flow. Start with the Admin **Sync published shifts** button. Keep Staff Tools sign-in and automatic staffing refresh off.

New prefill names are suggestions created from explicitly assigned, verified staff. They do not overwrite saved Kitchen or Checklist values, count as checklist evidence, or write to 7shifts. Use **Cancel** or discard local edits when testing with synthetic data; never seed the earlier demonstration choices in production.

## Rollback

Restore the previous known-good deployment (or turn off the standalone Admin flag and redeploy). Confirm the previous Admin and staff behavior and keep the standalone staffing rows intact for review. Do not drop databases, replay unrelated migrations, reuse staging credentials, or change any Staff Tools or ShiftFlow settings.
