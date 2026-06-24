#!/usr/bin/env python3
import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parent
BILLING_PATTERN = re.compile(r"\$[0-9]|Grand Total|Amount Due|Deposit|Payments?|Billing Summary|Estimated Billing", re.I)
EXPECTED_DATES = [
    "Tuesday, June 9, 2026",
    "Friday, June 12, 2026",
    "Saturday, June 13, 2026",
    "Sunday, June 14, 2026",
    "Saturday, June 20, 2026",
    "Tuesday, June 23, 2026",
    "Wednesday, June 24, 2026",
    "Thursday, June 25, 2026",
    "Tuesday, July 7, 2026",
]
REQUIRED_FILES = [
    "host/index.html",
    "host/floor-plans.html",
    "host/entertainment-schedules.html",
    "ITINERARY/june-09-30-2026-event-itineraries.html",
    "outputs/tripleseat/june-09-to-july-08-2026-definite-closed-events.json",
    "outputs/tripleseat/beo_manifest.json",
    "outputs/tripleseat/event_plan_data.json",
    "outputs/tripleseat/missing_beo_verification.json",
    "entertainment schedules/june_09_entertainment_schedule.png",
    "entertainment schedules/june_12_entertainment_schedule.png",
    "entertainment schedules/june_13_entertainment_schedule.png",
    "entertainment schedules/june_14_entertainment_schedule.png",
    "entertainment schedules/june_20_entertainment_schedule.png",
    "entertainment schedules/june_23_entertainment_schedule.png",
    "entertainment schedules/june_24_entertainment_schedule.png",
    "entertainment schedules/june_25_entertainment_schedule.png",
    "entertainment schedules/july_07_entertainment_schedule.png",
    "canva floor plans/June_09_The_Greentree_Group_Leadership_Event.png",
    "canva floor plans/June_12_Oasis_Turf_Tree.png",
    "canva floor plans/June_13_Graduation_Party.png",
    "canva floor plans/June_14_OPE_Employee_Appreciation_Patio_Party.png",
    "canva floor plans/June_20_Floor_Plans.png",
    "canva floor plans/June_23_RAM_Residents.png",
    "canva floor plans/June_24_Floor_Plans.png",
    "canva floor plans/June_25_Floor_Plans.png",
    "canva floor plans/July_07_Work_Event_For_30_Co_Workers.png",
    "package.json",
    "vercel.json",
]


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(message)


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def main() -> None:
    for file in REQUIRED_FILES:
        path = ROOT / file
        require(path.exists() and path.stat().st_size > 0, f"Missing or empty required file: {file}")

    source = json.loads(read("outputs/tripleseat/june-09-to-july-08-2026-definite-closed-events.json"))
    plan = json.loads(read("outputs/tripleseat/event_plan_data.json"))
    manifest = json.loads(read("outputs/tripleseat/beo_manifest.json"))
    missing = json.loads(read("outputs/tripleseat/missing_beo_verification.json"))

    source_ids = {event["id"] for event in source["events"]}
    plan_ids = {event["id"] for event in plan["events"]}
    require(source["count"] == 13, "Tripleseat confirmed event count is not 13.")
    require(source_ids == plan_ids, "Planning data does not match Tripleseat confirmed event IDs.")
    require(len(manifest) == 13, "BEO manifest does not cover all confirmed events.")

    extracted = [item for item in manifest if item.get("text_path")]
    missing_manifest = [item for item in manifest if item.get("status") == "missing_beo_view"]
    require(len(extracted) == 11, "Expected 11 extracted BEO text files.")
    require(len(missing_manifest) == 2, "Expected 2 missing BEO view manifest entries.")
    require(len(missing) == 2, "Missing-BEO verification report must cover 2 events.")
    for item in missing:
        require(item["event_documents_count"] == 0, f"Event documents unexpectedly present for {item['event_name']}")
        require(item["booking_documents_count"] == 0, f"Booking documents unexpectedly present for {item['event_name']}")
        require(item["event_attachments_count"] == 0, f"Attachments unexpectedly present for {item['event_name']}")

    for item in extracted:
        require(item.get("stopped_at_estimated_billing") is True, f"BEO was not cut at billing section: {item['event_name']}")
        text = Path(ROOT / item["text_path"]).read_text(encoding="utf-8")
        require(not BILLING_PATTERN.search(text), f"Billing/payment marker found in extracted BEO: {item['event_name']}")

    checked_text_paths = [
        "outputs/tripleseat/event_plan_data.json",
        "host/floor-plans.html",
        "host/entertainment-schedules.html",
        "ITINERARY/june-09-30-2026-event-itineraries.html",
    ]
    for path in checked_text_paths:
        require(not BILLING_PATTERN.search(read(path)), f"Billing/payment marker found in {path}")

    floor_html = read("host/floor-plans.html")
    schedule_html = read("host/entertainment-schedules.html")
    for expected in EXPECTED_DATES:
        require(expected in floor_html, f"Missing floor-plan date section: {expected}")
        require(expected in schedule_html, f"Missing schedule date section: {expected}")
    require([floor_html.index(date) for date in EXPECTED_DATES] == sorted(floor_html.index(date) for date in EXPECTED_DATES), "Floor-plan host dates are not ordered.")
    require([schedule_html.index(date) for date in EXPECTED_DATES] == sorted(schedule_html.index(date) for date in EXPECTED_DATES), "Schedule host dates are not ordered.")

    itinerary_html = read("ITINERARY/june-09-30-2026-event-itineraries.html")
    require(itinerary_html.count('class="itinerary-card"') == 13, "Itinerary must contain 13 event cards.")

    print("Event output verification passed.")


if __name__ == "__main__":
    main()
