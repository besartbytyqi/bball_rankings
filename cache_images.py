import argparse
import time
import requests
import sqlite3
from pathlib import Path

# Base dir
STATIC_DIR = Path(__file__).parent / "static" / "headshots"
STATIC_DIR.mkdir(parents=True, exist_ok=True)

DB_PATH = Path(__file__).parent / "nba_stats.db"

def get_active_player_ids():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.execute("SELECT player_id FROM players WHERE is_active = 1")
    ids = [row["player_id"] for row in cursor.fetchall()]
    conn.close()
    return ids

def cache_headshots(check_updates: bool = False):
    player_ids = get_active_player_ids()
    print(f"Caching headshots for {len(player_ids)} active players...")
    
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": "https://www.nba.com/"
    }

    count = 0
    for pid in player_ids:
        local_path = STATIC_DIR / f"{pid}.png"
        if local_path.exists() and not check_updates:
            continue
        
        url = f"https://ak-static.cms.nba.com/wp-content/uploads/headshots/nba/latest/260x190/{pid}.png"
        try:
            resp = requests.get(url, headers=headers, timeout=10)
            if resp.status_code == 200:
                incoming = resp.content
                # In check-updates mode we still skip writing if bytes are unchanged.
                if local_path.exists() and check_updates:
                    current = local_path.read_bytes()
                    if current == incoming:
                        continue
                with open(local_path, "wb") as f:
                    f.write(incoming)
                count += 1
                print(f"  [{count}] Cached {pid}")
                time.sleep(0.2) # be nice
            else:
                print(f"  [SKIP] {pid} (HTTP {resp.status_code})")
        except Exception as e:
            print(f"  [ERR] {pid}: {e}")
            time.sleep(1)

    print(f"Done. Cached {count} new headshots.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Cache NBA player headshots to local static folder")
    parser.add_argument(
        "--check-updates",
        action="store_true",
        help="Re-check active players and overwrite only changed images",
    )
    args = parser.parse_args()
    cache_headshots(check_updates=args.check_updates)
