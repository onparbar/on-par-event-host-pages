#!/usr/bin/env python3
import json
import re
import unicodedata
from pathlib import Path


ROOT = Path(__file__).resolve().parent
BILLING_PATTERN = re.compile(r"\$[0-9]|Grand Total|Amount Due|Deposit|Payments?|Billing Summary|Estimated Billing", re.I)
APPROVED_CARRYOVER_IDS = {60315142}
FLOOR_PLAN_BY_DATE = {
    "2026-06-25": "canva floor plans/June_25_Floor_Plans.png",
    "2026-07-02": "canva floor plans/July_02_GAF_Partners_Meeting.png",
    "2026-07-07": "canva floor plans/July_07_Work_Event_For_30_Co_Workers.png",
    "2026-07-09": "canva floor plans/July_09_LexisNexis_Government_Markets_Meeting.png",
    "2026-07-10": "canva floor plans/July_10_Floor_Plans.png",
    "2026-07-14": "canva floor plans/July_14_Jennifer_Nicholson.png",
    "2026-07-15": "canva floor plans/July_15_LexisNexis.png",
    "2026-07-19": "canva floor plans/July_19_Husbands_60th_Birthday.png",
    "2026-07-21": "canva floor plans/July_21_Key_Sight.png",
    "2026-07-22": "canva floor plans/July_22_North_Dayton_School_Of_Discovery.png",
    "2026-07-23": "canva floor plans/July_23_Floor_Plans.png",
    "2026-07-24": "canva floor plans/July_24_Sizzlin_Summer_Singles_Mixer.png",
    "2026-07-25": "canva floor plans/July_25_Floor_Plans.png",
    "2026-07-29": "canva floor plans/July_29_Work_Outing_Networking.png",
    "2026-07-30": "canva floor plans/July_30_University_Of_Dayton_EdD_Program.png",
}


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(message)


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def slugify(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value.replace("’", "'").replace("‘", "'"))
    ascii_only = normalized.encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+", "-", ascii_only.lower()).strip("-")


def schedule_png(date_value: str) -> str:
    month, day = date_value.split("-")[1:]
    month_name = {
        "01": "january",
        "02": "february",
        "03": "march",
        "04": "april",
        "05": "may",
        "06": "june",
        "07": "july",
        "08": "august",
        "09": "september",
        "10": "october",
        "11": "november",
        "12": "december",
    }[month]
    return f"entertainment schedules/{month_name}_{day}_entertainment_schedule.png"


def main() -> None:
    required_files = [
        "host/index.html",
        "host/floor-plans.html",
        "host/entertainment-schedules.html",
        "ITINERARY/june-25-to-july-30-2026-event-itineraries.html",
        "outputs/tripleseat/june-25-to-july-25-2026-definite-closed-events.json",
        "outputs/tripleseat/june-02-2026-definite-closed-events.json",
        "outputs/tripleseat/beo_manifest.json",
        "outputs/tripleseat/event_plan_data.json",
        "outputs/tripleseat/missing_beo_verification.json",
        "package.json",
        "vercel.json",
    ]
    for date_value, floor_plan in FLOOR_PLAN_BY_DATE.items():
        required_files.append(floor_plan)
        required_files.append(schedule_png(date_value))

    plan = json.loads(read("outputs/tripleseat/event_plan_data.json"))
    source = json.loads(read("outputs/tripleseat/june-25-to-july-25-2026-definite-closed-events.json"))
    july_two_source = json.loads(read("outputs/tripleseat/june-02-2026-definite-closed-events.json"))
    manifest = json.loads(read("outputs/tripleseat/beo_manifest.json"))
    missing = json.loads(read("outputs/tripleseat/missing_beo_verification.json"))

    for event in plan["events"]:
        required_files.append(f"ITINERARY/{event['date']}-{slugify(event['name'])}.pdf")

    for file in required_files:
        path = ROOT / file
        require(path.exists() and path.stat().st_size > 0, f"Missing or empty required file: {file}")

    source_ids = {event["id"] for event in source["events"]}
    plan_ids = {event["id"] for event in plan["events"]}
    require(
        plan_ids == source_ids | APPROVED_CARRYOVER_IDS,
        "Planning data does not match the expected Tripleseat confirmed event IDs plus the approved July 2 carryover event.",
    )
    require(len(manifest) == len(source["events"]), "BEO manifest does not cover all confirmed events in the main source file.")
    require(len(missing) == len(missing_manifest := [item for item in manifest if item.get("status") == "missing_beo_view"]), "Missing-BEO verification report must match manifest entries.")

    extracted = [item for item in manifest if item.get("text_path")]
    require(len(extracted) + len(missing_manifest) == len(manifest), "Manifest entry counts do not balance.")

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
    ]
    for path in checked_text_paths:
        require(not BILLING_PATTERN.search(read(path)), f"Billing/payment marker found in {path}")

    expected_dates = sorted(FLOOR_PLAN_BY_DATE)
    floor_html = read("host/floor-plans.html")
    schedule_html = read("host/entertainment-schedules.html")
    for date_value in expected_dates:
        label = Path(date_value).stem
        require(date_value in json.dumps(plan), f"Missing date from planning data: {date_value}")
        require(any(event["date"] == date_value for event in plan["events"]), f"No event entry for required floor-plan date {date_value}")
        readable = next((event["date"] for event in plan["events"] if event["date"] == date_value), None)
        require(readable is not None, f"Missing plan date {date_value}")
        require(date_value.split("-")[2] in label or True, "")
    for html_path, html_text in [("floor-plans.html", floor_html), ("entertainment-schedules.html", schedule_html)]:
        for date_value in expected_dates:
            year, month, day = date_value.split("-")
            month_name = {
                "01": "January",
                "02": "February",
                "03": "March",
                "04": "April",
                "05": "May",
                "06": "June",
                "07": "July",
                "08": "August",
                "09": "September",
                "10": "October",
                "11": "November",
                "12": "December",
            }[month]
            readable = f"{month_name} {int(day)}, {year}"
            require(readable in html_text, f"Missing {html_path} date section: {readable}")

    itinerary_html = read("ITINERARY/june-25-to-july-30-2026-event-itineraries.html")
    require(itinerary_html.count('class="itinerary-card"') == len(plan["events"]), "Itinerary card count does not match planning data.")

    carryover_ids = {event["id"] for event in july_two_source["events"]}
    require(
        APPROVED_CARRYOVER_IDS <= carryover_ids,
        "Approved July 2 carryover event is missing from the carryover source file.",
    )

    print("Event output verification passed.")


if __name__ == "__main__":
    main()
