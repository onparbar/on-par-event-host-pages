#!/usr/bin/env python3
from __future__ import annotations

import datetime as dt
import html
import json
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

FLOOR_PLAN_BY_DATE = {
    "2026-06-09": "canva floor plans/June_09_The_Greentree_Group_Leadership_Event.png",
    "2026-06-12": "canva floor plans/June_12_Oasis_Turf_Tree.png",
    "2026-06-13": "canva floor plans/June_13_Graduation_Party.png",
    "2026-06-14": "canva floor plans/June_14_OPE_Employee_Appreciation_Patio_Party.png",
    "2026-06-20": "canva floor plans/June_20_Floor_Plans.png",
    "2026-06-23": "canva floor plans/June_23_RAM_Residents.png",
    "2026-06-24": "canva floor plans/June_24_Floor_Plans.png",
    "2026-06-25": "canva floor plans/June_25_Floor_Plans.png",
    "2026-07-07": "canva floor plans/July_07_Work_Event_For_30_Co_Workers.png",
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


def schedule_for_date(date: str, events: list[dict]) -> Path:
    width = 1600
    def event_card_height(event: dict) -> int:
        entertainment = event.get("entertainment") or []
        line_count = 1 if not entertainment else sum(
            len(wrap_lines(
                f"{item['name']} | {item.get('quantity','')} | {item.get('time','')}"
                + (f" | {item.get('duration','')}" if item.get("duration") and item.get("duration") not in item.get("time", "") else ""),
                92,
            ))
            for item in entertainment
        )
        return max(214, 140 + line_count * 31 + 48)

    card_heights = [event_card_height(event) for event in events]
    height = 180 + sum(card_heights) + 60
    image = Image.new("RGB", (width, height), "#f7f8f4")
    draw = ImageDraw.Draw(image)
    title_font = load_font(FONT_BOLD, 54)
    event_font = load_font(FONT_BOLD, 30)
    body_font = load_font(FONT_REGULAR, 25)
    small_font = load_font(FONT_REGULAR, 20)

    draw.rectangle([0, 0, width, 118], fill="#202326")
    draw.text((54, 32), "Entertainment Schedule", font=title_font, fill="#ffffff")
    draw.text((54, 120), date_label(date), font=load_font(FONT_BOLD, 34), fill="#202326")

    y = 176
    for event, card_h in zip(events, card_heights):
        color = event["color"]
        rgb = ImageColor.getrgb(color)
        pale = tuple(int(channel * 0.16 + 255 * 0.84) for channel in rgb)
        draw.rounded_rectangle([44, y, width - 44, y + card_h - 22], radius=8, fill=pale, outline=color, width=5)
        draw.rectangle([44, y, 66, y + card_h - 22], fill=color)
        draw.text((88, y + 24), f"{event['name']} ({event['guest_count']})", font=event_font, fill="#202326")
        draw.text((88, y + 62), event["time"], font=body_font, fill="#384047")
        entertainment = event.get("entertainment") or []
        if entertainment:
            line_y = y + 105
            for item in entertainment[:3]:
                time = item["time"]
                duration = item.get("duration", "")
                quantity = item.get("quantity", "")
                detail = f"{item['name']} | {quantity} | {time}"
                if duration and duration not in time:
                    detail += f" | {duration}"
                line_y = draw_wrapped(draw, detail, (88, line_y), body_font, "#202326", 92, 31)
        else:
            draw.text((88, y + 110), "No reserved entertainment listed on the available BEO/API fields.", font=body_font, fill="#384047")
        draw_wrapped(draw, short_verification(event["verification_status"]), (88, y + card_h - 54), small_font, "#4b5563", 72, 23)
        y += card_h

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
    out = ITINERARY_DIR / "june-09-30-2026-event-itineraries.html"
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
