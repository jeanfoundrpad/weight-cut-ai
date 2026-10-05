"""Weight Cut AI -- fighter-appearance scraper (Freedom Fighter Promotions).

Pulls recent event pages from muaythairecords.com and upserts one row per
fighter per bout into Supabase's fighter_appearances table -- the data
behind the app's "who's fighting at my weight class" screen. Not a
rankings system and not a promoter matchmaking tool (explicitly not the
goal); just enough structured data for a fighter to browse who else is
active near their weight.

Source choice, and why not the promotions' own sites: TCB's real roster
data sits behind a "registered fighters only" login (a real access
control, not attempted here), Warrior's Cup's public "Confirmed Fighters"
page turned out to be a logistics checklist rather than a roster, and
Tapology actively blocks non-browser automated fetches (HTTP 402 on a
direct request). muaythairecords.com is plain server-rendered HTML with no
login wall and gives an exact weight (kg and lbs) per bout -- the best
data quality of everything checked.

Page structure (verified against real HTML, 2026-08-11, both a
fully-decided card and a fully-pending one): each event page has exactly
one "Bout N" line per bout inside the Fight Card section (never
duplicated -- a separate "Bout Information" detail panel repeats the
fighters/weight further down the page but never repeats the "Bout N"
line itself, which is what this parser keys off of). Immediately after a
"Bout N" line: a discipline line (e.g. "Muay Thai"), a KG weight line, a
"VS" line, then the two fighter names as their own lines, then either
"X defeated Y by <method>." or a "We have not registered a winner..."
placeholder for an undecided/upcoming bout.

Usage:
    pip install -r requirements.txt
    cp .env.local.example .env.local   # fill in SUPABASE_SERVICE_ROLE_KEY
    python scrape_muaythairecords.py [--promotion-slug freedom-fighter-promotions] [--window 20]
"""

from __future__ import annotations

import argparse
import os
import re
import time
from dataclasses import dataclass
from datetime import date, datetime

import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), ".env.local"))

BASE_URL = "https://muaythairecords.com"
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
# Polite delay between requests -- this is a small, real site, not a CDN-backed API.
REQUEST_DELAY_SECONDS = 1.5

MONTH_ORDINAL_RE = re.compile(r"(\d+)(st|nd|rd|th)")


def parse_event_date(text: str) -> date | None:
    """"Sat, 18th April 2026" -> date(2026, 4, 18). Returns None rather than raising on anything unexpected -- a missing date shouldn't drop otherwise-good bout data."""
    cleaned = MONTH_ORDINAL_RE.sub(r"\1", text)
    cleaned = re.sub(r"^[A-Za-z]+,\s*", "", cleaned.strip())
    for fmt in ("%d %B %Y", "%d %b %Y"):
        try:
            return datetime.strptime(cleaned, fmt).date()
        except ValueError:
            continue
    return None


@dataclass
class Bout:
    bout_num: int
    discipline: str
    weight_kg: float | None
    fighter1: str
    fighter2: str
    winner: str | None  # None means undecided/upcoming
    method: str | None


def _page_lines(soup: BeautifulSoup) -> list[str]:
    text = soup.get_text(separator="\n")
    return [line.strip() for line in text.split("\n") if line.strip()]


