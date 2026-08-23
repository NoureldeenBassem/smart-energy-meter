"""
Create the database schema by applying db/schema.sql.

    python create_tables.py

WHY THIS NO LONGER USES create_all()
====================================
It used to call `Base.metadata.create_all()`, and that was the direct cause of
the schema divergence written up in SUBMISSION_STATUS.md §5: a database built
this way was missing three declared tables, and the tables it DID create lacked
the database-level `DEFAULT gen_random_uuid()` and CHECK constraints that
`schema.sql` specifies. SQLAlchemy applies those defaults in Python, so any
`INSERT ... RETURNING` issued outside the ORM failed with a not-null violation.

Worse, the failure was durable. `schema.sql` uses `CREATE TABLE IF NOT EXISTS`,
so running it afterwards to "fix" things silently skipped every table the ORM had
already created — leaving them without their defaults permanently, with no error
anywhere.

Every ORM model now exists, so `create_all()` would at least produce all ten
tables. It would still produce them without the DB-level defaults, so the trap
would remain. Rather than leave a script that quietly builds a subtly wrong
database, this now applies the same authoritative DDL the README documents.

Safe to re-run: every statement in schema.sql is IF NOT EXISTS or
ON CONFLICT DO NOTHING.
"""

import sys
from pathlib import Path

from sqlalchemy import text

from app.core.database import engine

SCHEMA_PATH = Path(__file__).parent / "db" / "schema.sql"

EXPECTED_TABLES = {
    "users", "devices", "telemetry_raw", "telemetry_hourly", "telemetry_daily",
    "tariff_brackets", "bills_predicted", "budgets", "appliances", "recommendations",
}


def main() -> int:
    if not SCHEMA_PATH.exists():
        print(f"[!] Schema file not found: {SCHEMA_PATH}")
        return 1

    sql = SCHEMA_PATH.read_text(encoding="utf-8")
    print(f"[*] Applying {SCHEMA_PATH.name} ...")

    try:
        with engine.begin() as conn:
            # exec_driver_sql sends the file as one multi-statement batch, which
            # psycopg2 runs inside the single transaction opened by begin().
            # Either the whole schema applies or none of it does.
            conn.exec_driver_sql(sql)
    except Exception as exc:
        print(f"[!] Failed to apply schema: {exc}")
        return 1

    with engine.connect() as conn:
        found = {
            row[0] for row in conn.execute(text(
                "SELECT table_name FROM information_schema.tables "
                "WHERE table_schema = 'public'"
            ))
        }

    missing = EXPECTED_TABLES - found
    for name in sorted(EXPECTED_TABLES):
        print(f"    {'OK  ' if name in found else 'MISS'} {name}")

    if missing:
        print(f"[!] {len(missing)} table(s) still missing: {', '.join(sorted(missing))}")
        return 1

    print(f"[OK] Schema applied — all {len(EXPECTED_TABLES)} tables present.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
