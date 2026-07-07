#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parent
DATA_PATH = ROOT / "outputs" / "tripleseat" / "event_plan_data.json"
OUT_DIR = ROOT / "ITINERARY"
LOGO_PATH = ROOT / "public" / "itinerary-assets" / "on-par-logo.png"
QR_PATH = ROOT / "public" / "itinerary-assets" / "google-review-qr.png"
PAGE_W = 1275
PAGE_H = 1650
GREEN = "#234f24"
BLACK = "#141414"
CREAM = "#f7f4ee"
PALE = "#dfe4dc"
GOLD = "#d7ccae"
FONT_SCRIPT = "/System/Library/Fonts/Supplemental/SnellRoundhand.ttc"
FONT_SERIF = "/System/Library/Fonts/Supplemental/Georgia.ttf"
FONT_SERIF_BOLD = "/System/Library/Fonts/Supplemental/Georgia Bold.ttf"


def load_font(path: str, size: int) -> ImageFont.ImageFont:
    try:
        return ImageFont.truetype(path, size=size)
    except Exception:
        return ImageFont.load_default()


def slugify(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value)
    ascii_only = normalized.encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_only.lower()).strip("-")
    return slug or "event"


def compact_time(value: str) -> str:
    return value.replace(" - ", "-").replace("  ", " ").upper()


def wraps(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.ImageFont, max_width: int) -> list[str]:
    words = [word for word in text.split() if word]
    lines: list[str] = []
    current = ""
    for word in words:
      candidate = f"{current} {word}".strip()
      if current and draw.textlength(candidate, font=font) > max_width:
          lines.append(current)
          current = word
      else:
          current = candidate
    if current:
        lines.append(current)
    return lines or [text]


def draw_lines(draw: ImageDraw.ImageDraw, lines: list[str], font: ImageFont.ImageFont, fill: str, x: int, y: int, line_gap: int) -> int:
    for line in lines:
        draw.text((x, y), line, font=font, fill=fill)
        y += line_gap
    return y


def drink_lines(event: dict) -> list[str]:
    lines = ["Free soda and juice for all guests!"]
    has_drink_cards = any("full course" in item.lower() for item in event.get("food") or []) or any(
        marker in item.lower()
        for item in event.get("drink_options") or []
        for marker in ("back nine", "food + beverage", "drink card")
    )
    if has_drink_cards:
        lines.append(f"$20.00 prepaid drink cards for {event['guest_count']} guests!")
    return lines


def food_lines(event: dict) -> list[str]:
    lines: list[str] = []
    for item in event.get("food") or []:
        text = item.replace("Food + Beverage", "").replace("Food Only", "").replace("Beverage Only", "").strip(" -")
        if "|" in text:
            package, selection = [part.strip() for part in text.split("|", 1)]
            lines.append(f"{package} | {event['guest_count']}")
            if selection:
                lines.append(selection)
            continue
        lines.append(text)
    return lines


def entertainment_sections(event: dict) -> list[tuple[str, str]]:
    sections: list[tuple[str, str]] = []
    for item in event.get("entertainment") or []:
        title = item.get("name", "").replace("Duckpin ", "").upper()
        quantity = str(item.get("quantity", "")).upper()
        duration = str(item.get("duration", "")).upper()
        time = str(item.get("time", ""))

        if time and "untimed" not in time.lower() and "time not listed" not in time.lower():
            detail = f"{quantity} FOR {duration} | {compact_time(time)}"
        elif time and "untimed" in time.lower():
            detail = f"{quantity} | UNTIMED"
        elif duration:
            detail = f"{quantity} FOR {duration} | TIME NOT LISTED ON BEO"
        else:
            detail = quantity or "SEE BEO"
        sections.append((title, detail))
    if not sections:
        sections.append(("NO RESERVED ENTERTAINMENT", "NO RESERVED ENTERTAINMENT LISTED"))
    return sections


