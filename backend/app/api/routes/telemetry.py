"""
Telemetry routes: live snapshot, hourly/daily rollups, and a combined
dashboard view.

Online/offline status is derived ONLY from Device.last_seen_at — never
recomputed from telemetry_raw's latest timestamp. The ingestion worker
(app/workers/telemetry_worker.py) is the single writer responsible for
keeping last_seen_at accurate on every ingested packet. This is
deliberate: computing "online" from two different tables in two
different places is what caused the online/offline flapping bug in
earlier versions of this project.
"""

from datetime import datetime, timezone, timedelta, date
from uuid import UUID
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.core.database import get_db
from app.core.security import get_current_user_id
from app.core.billing_time import cycle_start, today_local
from app.models.models import Device
from app.api.schemas import (
    TelemetryDashboardOut, HourlyBucket, DailyBucket,
    TelemetryIngestIn, TelemetryIngestOut,
)
from app.services.forecasting.bill_forecast import daily_kwh_this_cycle
from app.services.telemetry.ingest import (
    ingest_reading, TelemetryValidationError,
)

router = APIRouter(prefix="/telemetry", tags=["telemetry"])

# Named constant, not a magic number — tolerates ~1 missed publish cycle
# at the standard 5s publish interval without falsely flapping offline.
ONLINE_HEARTBEAT_THRESHOLD_SECONDS = 45


def _verify_device_ownership(device_id: UUID, user_id: str, db: Session) -> Device:
    device = (
        db.query(Device)
        .filter(Device.device_id == device_id, Device.user_id == UUID(user_id))
        .first()
    )
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    return device


def _is_online(device: Device) -> bool:
    if not device.last_seen_at:
        return False
    elapsed = (datetime.now(timezone.utc) - device.last_seen_at).total_seconds()
    return elapsed <= ONLINE_HEARTBEAT_THRESHOLD_SECONDS


@router.post("", response_model=TelemetryIngestOut, status_code=status.HTTP_202_ACCEPTED)
def post_telemetry(
    reading: TelemetryIngestIn,
    db: Session = Depends(get_db),
):
    """
    HTTP ingestion for one meter reading — the alternative to the MQTT path for
    devices on networks that block port 1883.

    Validation and insertion are delegated to app/services/telemetry/ingest.py,
    the SAME function the MQTT worker uses, so an HTTP reading and an MQTT
    reading of the same packet produce identical rows.

    Returns 202 with stored=false for a reading we already have. A duplicate is
    NOT an error: MQTT is at-least-once and a device that retries after an
    unacknowledged publish will legitimately resend. Rejecting it with a 409
    would make correct firmware log errors during normal operation. The reading
    is ignored rather than overwritten, so energy_wh_delta is never
    double-counted into the bill.

    AUTHENTICATION — KNOWN LIMITATION, STATED NOT HIDDEN
    ----------------------------------------------------
    This endpoint takes no credentials. A device is not a user, so a user JWT is
    the wrong instrument, and per-device tokens are not implemented. It matches
    the existing MQTT posture (the broker allows anonymous publish), so it adds
    no attack surface beyond what MQTT already has, but on an untrusted network
    either path would let an attacker inject readings for a registered
    device_id. Proper device credentials are required before deployment; they
    are not built. Only a registered external_id is accepted, which limits
    injection to devices that already exist.
    """
    try:
        result = ingest_reading(db, reading.model_dump())
    except TelemetryValidationError as exc:
        # 422: the payload is syntactically fine but violates the data contract.
        raise HTTPException(status_code=422, detail=str(exc))
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc))

    return TelemetryIngestOut(
        accepted=True,
        stored=result.stored,
        duplicate=not result.stored,
        device_id=UUID(result.device_uuid),
        ts=result.ts,
        timestamp_source=result.timestamp_source,
    )


