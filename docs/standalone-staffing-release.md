# Event Host: standalone staffing release

This release is independent of Staff Tools and ShiftFlow. It adds the 7shifts-based team editor, home-card staffing alerts, and Kitchen and Checklist suggestions. It does not include a Staff Tools route, employee sign-in change, credential, or new scheduled job. While Staff Tools sign-in is off, only a signed-in staffing Admin can see the staffing roster, names, alerts, and form suggestions; ordinary Event Host access is unchanged. VIP cards still say **Shift Lead**.

## Review before activation

1. Confirm the production baseline and rollback deployment. Review the separate standalone migration in this branch: it adds only the staffing snapshot, Admin attempt limiter, and its service-only function. It does not consume or alter the pending Staff Tools migrations or the retained pairing database.
2. Exercise the exact release using an isolated synthetic database and a synthetic schedule. Verify service-only privileges, RLS, Admin sign-in and rate limiting, correct event/date identity, no signed-out roster or prefills, stale-version rejection, multi-select, removal and moves, and blocked double-booking. Verify all new writes are denied in the shared read-only Preview; test writes only on an isolated synthetic setup. Validate a redacted real contract against the generated Kitchen Sheet before promotion.
3. On separate go-live approval, apply only the reviewed migration to the exact Event Host project and verify its permissions. Configure the exact HTTPS origin, a new strong Admin passphrase, and approved server-only 7shifts access for the verified company/location and exactly one Corporate Parties station, role or department ID. Use the existing server-side session secret when it meets the strong Admin requirements. Do not disclose staff schedules or copy production data into previews.
4. Deploy with staffing off first when practical. When ready, enable `EVENT_HOST_STAFFING_ADMIN_ENABLED` for the verified release and sign in separately as Admin. Enabling it replaces the legacy Admin PIN with the passphrase; it does not change the ordinary staff access flow. Start with the Admin **Sync published shifts** button. This staffing sync uses the existing saved Tripleseat access token without refreshing or reconnecting; if the token is unavailable, near expiry, or rejected, it stops without replacing the last verified snapshot. Keep Staff Tools sign-in and automatic staffing refresh off.

New prefill names are suggestions created from explicitly assigned, verified staff. They do not overwrite saved Kitchen or Checklist values, count as checklist evidence, or write to 7shifts. Use **Cancel** or discard local edits when testing with synthetic data; never seed the earlier demonstration choices in production.

## Assigning staff on a selected future date

The home-card **Assign Staff** button opens the event's multi-select roster directly inside that card. If a session is needed, enter the existing Admin passphrase in the card's inline unlock form; this uses the same protected session and rate limiter without navigating to Admin. If the schedule needs verification, explicitly choose **Load employees for this day** in the card. This verifies the seven days starting on the selected date, including boundary-event metadata for overnight conflict checks, and updates automatic matches. Opening a card or unlocking it never triggers upstream reads or a token refresh. Manual team changes require **Save staffing team**.

Only one schedule week is verified at a time. Switching weeks retains manual teams and unresolved alerts outside that week, but does not verify their coverage or allow their old data to prefill operational forms. Verify the other week again before editing its teams. Freshness uses the actual observation time, expires after 45 minutes or an Eastern calendar-day change, and is never extended by saving an assignment.

This date-selection change uses the existing versioned staffing document; it requires no new database migration. Preserve the configured owner-approved Admin credential and keep Staff Tools sign-in and handoff off during this release.

## Rollback

Restore the previous known-good deployment (or turn off the standalone Admin flag and redeploy). Confirm the previous Admin and staff behavior and keep the standalone staffing rows intact for review. Do not drop databases, replay unrelated migrations, reuse staging credentials, or change any Staff Tools or ShiftFlow settings.
