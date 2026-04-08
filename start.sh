#!/bin/bash
set -e

# Use DATABASE_PATH env var if set (point to a Railway volume for persistence)
# e.g. DATABASE_PATH=/data/nba_stats.db
DB="${DATABASE_PATH:-/app/nba_stats.db}"

# Seed on first run (when standings table is empty or DB doesn't exist yet)
COUNT=$(python3 - <<'EOF'
import sqlite3, os, sys
db = os.environ.get("DATABASE_PATH", "/app/nba_stats.db")
try:
    c = sqlite3.connect(db).execute("SELECT COUNT(*) FROM standings").fetchone()[0]
    print(c)
except Exception:
    print(0)
EOF
)

# Start API immediately so platform healthchecks can pass.
# If first-boot seed is needed, run it in the background.
if [ "${COUNT:-0}" = "0" ]; then
    echo "==> First deploy: seeding database in background..."
    (
        python3 seed.py --no-gamelogs \
          && echo "==> Seed completed successfully." \
          || echo "==> Seed failed; check runtime logs."
    ) &
fi

echo "==> Checking Python imports..."
python3 -c "import main; print('==> Imports OK')" 2>&1 || { echo "==> IMPORT FAILED — see above"; exit 1; }

echo "==> Starting uvicorn on port ${PORT:-8000}..."
exec uvicorn main:app --host 0.0.0.0 --port "${PORT:-8000}" --log-level info
