"""Weight Cut AI -- export scraped fighter data to Excel.

Pulls straight from Supabase (already-scraped data), not from the source
sites -- lets Jean review/edit/add/remove entries in a spreadsheet without
needing to re-run either scraper. Two sheets: "Fighters" (one row per
person, the same data the app's directory reads) and "Appearances" (one
row per fighter per bout, including who they fought -- the fuller record
behind the directory's single "most recent" summary).

This is a read/export tool only -- editing the .xlsx does not feed back
into Supabase. If Jean wants edits reflected in the app later, that would
be a separate import step, not built yet.

Usage:
    python export_to_excel.py [--out output/fighters.xlsx]
"""

from __future__ import annotations

import argparse
import os
import shutil
from datetime import datetime

import pandas as pd
import requests
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), ".env.local"))

KG_TO_LB = 2.20462262

FIGHTER_COLUMNS = "slug,name,sex,gym,weight_kg,division,age,height,wins,losses,draws,as_of_date,claimed_by_user_id,source_url,scraped_at"
APPEARANCE_COLUMNS = (
    "id,promotion,event_name,event_date,discipline,weight_kg,fighter_name,fighter_slug,"
    "opponent_name,opponent_slug,result,method,source_url,scraped_at,is_self_reported"
)


def fetch_all(table: str, columns: str, supabase_url: str, service_key: str) -> list[dict]:
    rows: list[dict] = []
    offset = 0
    page_size = 1000
    while True:
        res = requests.get(
            f"{supabase_url}/rest/v1/{table}",
            headers={"apikey": service_key, "Authorization": f"Bearer {service_key}"},
            params={"select": columns, "limit": page_size, "offset": offset, "order": "name" if table == "fighters" else "event_date.desc"},
            timeout=30,
        )
        res.raise_for_status()
        batch = res.json()
        rows.extend(batch)
        if len(batch) < page_size:
            break
        offset += page_size
    return rows


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "output", "fighters.xlsx"))
    args = parser.parse_args()

    supabase_url = os.environ.get("SUPABASE_URL")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not service_key:
        raise SystemExit("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in backend/scraper/.env.local first.")

    os.makedirs(os.path.dirname(args.out), exist_ok=True)

    # Back up before overwriting -- one backup per run, timestamped, so a
    # bad export never destroys the last good file.
    if os.path.exists(args.out):
        stamp = datetime.now().strftime("%H%M")
        backup_path = args.out.replace(".xlsx", f"_bak_{stamp}.xlsx")
        shutil.copy2(args.out, backup_path)
        print(f"Backed up existing file to {backup_path}")

    print("Fetching fighters...")
    fighters = fetch_all("fighters", FIGHTER_COLUMNS, supabase_url, service_key)
    print(f"  {len(fighters)} rows")
    print("Fetching appearances...")
    appearances = fetch_all("fighter_appearances", APPEARANCE_COLUMNS, supabase_url, service_key)
    print(f"  {len(appearances)} rows")

    fighters_df = pd.DataFrame(fighters)
    if not fighters_df.empty:
        fighters_df["weight_lb"] = (fighters_df["weight_kg"] * KG_TO_LB).round(1)
        fighters_df = fighters_df[[
            "name", "sex", "gym", "weight_lb", "weight_kg", "division", "age", "height",
            "wins", "losses", "draws", "as_of_date", "claimed_by_user_id", "slug", "source_url", "scraped_at",
        ]]

    appearances_df = pd.DataFrame(appearances)
    if not appearances_df.empty:
        appearances_df["weight_lb"] = (appearances_df["weight_kg"] * KG_TO_LB).round(1)
        appearances_df = appearances_df[[
            "fighter_name", "fighter_slug", "opponent_name", "opponent_slug", "promotion", "event_name", "event_date",
            "discipline", "weight_lb", "weight_kg", "result", "is_self_reported", "method", "source_url", "scraped_at",
        ]]

    with pd.ExcelWriter(args.out, engine="openpyxl") as writer:
        fighters_df.to_excel(writer, sheet_name="Fighters", index=False)
        appearances_df.to_excel(writer, sheet_name="Appearances", index=False)

    print(f"Wrote {args.out}")


if __name__ == "__main__":
    main()