def render_event(event: dict) -> Path:
    page = Image.new("RGB", (PAGE_W, PAGE_H), CREAM)
    draw = ImageDraw.Draw(page)

    for points, fill in [
        ([(165, 0), (330, 0), (740, PAGE_H), (575, PAGE_H)], PALE),
        ([(520, 0), (675, 0), (1085, PAGE_H), (930, PAGE_H)], PALE),
        ([(210, 0), (214, 0), (625, PAGE_H), (621, PAGE_H)], GOLD),
        ([(1030, 0), (1034, 0), (865, PAGE_H), (861, PAGE_H)], GOLD),
    ]:
        draw.polygon(points, fill=fill)

    logo = Image.open(LOGO_PATH).convert("RGBA")
    logo.thumbnail((260, 160))
    page.paste(logo, (78, 38), logo)
    page.paste(logo, (807, 38), logo)

    font_title = load_font(FONT_SERIF_BOLD, 42)
    font_name = load_font(FONT_SERIF_BOLD, 38)
    font_section = load_font(FONT_SCRIPT, 46)
    font_body = load_font(FONT_SERIF_BOLD, 29)
    font_meta = load_font(FONT_SERIF_BOLD, 34)
    font_small = load_font(FONT_SERIF_BOLD, 25)

    date_label = event["date"].replace("-", "/")
    draw.text((66, 214), Path(date_label).stem.replace("/", " ").title().replace(" ", "/"), font=font_title, fill=GREEN)
    draw.text((370, 214), compact_time(event["time"]), font=font_title, fill=GREEN)

    name_y = 292
    for line in wraps(draw, event["name"].upper(), font_name, 400):
        draw.text((66, name_y), line, font=font_name, fill=GREEN)
        name_y += 46

    draw.text((66, 415), "Food", font=load_font(FONT_SCRIPT, 54), fill=GREEN)
    food_y = 480
    for line in food_lines(event):
        food_y = draw_lines(draw, wraps(draw, line.upper(), font_body, 470), font_body, BLACK, 66, food_y, 31)

    draw.text((66, 645), "Entertainment", font=load_font(FONT_SCRIPT, 54), fill=GREEN)
    entertainment_y = 706
    for title, detail in entertainment_sections(event):
        draw.text((66, entertainment_y), title, font=font_meta, fill=GREEN)
        entertainment_y += 40
        entertainment_y = draw_lines(draw, wraps(draw, detail, font_body, 510), font_body, BLACK, 66, entertainment_y, 31)
        entertainment_y += 14

    draw.text((66, 1210), "Drinks", font=load_font(FONT_SCRIPT, 54), fill=GREEN)
    drinks_y = 1274
    for line in drink_lines(event):
        drinks_y = draw_lines(draw, wraps(draw, line.upper(), font_body, 520), font_body, BLACK, 66, drinks_y, 31)
        drinks_y += 12

    draw.text((688, 236), "BWA:", font=font_title, fill=GREEN)
    for line_y in (240, 575, 655, 735, 815, 895, 975, 1055):
        draw.line((828, line_y, 1215, line_y), fill=BLACK, width=4)

    feedback = "HOW DID WE DO?\nWE'D LOVE YOUR\nFEEDBACK"
    feedback_y = 352
    for line in feedback.splitlines():
        draw.text((690, feedback_y), line, font=font_title, fill=GREEN)
        feedback_y += 54

    qr = Image.open(QR_PATH).convert("RGBA")
    qr.thumbnail((250, 250))
    page.paste(qr, (900, 1220), qr)
    draw.text((748, 1408), "Did We Hit It On Par?", font=font_meta, fill=GREEN)
    review_y = 1500
    for line in ("SCAN TO LEAVE US A", "GOOGLE REVIEW"):
        draw.text((748, review_y), line, font=font_small, fill=GREEN)
        review_y += 42

    out_path = OUT_DIR / f"{event['date']}-{slugify(event['name'])}.pdf"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    page.save(out_path, "PDF", resolution=150.0)
    return out_path


def main() -> None:
    data = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    outputs = [render_event(event) for event in data["events"]]
    print(f"Wrote {len(outputs)} itinerary PDFs to {OUT_DIR}")


if __name__ == "__main__":
    main()
