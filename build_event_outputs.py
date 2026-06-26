#!/usr/bin/env python3
from __future__ import annotations

import datetime as dt
import html
import json
import re
import textwrap
from collections import defaultdict
from pathlib import Path

from PIL import Image, ImageColor, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parent
DATA_PATH = ROOT / "outputs" / "tripleseat" / "event_plan_data.json"
HOST_DIR = ROOT / "host"
SCHEDULE_DIR = ROOT / "entertainment schedules"
ITINERARY_DIR = ROOT / "ITINERARY"
FONT_BOLD = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
FONT_REGULAR = "/System/Library/Fonts/Supplemental/Arial.ttf"
SCHEDULE_TEMPLATE_PATH = ROOT / "templates" / "entertainment-schedule-template.png"
SCHEDULE_WIDTH = 1920
SCHEDULE_HEIGHT = 1080
SCHEDULE_TITLE_X = 50
SCHEDULE_HOUR_X = {
    11: 537,
    12: 646,
    13: 753,
    14: 848,
    15: 965,
    16: 1061,
    17: 1156,
    18: 1252,
    19: 1347,
    20: 1444,
    21: 1550,
    22: 1652,
}
SCHEDULE_BANDS = {
    "bowling": {"top": 151, "row_height": 27.5, "names": [f"lane {index}" for index in range(1, 13)]},
    "darts": {"top": 522, "row_height": 27.4, "names": [f"lane {index}" for index in range(1, 6)]},
    "pool": {"top": 700, "row_height": 27.5, "names": [f"table {index}" for index in range(1, 4)]},
    "karaoke": {"top": 823, "row_height": 27.5, "names": ["disco", "gem", "royal", "prime", "ocean"]},
    "shuffleboard": {"top": 998, "row_height": 27.5, "names": ["lane 1", "lane 2"]},
}

FLOOR_PLAN_BY_DATE = {
    "2026-06-25": "canva floor plans/June_25_Floor_Plans.png",
    "2026-07-07": "canva floor plans/July_07_Work_Event_For_30_Co_Workers.png",
    "2026-07-09": "canva floor plans/July_09_LexisNexis_Government_Markets_Meeting.png",
    "2026-07-10": "canva floor plans/July_10_Floor_Plans.png",
    "2026-07-14": "canva floor plans/July_14_Jennifer_Nicholson.png",
    "2026-07-15": "canva floor plans/July_15_LexisNexis.png",
    "2026-07-19": "canva floor plans/July_19_Husbands_60th_Birthday.png",
    "2026-07-21": "canva floor plans/July_21_Beacon_Investing.png",
    "2026-07-22": "canva floor plans/July_22_North_Dayton_School_Of_Discovery.png",
    "2026-07-23": "canva floor plans/July_23_Floor_Plans.png",
}


def load_font(path: str, size: int) -> ImageFont.ImageFont:
    try:
        return ImageFont.truetype(path, size=size)
    except Exception:
        return ImageFont.load_default()


def date_label(value: str, include_year: bool = True) -> str:
    date = dt.date.fromisoformat(value)
    fmt = "%A, %B %-d, %Y" if include_year else "%B %-d"
    return date.strftime(fmt)


def safe_date_file(value: str) -> str:
    date = dt.date.fromisoformat(value)
    return date.strftime("%B_%d").lower()


def wrap_lines(text: str, width: int) -> list[str]:
    return textwrap.wrap(text, width=width, break_long_words=False) or [""]


def draw_wrapped(draw: ImageDraw.ImageDraw, text: str, xy: tuple[int, int], font, fill, width_chars: int, line_height: int) -> int:
    x, y = xy
    for line in wrap_lines(text, width_chars):
        draw.text((x, y), line, font=font, fill=fill)
        y += line_height
    return y


def short_verification(text: str) -> str:
    if "no BEO document view" in text.lower():
        return "API fields checked; BEO view missing"
    if "BEO extracted" in text:
        return "BEO checked above billing section"
    return text


def ordinal_day(day: int) -> str:
    if 10 <= day % 100 <= 20:
        suffix = "TH"
    else:
        suffix = {1: "ST", 2: "ND", 3: "RD"}.get(day % 10, "TH")
    return f"{day}{suffix}"


