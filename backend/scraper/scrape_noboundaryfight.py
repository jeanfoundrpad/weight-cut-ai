"""Weight Cut AI -- fighter-appearance scraper (No Boundary Fight).

Unlike muaythairecords.com (plain server-rendered HTML), No Boundary
Fight's own event pages carry almost no content themselves -- each one
just links to a "PROGRAM" PDF (a DearFlip flipbook widget, loaded via a
`window.df_option_N = {"source": "...pdf"}` JS blob rather than a plain
<a href>). The PDF itself is the real data source: one page per bout, a
strict two-column layout (left = fighter 1, right = fighter 2) with
weight class, Amateur/Pro division, age, height, and win/loss/record per
fighter -- richer than muaythairecords.com, but needing position-aware PDF
parsing rather than HTML parsing, since a naive linear text read
interleaves the two fighters' info.

This data is a point-in-time snapshot from one specific event, not a
continuously-updated profile -- stored with `as_of_date` (the event's
month/year) and always rendered with an "as of" label in the app, per
Jean directly: a fighter's weight/record easily changes after one fight,
and showing it without a date risks looking wrong once it has.

Win/loss/draw (per fighter, as of that same event) is stored on `fighters`
alongside division/age/height -- opponent_name is also kept on every
fighter_appearances row regardless, which is what actually lets a future
matchmaking feature answer "who has X already fought."

Usage:
    pip install -r requirements.txt   # now includes pdfplumber
    python scrape_noboundaryfight.py [--limit 5]
"""

from __future__ import annotations

import argparse
import os
import re
import time
from dataclasses import dataclass
from datetime import date
from io import BytesIO

import pdfplumber
import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), ".env.local"))

BASE_URL = "https://noboundaryfight.com"
INDEX_URL = f"{BASE_URL}/2016-present-time/"
PROMOTION = "No Boundary Fight"
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
REQUEST_DELAY_SECONDS = 1.5

MONTHS = {
    "january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6,
    "july": 7, "august": 8, "september": 9, "october": 10, "november": 11, "december": 12,
}


def fetch(url: str) -> BeautifulSoup | None:
    try:
        res = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=20, allow_redirects=True)
        if res.status_code != 200:
            print(f"  [skip] {url} -> HTTP {res.status_code}")
            return None
        return BeautifulSoup(res.text, "html.parser")
    except requests.RequestException as e:
        print(f"  [error] {url} -> {e}")
        return None


def discover_event_urls() -> list[str]:
    """Event links on the index page run oldest (2016) to newest -- reversed here so callers naturally process most-recent-first, per Jean's explicit instruction to prioritize recent data."""
    soup = fetch(INDEX_URL)
    if soup is None:
        return []
    urls: list[str] = []
    seen: set[str] = set()
    for a in soup.select("a[href]"):
        href = a["href"].strip()
        if "noboundaryfight.com" not in href:
            continue
        # The index also links nav/menu pages (EVENTS, NEWS, etc.) -- real
        # event pages are the ones appearing inside the year-by-year table,
        # identifiable by NOT being one of the known nav slugs.
        if any(nav in href for nav in (
            "upcoming-events", "2016-present-time", "press-accreditation", "fighter-medicals",
            "fighter-record-2", "our-team", "/blog/", "/mma/", "eshop-2", "features-videos",
            "wp-fighters", "ring-girl", "video-4-column", "contact-us", "terms-of-use", "privacy-policy",
        )):
            continue
        if href not in seen and href.rstrip("/") != BASE_URL:
            seen.add(href)
            urls.append(href)
    return list(reversed(urls))


@dataclass
class EventMeta:
    event_name: str
    event_date: date | None
    program_pdf_url: str | None
    source_url: str


