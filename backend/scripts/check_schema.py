"""
Print how many application tables exist, and nothing else.

    python scripts/check_schema.py     ->  10

The launcher (start-wattwise.cmd) reads this to decide whether the database
needs create_tables.py. It exists as a file rather than an inline `python -c`
because the query contains quotes, and batch has no way to escape quotes inside
an already-quoted FOR /F command — the inline version silently hung.

Prints 0 rather than raising if the database is unreachable, so the launcher
treats "cannot connect" the same as "no schema" and runs create_tables.py, which
reports the real error properly.
"""

import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent


def database_url():
    env = BACKEND / ".env"
    for line in env.read_text(encoding="utf-8").splitlines():
        if line.startswith("DATABASE_URL="):
            return line.split("=", 1)[1].strip()
    raise RuntimeError("DATABASE_URL not found in backend/.env")


def main():
    try:
        from sqlalchemy import create_engine, text

        engine = create_engine(database_url())
        with engine.connect() as conn:
            count = conn.execute(
                text(
                    "SELECT count(*) FROM information_schema.tables "
                    "WHERE table_schema = 'public'"
                )
            ).scalar()
        print(count)
    except Exception:
        print(0)
        return 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