def schedule_date_label(value: str) -> str:
    date = dt.date.fromisoformat(value)
    return f"{date.strftime('%A').upper()} {date.strftime('%B').upper()} {ordinal_day(date.day)}"


def parse_time_value(raw: str) -> float:
    value = raw.strip().lower().replace(" ", "").replace(".", "")
    match = re.fullmatch(r"(\d{1,2})(?::(\d{2}))?(am|pm)", value)
    if not match:
        raise ValueError(f"Could not parse time '{raw}'")

    hour = int(match.group(1))
    minute = int(match.group(2) or "0")
    meridiem = match.group(3)
    if meridiem == "pm" and hour < 12:
        hour += 12
    if meridiem == "am" and hour == 12:
        hour = 0
    return hour + minute / 60


def x_for_time(raw: str) -> float:
    value = parse_time_value(raw)
    floor_hour = int(value)
    ceil_hour = int(value) if value.is_integer() else int(value) + 1
    if float(floor_hour) == value:
        if floor_hour not in SCHEDULE_HOUR_X:
            raise ValueError(f"Time '{raw}' is outside the schedule range")
        return SCHEDULE_HOUR_X[floor_hour]

    if floor_hour not in SCHEDULE_HOUR_X or ceil_hour not in SCHEDULE_HOUR_X:
        raise ValueError(f"Time '{raw}' is outside the schedule range")
    fraction = value - floor_hour
    left = SCHEDULE_HOUR_X[floor_hour]
    right = SCHEDULE_HOUR_X[ceil_hour]
    return left + (right - left) * fraction


def quantity_number(raw: str) -> int:
    match = re.search(r"(\d+)", raw or "")
    return int(match.group(1)) if match else 0


def time_range_parts(raw: str) -> tuple[str, str] | None:
    match = re.search(r"(\d{1,2}(?::\d{2})?\s*[AP]M)\s*-\s*(\d{1,2}(?::\d{2})?\s*[AP]M)", raw or "", re.IGNORECASE)
    if not match:
        return None
    return match.group(1).upper(), match.group(2).upper()


def schedule_block_rows(item: dict) -> tuple[str, list[str]] | None:
    name = (item.get("name") or "").lower()
    quantity = quantity_number(item.get("quantity") or "")
    if "bowling" in name:
        count = min(max(quantity, 1), 12)
        return "bowling", [f"lane {index}" for index in range(1, count + 1)]
    if "darts" in name:
        count = min(max(quantity, 1), 5)
        return "darts", [f"lane {index}" for index in range(1, count + 1)]
    if "pool" in name:
        count = min(max(quantity, 1), 3)
        return "pool", [f"table {index}" for index in range(1, count + 1)]
    if "shuffleboard" in name:
        count = min(max(quantity, 1), 2)
        return "shuffleboard", [f"lane {index}" for index in range(1, count + 1)]
    if "disco" in name:
        return "karaoke", ["disco"]
    if "gem" in name:
        return "karaoke", ["gem"]
    if "royal" in name:
        return "karaoke", ["royal"]
    if "prime" in name:
        return "karaoke", ["prime"]
    if "ocean" in name:
        return "karaoke", ["ocean"]
    return None


def schedule_blocks_for_event(event: dict) -> list[dict]:
    blocks: list[dict] = []
    for item in event.get("entertainment") or []:
        time_parts = time_range_parts(item.get("time") or "")
        row_info = schedule_block_rows(item)
        if not time_parts or not row_info:
            continue
        category, rows = row_info
        blocks.append(
            {
                "category": category,
                "rows": rows,
                "start": time_parts[0],
                "end": time_parts[1],
            }
        )
    return blocks


def schedule_rect(block: dict) -> tuple[float, float, float, float]:
    band = SCHEDULE_BANDS[block["category"]]
    indices = [band["names"].index(row) for row in block["rows"]]
    first = min(indices)
    last = max(indices)
    left = x_for_time(block["start"])
    right = x_for_time(block["end"])
    top = band["top"] + first * band["row_height"]
    height = (last - first + 1) * band["row_height"]
    return left, top, right, top + height


def centered_text(draw: ImageDraw.ImageDraw, rect: tuple[float, float, float, float], text: str, font, fill) -> None:
    left, top, right, bottom = rect
    bbox = draw.textbbox((0, 0), text, font=font)
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]
    x = left + (right - left - text_width) / 2
    y = top + (bottom - top - text_height) / 2 - 2
    draw.text((x, y), text, font=font, fill=fill)


