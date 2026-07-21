#!/usr/bin/env python3
import json
import re
import shutil
import unicodedata
from pathlib import Path


ROOT = Path(__file__).resolve().parent
DATA_PATH = ROOT / "outputs" / "tripleseat" / "event_plan_data.json"

STATIC_ASSET_MAP = {
    "canva floor plans/June_09_The_Greentree_Group_Leadership_Event.png": "public/floor-plans/june-09-greentree.png",
    "canva floor plans/June_12_Oasis_Turf_Tree.png": "public/floor-plans/june-12-oasis.png",
    "canva floor plans/June_13_Graduation_Party.png": "public/floor-plans/june-13-graduation-party.png",
    "canva floor plans/June_14_OPE_Employee_Appreciation_Patio_Party.png": "public/floor-plans/june-14-ope-employee-appreciation-patio-party.png",
    "canva floor plans/June_20_Floor_Plans.png": "public/floor-plans/june-20-floor-plans.png",
    "canva floor plans/June_23_RAM_Residents.png": "public/floor-plans/june-23-ram-residents.png",
    "canva floor plans/June_24_Floor_Plans.png": "public/floor-plans/june-24-floor-plans.png",
    "canva floor plans/June_25_Floor_Plans.png": "public/floor-plans/june-25-floor-plans.png",
    "canva floor plans/July_02_GAF_Partners_Meeting.png": "public/floor-plans/july-02-gaf-partners-meeting.png",
    "canva floor plans/July_07_Work_Event_For_30_Co_Workers.png": "public/floor-plans/july-07-work-event-for-30-co-workers.png",
    "canva floor plans/July_09_LexisNexis_Government_Markets_Meeting.png": "public/floor-plans/july-09-lexisnexis-government-markets-meeting.png",
    "canva floor plans/July_10_Floor_Plans.png": "public/floor-plans/july-10-floor-plans.png",
    "canva floor plans/July_14_Jennifer_Nicholson.png": "public/floor-plans/july-14-jennifer-nicholson.png",
    "canva floor plans/July_15_LexisNexis.png": "public/floor-plans/july-15-lexisnexis.png",
    "canva floor plans/July_19_Husbands_60th_Birthday.png": "public/floor-plans/july-19-husbands-60th-birthday.png",
    "canva floor plans/July_21_Key_Sight.png": "public/floor-plans/july-21-key-sight.png",
    "canva floor plans/July_22_North_Dayton_School_Of_Discovery.png": "public/floor-plans/july-22-north-dayton-school-of-discovery.png",
    "canva floor plans/July_23_Floor_Plans.png": "public/floor-plans/july-23-floor-plans.png",
    "canva floor plans/July_24_Sizzlin_Summer_Singles_Mixer.png": "public/floor-plans/july-24-sizzlin-summer-singles-mixer.png",
    "canva floor plans/July_25_Floor_Plans.png": "public/floor-plans/july-25-floor-plans.png",
    "canva floor plans/July_29_Work_Outing_Networking.png": "public/floor-plans/july-29-work-outing-networking.png",
    "canva floor plans/July_30_University_Of_Dayton_EdD_Program.png": "public/floor-plans/july-30-university-of-dayton-edd-program.png",
    "entertainment schedules/may_30_entertainment_schedule.png": "public/entertainment-schedules/may-30-entertainment-schedule.png",
    "entertainment schedules/may_31_entertainment_schedule.png": "public/entertainment-schedules/may-31-entertainment-schedule.png",
    "entertainment schedules/june_05_entertainment_schedule.png": "public/entertainment-schedules/june-05-entertainment-schedule.png",
    "entertainment schedules/june_06_entertainment_schedule.png": "public/entertainment-schedules/june-06-entertainment-schedule.png",
    "entertainment schedules/june_07_entertainment_schedule.png": "public/entertainment-schedules/june-07-entertainment-schedule.png",
    "entertainment schedules/june_09_entertainment_schedule.png": "public/entertainment-schedules/june-09-entertainment-schedule.png",
    "entertainment schedules/june_12_entertainment_schedule.png": "public/entertainment-schedules/june-12-entertainment-schedule.png",
    "entertainment schedules/june_13_entertainment_schedule.png": "public/entertainment-schedules/june-13-entertainment-schedule.png",
    "entertainment schedules/june_14_entertainment_schedule.png": "public/entertainment-schedules/june-14-entertainment-schedule.png",
    "entertainment schedules/june_20_entertainment_schedule.png": "public/entertainment-schedules/june-20-entertainment-schedule.png",
    "entertainment schedules/june_23_entertainment_schedule.png": "public/entertainment-schedules/june-23-entertainment-schedule.png",
    "entertainment schedules/june_24_entertainment_schedule.png": "public/entertainment-schedules/june-24-entertainment-schedule.png",
    "entertainment schedules/june_25_entertainment_schedule.png": "public/entertainment-schedules/june-25-entertainment-schedule.png",
    "entertainment schedules/july_02_entertainment_schedule.png": "public/entertainment-schedules/july-02-entertainment-schedule.png",
    "entertainment schedules/july_07_entertainment_schedule.png": "public/entertainment-schedules/july-07-entertainment-schedule.png",
    "entertainment schedules/july_09_entertainment_schedule.png": "public/entertainment-schedules/july-09-entertainment-schedule.png",
    "entertainment schedules/july_10_entertainment_schedule.png": "public/entertainment-schedules/july-10-entertainment-schedule.png",
    "entertainment schedules/july_14_entertainment_schedule.png": "public/entertainment-schedules/july-14-entertainment-schedule.png",
    "entertainment schedules/july_15_entertainment_schedule.png": "public/entertainment-schedules/july-15-entertainment-schedule.png",
    "entertainment schedules/july_19_entertainment_schedule.png": "public/entertainment-schedules/july-19-entertainment-schedule.png",
    "entertainment schedules/july_21_entertainment_schedule.png": "public/entertainment-schedules/july-21-entertainment-schedule.png",
    "entertainment schedules/july_22_entertainment_schedule.png": "public/entertainment-schedules/july-22-entertainment-schedule.png",
    "entertainment schedules/july_23_entertainment_schedule.png": "public/entertainment-schedules/july-23-entertainment-schedule.png",
    "entertainment schedules/july_24_entertainment_schedule.png": "public/entertainment-schedules/july-24-entertainment-schedule.png",
    "entertainment schedules/july_25_entertainment_schedule.png": "public/entertainment-schedules/july-25-entertainment-schedule.png",
    "entertainment schedules/july_29_entertainment_schedule.png": "public/entertainment-schedules/july-29-entertainment-schedule.png",
    "entertainment schedules/july_30_entertainment_schedule.png": "public/entertainment-schedules/july-30-entertainment-schedule.png",
    "outputs/tripleseat/event_plan_data.json": "public/data/event-plan-data.json",
}


def slugify(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value.replace("’", "'").replace("‘", "'"))
    ascii_only = normalized.encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+", "-", ascii_only.lower()).strip("-")


def copy_asset(source_path: Path, destination_path: Path) -> None:
    if not source_path.exists():
        raise SystemExit(f"Missing source asset: {source_path.relative_to(ROOT)}")
    destination_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source_path, destination_path)


def itinerary_asset_map() -> dict[str, str]:
    data = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    mapping: dict[str, str] = {}
    for event in data["events"]:
        filename = f"{event['date']}-{slugify(event['name'])}.pdf"
        mapping[f"ITINERARY/{filename}"] = f"public/itinerary-pdfs/{filename}"
    return mapping


def main() -> None:
    asset_map = {**STATIC_ASSET_MAP, **itinerary_asset_map()}
    for source, destination in asset_map.items():
        copy_asset(ROOT / source, ROOT / destination)
    print(f"Synced {len(asset_map)} assets into public.")


if __name__ == "__main__":
    main()