def slugify(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return s or "unknown"


def extract_event_meta(soup: BeautifulSoup, lines: list[str], url: str) -> dict:
    meta = {"event_name": None, "event_date": None, "promotion": None, "source_url": url}
    for i, line in enumerate(lines):
        if line == "Event Date:" and i + 1 < len(lines):
            meta["event_date"] = parse_event_date(lines[i + 1])
        elif line == "Promotion:" and i + 1 < len(lines):
            meta["promotion"] = lines[i + 1]
    # The <title> tag is reliably "<Event Name> Results | Muay Thai Records" --
    # read from soup.title directly rather than the flattened line list, since
    # get_text() keeps the " | Muay Thai Records" suffix glued onto the same
    # line, which broke a naive "ends with ' Results'" match.
    title = soup.title.string if soup.title and soup.title.string else None
    if title and " Results" in title:
        meta["event_name"] = title.split(" Results")[0].strip()
    else:
        meta["event_name"] = url
    return meta


def extract_bouts(lines: list[str]) -> list[Bout]:
    try:
        start = lines.index("Fight Card")
    except ValueError:
        return []
    end = next((i for i, l in enumerate(lines) if l in ("Cancelled Bouts", "Awards & Performance Bonuses")), len(lines))
    section = lines[start:end]

    bouts: list[Bout] = []
    i = 0
    while i < len(section):
        m = re.match(r"^Bout (\d+)$", section[i])
        if not m:
            i += 1
            continue
        bout_num = int(m.group(1))
        i += 1

        discipline = "Muay Thai"
        weight_kg: float | None = None
        while i < len(section) and section[i] != "VS":
            if section[i] in ("Muay Thai", "Kickboxing", "Boxing", "MMA"):
                discipline = section[i]
            wm = re.match(r"^(\d+\.\d+)$", section[i])
            if wm:
                weight_kg = float(wm.group(1))
            i += 1

        if i >= len(section) or section[i] != "VS":
            # Malformed/unexpected block -- skip forward rather than guessing.
            continue
        i += 1  # past "VS"
        # weight_kg staying None here is real and expected on some
        # promotions (confirmed live on Warrior's Cup: several real bouts
        # never list a weight in the compact card at all) -- accepted
        # anyway rather than dropped, since the fighter/opponent identity
        # is still real and worth keeping (fighter_appearances.weight_kg
        # is nullable as of 0025 specifically for this).

        if i >= len(section):
            break
        fighter1 = section[i]
        i += 1

        # A decided bout inlines a "WIN"/"LOSS" badge plus a method line
        # right after the first fighter's name, before the second fighter's
        # name -- absent entirely for an undecided/upcoming bout. Skip both
        # if present; the actual winner/method still gets parsed properly
        # below from the summary sentence, which names both fighters
        # explicitly rather than relying on badge position.
        if i < len(section) and section[i] in ("WIN", "LOSS"):
            i += 2  # badge line + method line

        if i >= len(section):
            break
        fighter2 = section[i]
        i += 1

        if i >= len(section):
            break
        result_line = section[i]
        i += 1

        winner = None
        method = None
        dm = re.match(r"^(.+?) defeated (.+?) by (.+)\.$", result_line)
        if dm:
            winner, _loser, method = dm.group(1), dm.group(2), dm.group(3)

        bouts.append(Bout(bout_num, discipline, weight_kg, fighter1, fighter2, winner, method))
    return bouts


def extract_fighter_slugs(soup: BeautifulSoup) -> dict[str, str]:
    """Maps visible fighter name -> URL slug from every /fighters/{slug} link on the page. Event pages link each fighter's name to their profile, which is the only place gym/last-weight data actually lives."""
    slugs: dict[str, str] = {}
    for a in soup.select('a[href*="/fighters/"]'):
        name = a.get_text(strip=True)
        m = re.search(r"/fighters/([a-z0-9-]+)", a.get("href", ""))
        if name and m:
            slugs.setdefault(name, m.group(1))
    return slugs


@dataclass
class FighterProfile:
    slug: str
    name: str
    gym: str | None
    weight_kg: float | None
    wins: int | None
    losses: int | None
    draws: int | None
    sex: str | None
    source_url: str


def extract_fighter_profile(soup: BeautifulSoup, slug: str, url: str) -> FighterProfile:
    lines = _page_lines(soup)

    def value_after(label: str) -> str | None:
        idx = next((i for i, l in enumerate(lines) if l == label), None)
        return lines[idx + 1] if idx is not None and idx + 1 < len(lines) else None

    name = None
    if soup.title and soup.title.string:
        name = soup.title.string.split(" - Fight Record")[0].strip()

    gym_raw = value_after("Gym:")
    gym = gym_raw if gym_raw and gym_raw.upper() != "N/A" else None

    weight_kg = None
    weight_raw = value_after("Last Weight:")
    if weight_raw:
        wm = re.match(r"^([\d.]+)\s*kg$", weight_raw, re.IGNORECASE)
        if wm:
            weight_kg = float(wm.group(1))

    # "Record: 2-1-0" -- this site's own continuously-updated career total,
    # same status as gym/weight here (no as_of_date needed, unlike No
    # Boundary Fight's per-event snapshot record).
    wins = losses = draws = None
    record_raw = value_after("Record:")
    if record_raw:
        rm = re.match(r"^(\d+)-(\d+)-(\d+)$", record_raw)
        if rm:
            wins, losses, draws = int(rm.group(1)), int(rm.group(2)), int(rm.group(3))

    # Real per-fighter data, verified: a schema.org Person "gender"
    # property embedded in each profile page's JSON-LD, confirmed to
    # actually vary correctly by person (Female for known female fighters,
    # Male for known male ones) -- unlike the site's generic, identical-
    # across-every-fighter "jobTitle" blurb and Amateur/Pro dropdown
    # options, which were checked and ruled out earlier as unreliable.
    sex = None
    gm = re.search(r'"gender"\s*:\s*"(Male|Female)"', str(soup))
    if gm:
        sex = gm.group(1).lower()

    return FighterProfile(
        slug=slug, name=name or slug, gym=gym, weight_kg=weight_kg, sex=sex,
        wins=wins, losses=losses, draws=draws, source_url=url,
    )


def fetch(url: str) -> BeautifulSoup | None:
    try:
        res = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=20)
        if res.status_code != 200:
            print(f"  [skip] {url} -> HTTP {res.status_code}")
            return None
        return BeautifulSoup(res.text, "html.parser")
    except requests.RequestException as e:
        print(f"  [error] {url} -> {e}")
        return None


