"""
Application entry point. Wires together all routers and CORS.

WHY THIS DOES NOT CREATE TABLES
===============================
`db/schema.sql` is the authoritative DDL, and this app deliberately does NOT run
`Base.metadata.create_all()` on startup.

Doing so was the mechanism behind the schema divergence in SUBMISSION_STATUS.md
§5. `create_all()` can only create tables that have an ORM model, and it emits no
database-level `DEFAULT gen_random_uuid()` and no CHECK constraints. So an
API-first boot against an empty database produced a partial schema — and because
`schema.sql` is written with `CREATE TABLE IF NOT EXISTS`, running it afterwards
silently SKIPPED every table the ORM had already made, leaving them permanently
without their defaults and constraints.

That failure is quiet and it is durable: nothing errors at boot, and the missing
default only surfaces later as a not-null violation on an `INSERT ... RETURNING`
issued outside the ORM. Both missing ORM models have since been added, so
`create_all()` would now produce all ten tables — but it would still produce them
without the DB-level defaults, so the trap remains. One authoritative source of
DDL, applied deliberately, is the fix.

Instead, startup CHECKS the schema and reports what is missing. A clear message
naming the command to run beats a half-built database that looks fine.
"""

import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.core.database import Base, engine
from app.models import models  # noqa: F401 — registers all models with Base

from app.api.routes import auth, tariff, budgets, appliances, telemetry, devices, predictions, nilm

logger = logging.getLogger(__name__)

# The ten tables db/schema.sql declares. Checked, never created, at startup.
EXPECTED_TABLES = {
    "users", "devices", "telemetry_raw", "telemetry_hourly", "telemetry_daily",
    "tariff_brackets", "bills_predicted", "budgets", "appliances", "recommendations",
}

SCHEMA_HELP = (
    "Apply the authoritative schema before starting the API:\n"
    r"  Get-Content db\schema.sql -Raw | docker exec -i smart_meter_postgres "
    "psql -U smart_meter_user -d smart_meter -v ON_ERROR_STOP=1"
)


def verify_schema() -> None:
    """
    Report which expected tables are missing. Never creates anything.

    Non-fatal by design: the API must still start so that /health and /docs are
    reachable while the database is being set up. The log line is loud enough to
    find, and every route that needs a missing table will fail loudly anyway.
    """
    try:
        with engine.connect() as conn:
            found = {
                row[0] for row in conn.execute(text(
                    "SELECT table_name FROM information_schema.tables "
                    "WHERE table_schema = 'public'"
                ))
            }
    except Exception as exc:
        logger.warning("Could not verify database schema (database unreachable?): %s", exc)
        return

    missing = EXPECTED_TABLES - found
    if missing:
        logger.error(
            "Database is missing %d expected table(s): %s\n%s",
            len(missing), ", ".join(sorted(missing)), SCHEMA_HELP,
        )
    else:
        logger.info("Database schema verified - all %d expected tables present.", len(EXPECTED_TABLES))


@asynccontextmanager
async def lifespan(app: FastAPI):
    # `@app.on_event("startup")` is deprecated in FastAPI 0.115; lifespan is the
    # supported replacement and gives shutdown a place to live if it is needed.
    verify_schema()
    yield


app = FastAPI(
    title="Smart Energy Meter API",
    version="1.0.0",
    description="IoT Smart Energy Meter backend — tariff engine, recommendation engine, telemetry ingestion.",
    lifespan=lifespan,
)

# CORS.
#
# Still an explicit allow-list, never a wildcard: "*" does not work with
# allow_credentials=True anyway, and naming the origins is the right default
# even for a dev project.
#
# The list is extendable through CORS_ORIGINS (comma-separated) because the
# frontend is no longer always on localhost — opening it on a phone over the
# LAN, or installing it as a PWA from a tunnelled HTTPS URL, means requests
# arrive from an origin this file cannot know in advance. Without that the
# browser blocks every call and the UI shows "cannot reach the API", which
# looks like the backend is down when it is running perfectly.
#
#   CORS_ORIGINS=http://192.168.1.20:3000,https://meter.trycloudflare.com
_DEFAULT_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"]
_EXTRA_ORIGINS = [
    o.strip() for o in os.getenv("CORS_ORIGINS", "").split(",") if o.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_DEFAULT_ORIGINS + _EXTRA_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api/v1")
app.include_router(tariff.router, prefix="/api/v1")
app.include_router(budgets.router, prefix="/api/v1")
app.include_router(appliances.router, prefix="/api/v1")
app.include_router(telemetry.router, prefix="/api/v1")
app.include_router(devices.router, prefix="/api/v1")
app.include_router(predictions.router, prefix="/api/v1")
app.include_router(nilm.router, prefix="/api/v1")


@app.get("/health")
def health_check():
    return {"status": "healthy", "service": "smart-energy-meter-backend"}
