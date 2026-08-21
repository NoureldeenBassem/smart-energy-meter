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
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.core.database import get_db
from app.core.security import get_current_user_id
from app.models.models import Device
from app.api.schemas import TelemetryDashboardOut, HourlyBucket, DailyBucket

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

    now = datetime.now(timezone.utc)
    today_start = datetime(now.year, now.month, now.day, tzinfo=timezone.utc)
    month_start = datetime(now.year, now.month, 1, tzinfo=timezone.utc)

    today_kwh = db.execute(
        text("""
            SELECT COALESCE(SUM(energy_wh_delta) / 1000.0, 0)
            FROM telemetry_raw
            WHERE device_id = :device_id AND ts >= :today_start
        """),
        {"device_id": str(device_id), "today_start": today_start},
    ).scalar() or 0.0

    month_kwh = db.execute(
        text("""
            SELECT COALESCE(SUM(energy_wh_delta) / 1000.0, 0)
            FROM telemetry_raw
            WHERE device_id = :device_id AND ts >= :month_start
        """),
        {"device_id": str(device_id), "month_start": month_start},
    ).scalar() or 0.0

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