def discover_event_urls(promotion_slug: str) -> list[str]:
    """
    Freedom Fighter Promotions numbers its events cleanly and sequentially
    (freedom-fighter-promotions-N-us), which is why the original version of
    this scraper just generated URLs from a number range. That assumption
    breaks for other promotions on this same site -- confirmed live for
    Warrior's Cup, whose event slugs mix plain numbers, Roman numerals
    (warriors-cup-lxxv-us), and differently-named sub-series
    (warriors-series-3-us) with real gaps in between. Discovering the
    actual event links from the organizer page, in the order the page
    presents them (most recent first, matching the site's own layout),
    works for any promotion regardless of its numbering scheme -- this is
    what makes --promotion-slug usable for a promotion beyond the one this
    scraper was originally built against.
    """
    soup = fetch(f"{BASE_URL}/organisers/{promotion_slug}")
    if soup is None:
        return []
    urls: list[str] = []
    seen: set[str] = set()
    for a in soup.select('a[href*="/events/"]'):
        href = a.get("href", "")
        if href and href not in seen:
            seen.add(href)
            urls.append(href)
    return urls


def bouts_to_rows(meta: dict, bouts: list[Bout], fighter_slugs: dict[str, str]) -> list[dict]:
    rows = []
    for b in bouts:
        pairs = [(b.fighter1, b.fighter2), (b.fighter2, b.fighter1)]
        for fighter, opponent in pairs:
            if b.winner is None:
                result = "pending"
            else:
                result = "win" if fighter == b.winner else "loss"
            rows.append({
                "promotion": meta["promotion"] or "Freedom Fighter Promotions",
                "event_name": meta["event_name"],
                "event_date": meta["event_date"].isoformat() if meta["event_date"] else None,
                "discipline": b.discipline,
                "weight_kg": b.weight_kg,
                "fighter_name": fighter,
                # Falls back to a locally slugified name on the rare bout
                # page where a fighter link wasn't picked up by
                # extract_fighter_slugs -- keeps the row joinable to
                # `fighters` even then, rather than leaving it null.
                "fighter_slug": fighter_slugs.get(fighter) or slugify(fighter),
                "opponent_name": opponent,
                "opponent_slug": fighter_slugs.get(opponent) or slugify(opponent),
                "result": result,
                "method": b.method,
                "source_url": meta["source_url"],
            })
    return rows


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


def upsert_rows(rows: list[dict], supabase_url: str, service_key: str) -> None:
    # Defensive dedupe on the same key Postgres upserts against -- some
    # promotions' own pages list the exact same bout twice (confirmed live
    # on Fight Time Championship 11: "Paul Saint vs Louis Wensley" appears
    # as both Bout 9 and Bout 10, identical fighters and weight, a real
    # data-entry duplicate on the source site, not a parsing bug). ON
    # CONFLICT correctly rejects a batch that would touch the same row
    # twice, so the last-seen copy wins here rather than crashing the run.
    # Includes event_date (0027) alongside event_name -- a bare event_name
    # match isn't a safe enough identity key on its own, since promotions
    # do reuse generic show names ("Friday Night Fights") across different
    # dates, and the original date-blind key would have silently merged
    # those into one row.
    by_key = {(r["event_name"], r["event_date"], r["fighter_name"], r["opponent_name"]): r for r in rows}
    deduped = list(by_key.values())
    if len(deduped) < len(rows):
        print(f"    (dropped {len(rows) - len(deduped)} exact-duplicate bout row(s) from the same page)")
    _upsert("fighter_appearances", deduped, "event_name,event_date,fighter_name,opponent_name", supabase_url, service_key)