def block_label(start: str, end: str) -> str:
    return f"{start.replace(' ', '')}-{end.replace(' ', '')}"


def schedule_for_date(date: str, events: list[dict]) -> Path:
    image = Image.open(SCHEDULE_TEMPLATE_PATH).convert("RGBA")
    image = image.resize((SCHEDULE_WIDTH, SCHEDULE_HEIGHT))
    draw = ImageDraw.Draw(image, "RGBA")
    title_font = load_font(FONT_BOLD, 30)
    event_font = load_font(FONT_BOLD, 28)
    block_font = load_font(FONT_BOLD, 24)

    draw.text((SCHEDULE_TITLE_X, 31), schedule_date_label(date), font=title_font, fill="#000000")
    title_y = 67
    for event in events:
        size = 22 if len(event["name"]) > 30 else 28
        event_font = load_font(FONT_BOLD, size)
        draw.text((SCHEDULE_TITLE_X, title_y), event["name"], font=event_font, fill=event["color"])
        title_y += 34

    for event in events:
        rgb = ImageColor.getrgb(event["color"])
        fill = (*rgb, 128)
        for block in schedule_blocks_for_event(event):
            rect = schedule_rect(block)
            draw.rectangle(rect, fill=fill)
            centered_text(draw, rect, block_label(block["start"], block["end"]), block_font, "#000000")

    out = SCHEDULE_DIR / f"{safe_date_file(date)}_entertainment_schedule.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    image.save(out)
    return out