@router.get("/dashboard/{device_id}", response_model=TelemetryDashboardOut)
def get_dashboard(
    device_id: UUID,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    device = _verify_device_ownership(device_id, user_id, db)

    latest = db.execute(
        text("""
            SELECT ts, voltage_rms, current_rms, power_w, power_factor
            FROM telemetry_raw
            WHERE device_id = :device_id
            ORDER BY ts DESC
            LIMIT 1
        """),
        {"device_id": str(device_id)},
    ).mappings().first()

    if not latest:
        raise HTTPException(status_code=404, detail="No telemetry data recorded yet for this device")

    # "Today" and "this month" are AFRICA/CAIRO days, not UTC ones, and they come
    # from the same helper the bill forecast and the recommendation budget use.
    #
    # This previously bucketed on datetime(now.year, now.month, now.day, tz=utc).
    # Cairo is UTC+3 in August, so between local midnight and 03:00 the UTC "today"
    # had not started yet and today_energy_kwh read essentially zero — measured
    # 0.0673 kWh against the correct 1.5929 kWh. That is the headline number on the
    # Overview page, so the bug was worst exactly when someone glanced at the
    # dashboard early in the morning. month_energy_kwh was wrong the same way
    # (386.5033 UTC vs 387.7244 Cairo) and disagreed with the kwh_so_far printed
    # beside it by the predicted bill.
    daily = daily_kwh_this_cycle(db, device_id, cycle_start(today_local()), today_local())
    today_kwh = daily[-1] if daily else 0.0
    month_kwh = sum(daily)

    return TelemetryDashboardOut(
        device_id=device.device_id,
        voltage=round(float(latest["voltage_rms"] or 0.0), 2),
        current=round(float(latest["current_rms"] or 0.0), 3),
        active_power=round(float(latest["power_w"] or 0.0), 2),
        power_factor=round(float(latest["power_factor"] or 0.0), 2),
        today_energy_kwh=round(float(today_kwh), 4),
        month_energy_kwh=round(float(month_kwh), 4),
        last_updated=latest["ts"],
    )


@router.get("/is-online/{device_id}")
def get_online_status(
    device_id: UUID,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    """
    Standalone endpoint for just the online/offline badge — lets the
    frontend poll this cheaply and frequently without re-fetching the
    full dashboard payload every time.
    """
    device = _verify_device_ownership(device_id, user_id, db)
    return {
        "device_id": str(device.device_id),
        "is_online": _is_online(device),
        "last_seen_at": device.last_seen_at,
    }


@router.get("/hourly/{device_id}", response_model=List[HourlyBucket])
def get_hourly(
    device_id: UUID,
    hours: int = Query(24, ge=1, le=168),
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    _verify_device_ownership(device_id, user_id, db)
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)

    rows = db.execute(
        text("""
            SELECT
                date_trunc('hour', ts) AS bucket_start,
                ROUND(AVG(power_w)::numeric, 2) AS avg_power_w,
                ROUND((SUM(energy_wh_delta) / 1000.0)::numeric, 4) AS total_energy_kwh
            FROM telemetry_raw
            WHERE device_id = :device_id AND ts >= :cutoff
            GROUP BY bucket_start
            ORDER BY bucket_start ASC
        """),
        {"device_id": str(device_id), "cutoff": cutoff},
    ).mappings().all()

    return [
        HourlyBucket(
            bucket_start=r["bucket_start"],
            avg_power_w=float(r["avg_power_w"] or 0.0),
            total_energy_kwh=float(r["total_energy_kwh"] or 0.0),
        )
        for r in rows
    ]


@router.get("/daily/{device_id}", response_model=List[DailyBucket])
def get_daily(
    device_id: UUID,
    days: int = Query(30, ge=1, le=90),
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    _verify_device_ownership(device_id, user_id, db)
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).date()

    rows = db.execute(
        text("""
            SELECT bucket_start, total_energy_kwh, avg_power_w, peak_power_w
            FROM telemetry_daily
            WHERE device_id = :device_id AND bucket_start >= :cutoff
            ORDER BY bucket_start ASC
        """),
        {"device_id": str(device_id), "cutoff": cutoff},
    ).mappings().all()

    return [dict(r) for r in rows]