def upsert_fighters(profiles: list[FighterProfile], supabase_url: str, service_key: str) -> None:
    # Defensive dedupe by slug -- ON CONFLICT rejects an upsert batch that
    # would touch the same row twice, which happens for real: the same
    # fighter's name text can vary slightly (casing/whitespace) across
    # different event pages while resolving to the identical profile slug.
    by_slug = {p.slug: p for p in profiles}
    rows = [
        {
            "slug": p.slug,
            "name": p.name,
            "gym": p.gym,
            "weight_kg": p.weight_kg,
            "wins": p.wins,
            "losses": p.losses,
            "draws": p.draws,
            "sex": p.sex,
            "source_url": p.source_url,
        }
        for p in by_slug.values()
    ]
    _upsert("fighters", rows, "slug", supabase_url, service_key)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--promotion-slug", default="freedom-fighter-promotions")
    parser.add_argument("--window", type=int, default=20, help="How many of the most recent events (as listed on the organizer page) to scrape.")
    args = parser.parse_args()

    supabase_url = os.environ.get("SUPABASE_URL")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not service_key:
        raise SystemExit("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in backend/scraper/.env.local first.")

    event_urls = discover_event_urls(args.promotion_slug)[: args.window]
    if not event_urls:
        raise SystemExit(f"Couldn't find any event links for {args.promotion_slug} -- check the organizer slug is right.")
    print(f"{args.promotion_slug}: scraping {len(event_urls)} most recent events")

    total_rows = 0
    # Keyed by slug, not name: the same fighter's name text can vary
    # slightly (casing/whitespace) across different event pages while the
    # slug -- the actual profile identity -- stays identical. Keying by
    # name first caused two profile fetches (and two upsert rows with the
    # same slug, which Postgres's ON CONFLICT correctly rejects within one
    # batch) for the same real person.
    fighter_slugs: dict[str, str] = {}  # slug -> first-seen display name
    name_to_slug: dict[str, str] = {}  # the inverse, needed by bouts_to_rows to join appearances back to fighters
    for url in event_urls:
        soup = fetch(url)
        time.sleep(REQUEST_DELAY_SECONDS)
        if soup is None:
            continue
        lines = _page_lines(soup)
        meta = extract_event_meta(soup, lines, url)
        bouts = extract_bouts(lines)
        for name, slug in extract_fighter_slugs(soup).items():
            fighter_slugs.setdefault(slug, name)
            name_to_slug.setdefault(name, slug)
        if not bouts:
            print(f"  {meta['event_name']}: 0 bouts")
            continue
        rows = bouts_to_rows(meta, bouts, name_to_slug)
        upsert_rows(rows, supabase_url, service_key)
        total_rows += len(rows)
        print(f"  {meta['event_name']}: {len(bouts)} bouts -> {len(rows)} rows upserted")

    print(f"Done. {total_rows} fighter-appearance rows upserted total.")

    # Gym and "last weight" only live on each fighter's own profile page,
    # never on the event pages -- one extra fetch per unique fighter
    # encountered above, upserted into the directory the app actually reads.
    print(f"Fetching {len(fighter_slugs)} fighter profiles for the directory (gym + weight)...")
    profiles: list[FighterProfile] = []
    for slug, name in fighter_slugs.items():
        profile_url = f"{BASE_URL}/fighters/{slug}"
        soup = fetch(profile_url)
        time.sleep(REQUEST_DELAY_SECONDS)
        if soup is None:
            continue
        profile = extract_fighter_profile(soup, slug, profile_url)
        profiles.append(profile)
        if len(profiles) % 25 == 0:
            upsert_fighters(profiles, supabase_url, service_key)
            print(f"  ...{len(profiles)}/{len(fighter_slugs)} profiles upserted so far")
    upsert_fighters(profiles, supabase_url, service_key)
    with_gym = sum(1 for p in profiles if p.gym)
    print(f"Done. {len(profiles)} fighter profiles upserted total, {with_gym} with a known gym.")


if __name__ == "__main__":
    main()