def extract_event_meta(soup: BeautifulSoup, url: str) -> EventMeta:
    lines = [l.strip() for l in soup.get_text(separator="\n").split("\n") if l.strip()]
    # Every page shares the same nav menu (HOME, EVENTS, ... Privacy Policy)
    # before the real page content starts -- "HOME" alone would otherwise
    # match the same all-caps pattern the real heading does. Search only
    # after the nav block ends.
    content_start = next((i + 1 for i, l in enumerate(lines) if l == "Privacy Policy"), 0)
    content_lines = lines[content_start:]

    event_name = url.rstrip("/").rsplit("/", 1)[-1].replace("-result-page-event", "").replace("-", " ").strip() or url
    for line in content_lines:
        if re.match(r"^[A-Z0-9 ]{4,30}$", line) and not line.isdigit():
            event_name = line
            break

    event_date = None
    for line in content_lines:
        m = re.match(r"(?i)^(" + "|".join(MONTHS) + r")\s+(\d{4})$", line)
        if m:
            event_date = date(int(m.group(2)), MONTHS[m.group(1).lower()], 1)
            break

    program_url = None
    for m in re.finditer(r'window\.df_option_\d+\s*=\s*(\{.*?\});', str(soup), re.DOTALL):
        try:
            import json
            opt = json.loads(m.group(1))
        except json.JSONDecodeError:
            continue
        slug = str(opt.get("slug", ""))
        if "program" in slug.lower():
            program_url = opt.get("source", "").replace("\\/", "/")
            break

    return EventMeta(event_name=event_name, event_date=event_date, program_pdf_url=program_url, source_url=url)


COLUMN_SPLIT_X = 300


def _cluster_rows(words: list[dict], tol: float = 6) -> list[list[dict]]:
    rows: list[list[dict]] = []
    current: list[dict] = []
    current_top: float | None = None
    for w in sorted(words, key=lambda w: w["top"]):
        if current_top is None or abs(w["top"] - current_top) <= tol:
            current.append(w)
            current_top = w["top"] if current_top is None else current_top
        else:
            rows.append(current)
            current = [w]
            current_top = w["top"]
    if current:
        rows.append(current)
    return rows


def _row_text(row: list[dict]) -> str:
    return " ".join(w["text"] for w in sorted(row, key=lambda w: w["x0"]))


def _clean_height(text: str | None) -> str | None:
    if not text:
        return None
    # The PDF uses a curly right-single-quote (U+2019) as the feet mark.
    return text.replace("’", "'").strip() or None


@dataclass
class ParsedFighter:
    name: str | None
    gym: str | None
    age: int | None
    height: str | None
    wins: int | None
    losses: int | None
    draws: int | None


@dataclass
class ParsedBout:
    weight_class: str | None
    division: str  # 'amateur' or 'pro'
    weight_lb: float | None
    fighter1: ParsedFighter
    fighter2: ParsedFighter


