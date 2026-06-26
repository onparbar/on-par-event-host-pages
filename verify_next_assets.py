#!/usr/bin/env python3
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parent
SOURCE_GLOBS = ["src/**/*.ts", "src/**/*.tsx"]


def main() -> None:
    public_refs: set[str] = set()
    for pattern in SOURCE_GLOBS:
        for path in ROOT.glob(pattern):
            text = path.read_text(encoding="utf-8")
            public_refs.update(
                re.findall(r'["\'](/(?:floor-plans|entertainment-schedules|itinerary-pdfs|itinerary-assets|data)/[^"\']+)["\']', text)
            )

    missing = []
    for ref in sorted(public_refs):
        asset = ROOT / "public" / ref.lstrip("/")
        if not asset.exists() or asset.stat().st_size == 0:
            missing.append(ref)

    if missing:
        raise SystemExit("Missing public assets:\n" + "\n".join(missing))

    required_routes = [
        "src/app/page.tsx",
        "src/app/checklists/page.tsx",
        "src/app/floor-plans/page.tsx",
        "src/app/entertainment-schedules/page.tsx",
        "src/app/itineraries/page.tsx",
    ]
    for route in required_routes:
        path = ROOT / route
        if not path.exists() or path.stat().st_size == 0:
            raise SystemExit(f"Missing Next route: {route}")

    print(f"Next asset verification passed for {len(public_refs)} public references.")


if __name__ == "__main__":
    main()