def html_page(title: str, body: str) -> str:
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{html.escape(title)}</title>
  <style>
    :root {{ color-scheme: light; --ink:#202326; --muted:#5d6670; --line:#d8ddd7; --paper:#f7f8f4; }}
    * {{ box-sizing:border-box; }}
    body {{ margin:0; font-family: Arial, Helvetica, sans-serif; color:var(--ink); background:var(--paper); }}
    header {{ position:sticky; top:0; z-index:2; padding:18px 28px; background:#202326; color:white; }}
    h1 {{ margin:0; font-size:24px; letter-spacing:0; }}
    main {{ max-width:1320px; margin:0 auto; padding:26px; }}
    section {{ margin:0 0 34px; padding-bottom:30px; border-bottom:1px solid var(--line); }}
    h2 {{ margin:0 0 8px; font-size:24px; }}
    .meta {{ margin:0 0 18px; color:var(--muted); }}
    .event-row {{ display:flex; gap:10px; flex-wrap:wrap; margin:10px 0 16px; }}
    .event-chip {{ border-left:8px solid var(--event-color); background:white; padding:8px 10px; border-radius:6px; box-shadow:0 1px 0 rgba(32,35,38,.08); }}
    img {{ display:block; width:100%; height:auto; border:1px solid var(--line); background:white; }}
    .itinerary-grid {{ display:grid; grid-template-columns:repeat(auto-fit, minmax(310px,1fr)); gap:16px; }}
    .itinerary-card {{ background:white; border:1px solid var(--line); border-left:8px solid var(--event-color); border-radius:8px; padding:16px; }}
    .itinerary-card h3 {{ margin:0 0 8px; font-size:20px; }}
    .itinerary-card p {{ margin:6px 0; color:var(--muted); }}
    .itinerary-card ul {{ margin:8px 0 0 18px; padding:0; }}
    .itinerary-card li {{ margin:4px 0; }}
    @media (max-width:700px) {{ main {{ padding:16px; }} header {{ padding:16px; }} }}
  </style>
</head>
<body>
  <header><h1>{html.escape(title)}</h1></header>
  <main>
{body}
  </main>
</body>
</html>
"""


def rel(path: str | Path, from_dir: Path) -> str:
    return Path(path).resolve().relative_to(from_dir.resolve()).as_posix() if Path(path).is_absolute() else "../" + Path(path).as_posix()


def build_floor_host(events_by_date: dict[str, list[dict]]) -> Path:
    sections = []
    for date in sorted(FLOOR_PLAN_BY_DATE):
        events = events_by_date.get(date, [])
        chips = "".join(
            f'<span class="event-chip" style="--event-color:{html.escape(event["color"])}">{html.escape(event["name"])} ({event["guest_count"]})</span>'
            for event in events
        )
        image = html.escape("../" + FLOOR_PLAN_BY_DATE[date])
        sections.append(
            f"""    <section>
      <h2>{html.escape(date_label(date))}</h2>
      <p class="meta">{len(events)} event{'s' if len(events) != 1 else ''}</p>
      <div class="event-row">{chips}</div>
      <img src="{image}" alt="Floor plan for {html.escape(date_label(date))}" />
    </section>"""
        )
    out = HOST_DIR / "floor-plans.html"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html_page("On Par Floor Plans", "\n".join(sections)), encoding="utf-8")
    return out


def build_schedule_host(schedule_paths: dict[str, Path], events_by_date: dict[str, list[dict]]) -> Path:
    sections = []
    for date in sorted(schedule_paths):
        events = events_by_date[date]
        chips = "".join(
            f'<span class="event-chip" style="--event-color:{html.escape(event["color"])}">{html.escape(event["name"])}</span>'
            for event in events
        )
        image = html.escape("../" + schedule_paths[date].relative_to(ROOT).as_posix())
        sections.append(
            f"""    <section>
      <h2>{html.escape(date_label(date))}</h2>
      <div class="event-row">{chips}</div>
      <img src="{image}" alt="Entertainment schedule for {html.escape(date_label(date))}" />
    </section>"""
        )
    out = HOST_DIR / "entertainment-schedules.html"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html_page("On Par Entertainment Schedules", "\n".join(sections)), encoding="utf-8")
    return out


def build_itinerary(events: list[dict]) -> Path:
    cards = []
    for event in sorted(events, key=lambda item: (item["date"], item["time"], item["name"])):
        food = "".join(f"<li>{html.escape(item)}</li>" for item in event.get("food") or [])
        drinks = "".join(f"<li>{html.escape(item)}</li>" for item in event.get("drink_options") or [])
        entertainment = event.get("entertainment") or []
        entertainment_html = "".join(
            f"<li>{html.escape(item['name'])}: {html.escape(item.get('quantity',''))}, {html.escape(item.get('time',''))}, {html.escape(item.get('duration',''))}</li>"
            for item in entertainment
        ) or "<li>No reserved entertainment listed on the available BEO/API fields.</li>"
        specials = "".join(f"<li>{html.escape(item)}</li>" for item in event.get("special_instructions") or [])
        special_block = f"<p><strong>Special Instructions</strong></p><ul>{specials}</ul>" if specials else ""
        cards.append(
            f"""      <article class="itinerary-card" style="--event-color:{html.escape(event['color'])}">
        <h3>{html.escape(event['name'])}</h3>
        <p>{html.escape(date_label(event['date']))} | {html.escape(event['time'])}</p>
        <p>{html.escape(str(event['guest_count']))} guests | {html.escape(', '.join(event['rooms']))}</p>
        <p><strong>Food</strong></p><ul>{food}</ul>
        <p><strong>Drink Options</strong></p><ul>{drinks}</ul>
        <p><strong>Entertainment</strong></p><ul>{entertainment_html}</ul>
        {special_block}
        <p>{html.escape(event['verification_status'])}</p>
      </article>"""
        )
    body = f'    <section><div class="itinerary-grid">\n{"".join(cards)}\n    </div></section>'
    out = ITINERARY_DIR / "june-25-to-july-23-2026-event-itineraries.html"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html_page("On Par Event Itineraries", body), encoding="utf-8")
    return out


def main() -> None:
    data = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    events = data["events"]
    events_by_date = defaultdict(list)
    for event in events:
        events_by_date[event["date"]].append(event)
    for date_events in events_by_date.values():
        date_events.sort(key=lambda item: (item["time"], item["name"]))

    schedule_paths = {date: schedule_for_date(date, events_by_date[date]) for date in sorted(events_by_date)}
    floor_host = build_floor_host(events_by_date)
    schedule_host = build_schedule_host(schedule_paths, events_by_date)
    itinerary = build_itinerary(events)
    print(f"Wrote {len(schedule_paths)} entertainment schedule PNGs")
    print(f"Wrote {floor_host}")
    print(f"Wrote {schedule_host}")
    print(f"Wrote {itinerary}")


if __name__ == "__main__":
    main()