def parse_bout_page(page) -> ParsedBout | None:
    words = page.extract_words()

    # The stats block (weight class/division/age/height/weight/W-L-D)
    # always ends with the DRAW row; the name/gym block starts a real
    # vertical gap below it. A fixed pixel cutoff (500) worked on the
    # pages checked during development but broke for real once enough
    # different pages were scraped live: on some pages the DRAW row itself
    # sits at or past that fixed boundary, so its own label/value leaked
    # into the name section -- confirmed live, several fighters ended up
    # named things like "0 DRAW Adam" or "0 Zach" with the real first name
    # (and sometimes the surname too) pushed down into the gym line.
    # Anchoring the cutoff to the DRAW label's actual position on *this*
    # page, not a universal constant, fixes it regardless of per-page
    # vertical drift.
    draw_label = next((w for w in words if w["text"] == "DRAW"), None)
    stats_cutoff = draw_label["top"] + 15 if draw_label else 500
    stats_words = [w for w in words if w["top"] < stats_cutoff]
    name_words = [w for w in words if w["top"] >= stats_cutoff and w["text"] != "VS"]

    weight_class = None
    division = "pro"
    for row in _cluster_rows([w for w in stats_words if w["top"] < 260]):
        text = _row_text(row).strip()
        if not text or text.isdigit():
            continue
        if text.lower() == "amateur":
            division = "amateur"
        elif weight_class is None:
            weight_class = text

    def stat_pair(label: str) -> tuple[str | None, str | None]:
        label_word = next((w for w in stats_words if w["text"] == label), None)
        if not label_word:
            return None, None
        row = [w for w in stats_words if abs(w["top"] - label_word["top"]) <= 4]
        left = [w for w in row if w["x0"] < label_word["x0"]]
        right = [w for w in row if w["x0"] > label_word["x1"]]
        return (_row_text(left) if left else None), (_row_text(right) if right else None)

    age_l, age_r = stat_pair("AGE")
    height_l, height_r = stat_pair("HEIGHT")
    win_l, win_r = stat_pair("WIN")
    loss_l, loss_r = stat_pair("LOSS")
    draw_l, draw_r = stat_pair("DRAW")

    weight_label = next((w for w in stats_words if w["text"] == "WEIGHT"), None)
    weight_lb = None
    if weight_label:
        candidates = [
            w for w in stats_words
            if abs(w["top"] - weight_label["top"] - 5) <= 15 and re.match(r"^\d+$", w["text"])
        ]
        if candidates:
            weight_lb = float(candidates[0]["text"])

    left_col = [w for w in name_words if w["x0"] < COLUMN_SPLIT_X]
    right_col = [w for w in name_words if w["x0"] >= COLUMN_SPLIT_X]
    left_lines = [_row_text(r) for r in _cluster_rows(left_col)]
    right_lines = [_row_text(r) for r in _cluster_rows(right_col)]

    def to_int(text: str | None) -> int | None:
        return int(text) if text and text.isdigit() else None

    def to_fighter(
        lines: list[str], age: str | None, height: str | None, win: str | None, loss: str | None, draw: str | None,
    ) -> ParsedFighter:
        # Second, independent guard against the same class of bug the
        # dynamic stats_cutoff above fixes at the root: a stray stat
        # label/value that still ends up in the name column can never
        # produce a corrupted name now, even on some future page this
        # cutoff doesn't handle -- a real person's name is never a bare
        # number or the literal word "DRAW"/"WIN"/"LOSS".
        clean_lines = [l for l in lines if not re.match(r"^\d+$", l) and l not in ("WIN", "LOSS", "DRAW")]
        name = " ".join(clean_lines[:2]) if len(clean_lines) >= 2 else (clean_lines[0] if clean_lines else None)
        gym = " ".join(clean_lines[2:]) if len(clean_lines) > 2 else None
        age_val = to_int(age)
        # Plausibility guard, not a fix: pdfplumber's row-clustering
        # occasionally drops a digit from a two-digit age (per-glyph
        # vertical jitter can push one digit just outside the row's top
        # tolerance) -- caught a real "age: 3" for an adult competitor this
        # way. Better to show no age than a value that's obviously wrong.
        if age_val is not None and not (14 <= age_val <= 70):
            age_val = None
        return ParsedFighter(
            name=name, gym=gym, age=age_val, height=_clean_height(height),
            wins=to_int(win), losses=to_int(loss), draws=to_int(draw),
        )

    fighter1 = to_fighter(left_lines, age_l, height_l, win_l, loss_l, draw_l)
    fighter2 = to_fighter(right_lines, age_r, height_r, win_r, loss_r, draw_r)

    # weight_lb is None whenever the WEIGHT/AGE/HEIGHT stats block never
    # existed on this page at all -- the strongest available signal that
    # this is a non-bout page (cover, sponsor, intermission), not a bout
    # with an unreadable weight. Caught the cover page ("program" / "Muay"
    # / "Thai") being parsed as a fake bout before this check existed:
    # weight_class and both names were non-null (just wrong), so the
    # weaker name/weight_class-only guard let it through.
    if not fighter1.name or not fighter2.name or weight_class is None or weight_lb is None:
        return None

    return ParsedBout(weight_class=weight_class, division=division, weight_lb=weight_lb, fighter1=fighter1, fighter2=fighter2)


def parse_program_pdf(pdf_bytes: bytes) -> list[ParsedBout]:
    bouts: list[ParsedBout] = []
    with pdfplumber.open(BytesIO(pdf_bytes)) as pdf:
        for page in pdf.pages:
            bout = parse_bout_page(page)
            if bout:
                bouts.append(bout)
    return bouts


