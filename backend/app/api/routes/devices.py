"""
Device registration routes. A "device" here represents one physical
ESP32 smart meter unit, identified externally by external_id (the string
the firmware/simulator sends in its MQTT payload, e.g. "esp32_meter_01").
"""

from datetime import datetime, timezone
from uuid import UUID
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.core.database import get_db
from app.core.security import get_current_user_id
from app.core.billing_time import BILLING_TIMEZONE_NAME, now_local, cycle_start
from app.models.models import Device
from app.api.schemas import DeviceCreate, DeviceOut, DeviceLiveOut

router = APIRouter(prefix="/devices", tags=["devices"])

# Must match telemetry.py's threshold — both answer the same question.
ONLINE_HEARTBEAT_THRESHOLD_SECONDS = 45


@router.post("", response_model=DeviceOut, status_code=status.HTTP_201_CREATED)
def register_device(
    payload: DeviceCreate,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    existing = db.query(Device).filter(Device.external_id == payload.external_id).first()

    if existing:
        if str(existing.user_id) == user_id:
            # Already registered by this same user — treat as success,
            # not an error (idempotent pairing: re-running "Connect" is fine).
            return existing

        # Registered to a DIFFERENT user. In a real multi-tenant deployment
        # this should stay a hard error. For this project (single physical
        # demo device, re-paired across test accounts during development),
        # we re-home the device to the new user instead of blocking pairing —
        # this mirrors the real-world case of a device being reset and
        # re-paired to a new owner.
        existing.user_id = UUID(user_id)
        existing.device_label = payload.device_label
        db.commit()
        db.refresh(existing)
        return existing

    device = Device(
        user_id=UUID(user_id),
        external_id=payload.external_id,
        device_label=payload.device_label,
    )
    db.add(device)
    db.commit()
    db.refresh(device)
    return device


@router.get("", response_model=List[DeviceOut])
def list_devices(
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    return db.query(Device).filter(Device.user_id == UUID(user_id)).all()


@router.get("/{device_id}/live", response_model=DeviceLiveOut)
def get_device_live(
    device_id: UUID,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    """
    Live snapshot for the dashboard gauge: latest instantaneous reading plus
    today's and this cycle's energy.

    Scoped at the QUERY level — user_id is part of the WHERE clause, so another
    user's device_id returns 404 and never reaches the telemetry query. This is
    not a UI-level hide; there is no code path that reads telemetry for a device
    the caller does not own.

    Day and cycle boundaries come from app/core/billing_time.py (Africa/Cairo),
    the same source the bill forecast uses, so "today's kWh" here and the
    forecast's day series can never disagree about when a day starts.

    A device with no telemetry yet returns 200 with nulls and zeros rather than
    404: a freshly claimed device that has not published is a normal state the
    dashboard must render, not an error.
    """
    device = (
        db.query(Device)
        .filter(Device.device_id == device_id, Device.user_id == UUID(user_id))
        .first()
    )
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    latest = db.execute(
        text("""
            SELECT ts, voltage_rms, current_rms, power_w, power_factor, is_backfilled
            FROM telemetry_raw
            WHERE device_id = :device_id
            ORDER BY ts DESC
            LIMIT 1
        """),
        {"device_id": str(device_id)},
    ).mappings().first()

    now = now_local()
    energy = db.execute(
        text("""
            SELECT
                COALESCE(SUM(energy_wh_delta) FILTER (
                    WHERE (ts AT TIME ZONE :tz)::date = :today
                ), 0) / 1000.0 AS today_kwh,
                COALESCE(SUM(energy_wh_delta) FILTER (
                    WHERE (ts AT TIME ZONE :tz)::date >= :cycle_start
                ), 0) / 1000.0 AS month_kwh
            FROM telemetry_raw
            WHERE device_id = :device_id
              AND (ts AT TIME ZONE :tz)::date >= :cycle_start
        """),
        {
            "device_id": str(device_id),
            "tz": BILLING_TIMEZONE_NAME,
            "today": now.date(),
            "cycle_start": cycle_start(now.date()),
        },
    ).mappings().first()

    seconds_since = None
    if device.last_seen_at:
        seconds_since = round(
            (datetime.now(timezone.utc) - device.last_seen_at).total_seconds(), 1
        )

    return DeviceLiveOut(
        device_id=device.device_id,
        external_id=device.external_id,
        # Derived ONLY from last_seen_at, never recomputed from the latest
        # telemetry row — see the note in api/routes/telemetry.py.
        is_online=(
            seconds_since is not None
            and seconds_since <= ONLINE_HEARTBEAT_THRESHOLD_SECONDS
        ),
        last_seen_at=device.last_seen_at,
        seconds_since_last_seen=seconds_since,
        voltage_rms=float(latest["voltage_rms"]) if latest and latest["voltage_rms"] is not None else None,
        current_rms=float(latest["current_rms"]) if latest and latest["current_rms"] is not None else None,
        power_w=float(latest["power_w"]) if latest and latest["power_w"] is not None else None,
        power_factor=float(latest["power_factor"]) if latest and latest["power_factor"] is not None else None,
        reading_ts=latest["ts"] if latest else None,
        # Surfaced so the UI can mark a gauge fed by replayed buffer data rather
        # than a live reading, instead of presenting the two identically.
        reading_is_backfilled=bool(latest["is_backfilled"]) if latest else None,
        today_energy_kwh=round(float(energy["today_kwh"] or 0.0), 4),
        month_energy_kwh=round(float(energy["month_kwh"] or 0.0), 4),
    )