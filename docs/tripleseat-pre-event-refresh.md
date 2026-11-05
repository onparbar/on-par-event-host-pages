# Pre-event Tripleseat refresh

Production checks saved Tripleseat event starts every five minutes. An eligible event becomes due 60 minutes before its start in America/New_York. The next scheduler run refreshes its date, combining multiple due events for that date. If the source records were already successfully refreshed within that event's hour, no duplicate refresh is needed.

The job uses the existing `CRON_SECRET` and live Tripleseat integration. It is disabled outside Production. It updates the event plan, floor plan, Entertainment Schedule and Kitchen source data; it does not send KDS orders, check in VIP guests, submit checklists or write to Tripleseat. Floor-plan and Entertainment writes check the revisions they read so a concurrent staff edit is not overwritten. Kitchen refreshes retain unverified saved records and staff prep history rather than deleting missing source rows.

The existing daily import still discovers new bookings. The one-hour trigger uses the saved start time, so a newly created booking or an event moved earlier must first be picked up by an import or manual sync. A change after the pre-event refresh still needs a manual sync. Reload an open Floor Plans or Entertainment page to see saved changes.

The cron result lists dates only. A failed date is eligible for retry on the next check while it still has a due event; use the manual sync if the event starts before the source recovers. `retainedKitchenRecords` counts saved Kitchen entries not re-verified by that refresh, which should be checked against the current contract before use.