def slugify(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return s or "unknown"


def _upsert(table: str, rows: list[dict], on_conflict: str, supabase_url: str, service_key: str) -> None:
    if not rows:
        return
    res = requests.post(
        f"{supabase_url}/rest/v1/{table}",
        headers={
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates",
        },
        params={"on_conflict": on_conflict},
        json=rows,
        timeout=30,
    )
    if not res.ok:
        raise RuntimeError(f"Supabase upsert into {table} failed ({res.status_code}): {res.text}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=6, help="How many of the most recent events (with a real program) to scrape.")
    args = parser.parse_args()

    supabase_url = os.environ.get("SUPABASE_URL")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not service_key:
        raise SystemExit("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in backend/scraper/.env.local first.")

    event_urls = discover_event_urls()
    print(f"Found {len(event_urls)} event pages, most recent first. Scraping up to {args.limit} with a real program PDF.")

    seen_slugs: set[str] = set()  # most-recent-first processing -> first time we see a slug IS their most recent snapshot
    scraped = 0
    for url in event_urls:
        if scraped >= args.limit:
            break
        soup = fetch(url)
        time.sleep(REQUEST_DELAY_SECONDS)
        if soup is None:
            continue
        meta = extract_event_meta(soup, url)
        if not meta.program_pdf_url:
            print(f"  {meta.event_name}: no program PDF yet, skipping")
            continue

        try:
            pdf_res = requests.get(meta.program_pdf_url, headers={"User-Agent": USER_AGENT}, timeout=30)
            time.sleep(REQUEST_DELAY_SECONDS)
            if not pdf_res.ok:
                print(f"  {meta.event_name}: program PDF fetch failed ({pdf_res.status_code})")
                continue
            bouts = parse_program_pdf(pdf_res.content)
        except Exception as e:
            print(f"  {meta.event_name}: PDF parse failed -- {e}")
            continue

        fighter_rows = []
        appearance_rows = []
        for bout in bouts:
            weight_kg = (bout.weight_lb * 0.45359237) if bout.weight_lb else None
            for me, opponent in ((bout.fighter1, bout.fighter2), (bout.fighter2, bout.fighter1)):
                slug = slugify(me.name)
                if slug not in seen_slugs:
                    seen_slugs.add(slug)
                    fighter_rows.append({
                        "slug": slug,
                        "name": me.name,
                        "gym": me.gym,
                        "weight_kg": weight_kg,
                        "division": bout.division,
                        "age": me.age,
                        "height": me.height,
                        "wins": me.wins,
                        "losses": me.losses,
                        "draws": me.draws,
                        "as_of_date": meta.event_date.isoformat() if meta.event_date else None,
                        "source_url": meta.source_url,
                    })
                appearance_rows.append({
                    "promotion": PROMOTION,
                    "event_name": meta.event_name,
                    "event_date": meta.event_date.isoformat() if meta.event_date else None,
                    "discipline": "Muay Thai",
                    "weight_kg": weight_kg,
                    "fighter_name": me.name,
                    "fighter_slug": slug,
                    "opponent_name": opponent.name,
                    "opponent_slug": slugify(opponent.name),
                    "result": "pending",  # deliberately not parsed into the app -- see module docstring
                    "method": None,
                    "source_url": meta.source_url,
                })

        _upsert("fighters", fighter_rows, "slug", supabase_url, service_key)
        # Same defensive dedupe as scrape_muaythairecords.py's upsert_rows()
        # -- ON CONFLICT rejects a batch that would touch the same row
        # twice, and the conflict target now includes event_date (0027).
        by_key = {(r["event_name"], r["event_date"], r["fighter_name"], r["opponent_name"]): r for r in appearance_rows}
        deduped_appearances = list(by_key.values())
        if len(deduped_appearances) < len(appearance_rows):
            print(f"    (dropped {len(appearance_rows) - len(deduped_appearances)} exact-duplicate bout row(s) from the same page)")
        _upsert("fighter_appearances", deduped_appearances, "event_name,event_date,fighter_name,opponent_name", supabase_url, service_key)
        scraped += 1
        print(f"  {meta.event_name} ({meta.event_date}): {len(bouts)} bouts -> {len(fighter_rows)} new fighters, {len(appearance_rows)} appearances")

    print(f"Done. {scraped} events scraped, {len(seen_slugs)} unique fighters upserted.")


if __name__ == "__main__":
    main()
