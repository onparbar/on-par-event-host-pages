#!/usr/bin/env python3
import shutil
from pathlib import Path


ROOT = Path(__file__).resolve().parent

ASSET_MAP = {
    "canva floor plans/June_09_The_Greentree_Group_Leadership_Event.png": "public/floor-plans/june-09-greentree.png",
    "canva floor plans/June_12_Oasis_Turf_Tree.png": "public/floor-plans/june-12-oasis.png",
    "canva floor plans/June_13_Graduation_Party.png": "public/floor-plans/june-13-graduation-party.png",
    "canva floor plans/June_14_OPE_Employee_Appreciation_Patio_Party.png": "public/floor-plans/june-14-ope-employee-appreciation-patio-party.png",
    "canva floor plans/June_20_Floor_Plans.png": "public/floor-plans/june-20-floor-plans.png",
    "canva floor plans/June_23_RAM_Residents.png": "public/floor-plans/june-23-ram-residents.png",
    "canva floor plans/June_24_Floor_Plans.png": "public/floor-plans/june-24-floor-plans.png",
    "canva floor plans/June_25_Floor_Plans.png": "public/floor-plans/june-25-floor-plans.png",
    "canva floor plans/July_07_Work_Event_For_30_Co_Workers.png": "public/floor-plans/july-07-work-event-for-30-co-workers.png",
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
    "entertainment schedules/july_07_entertainment_schedule.png": "public/entertainment-schedules/july-07-entertainment-schedule.png",
    "outputs/tripleseat/event_plan_data.json": "public/data/event-plan-data.json",
}


def main() -> None:
    for source, destination in ASSET_MAP.items():
        source_path = ROOT / source
        destination_path = ROOT / destination
        if not source_path.exists():
            raise SystemExit(f"Missing source asset: {source}")
        destination_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source_path, destination_path)
    print(f"Synced {len(ASSET_MAP)} assets into public/.")


if __name__ == "__main__":
    main()
