"""
Telemetry ingestion — the single validation-and-insert path for meter readings.

WHY THIS EXISTS
===============
Readings arrive by two routes: MQTT (app/workers/telemetry_worker.py, the normal
ESP32 path) and HTTP POST /telemetry (used by devices on networks that block
MQTT, and by tooling). Both call ingest_reading() here.

Having one function do the validating and inserting means the two paths cannot
drift apart — an HTTP reading and an MQTT reading of the same packet produce
byte-identical rows. When this logic was duplicated, the two paths disagreed
about whether to trust the device's own timestamp.

THE DATA CONTRACT
=================
    device_id         external string id, e.g. "esp32_meter_01"
    timestamp         ISO-8601, when the DEVICE took the reading
    voltage_rms       volts
    current_rms       amps
    power_w           watts (instantaneous active power)
    energy_wh_delta   Wh consumed SINCE THE PREVIOUS READING
    power_factor      0..1
    is_backfilled     true if replayed from the device's local buffer

energy_wh_delta is a DELTA, never a cumulative counter. This is the single most
important choice in the contract: an ESP32 loses its RAM counter on every reboot
or power cut, so a cumulative field would reset to zero and a naive
"latest minus earliest" energy calculation would go negative or lose the whole
day. Deltas are individually meaningful, so a lost packet costs only that packet
and a reboot costs nothing.

TIMESTAMPS
==========
The DEVICE's timestamp is authoritative, not arrival time. A meter that buffers
readings through a Wi-Fi outage and flushes them later must have them land on the
hours they were actually measured, or the hourly/daily rollups and the forecaster's
daily series are silently wrong. received_at separately records arrival, so the
lag is measurable rather than lost.

Readings with no usable timestamp fall back to arrival time, flagged in the
return value so the caller can log it — we do not silently pretend arrival time
is measurement time.

DUPLICATES
==========
(device_id, ts) is the primary key. A device retrying after an unacknowledged
publish, or an at-least-once MQTT delivery, will re-send a reading we already
have. Those are ignored silently via ON CONFLICT DO NOTHING: at-least-once
delivery makes duplicates a NORMAL event, not an error, and double-counting
energy_wh_delta would inflate the bill. The insert is skipped, not overwritten,
because the first copy of a reading is the one the device measured.
"""

import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

REQUIRED_FIELDS = ("device_id", "energy_wh_delta")

# Physical sanity bounds. A reading outside these is a sensor fault or a parsing
# error, not a real measurement; storing it would corrupt every aggregate built
# on top. Deliberately loose -- this rejects garbage, it does not second-guess
# plausible readings.
MAX_VOLTAGE_V = 400.0
MAX_CURRENT_A = 200.0
MAX_POWER_W = 50_000.0
# At 50 kW, one hour is 50 kWh; no single reading interval should approach that.
MAX_ENERGY_WH_DELTA = 10_000.0


class TelemetryValidationError(ValueError):
    """Payload violates the data contract and cannot be stored."""


@dataclass
class IngestResult:
    stored: bool                      # False => duplicate, already had it
    device_uuid: str
    ts: datetime
    timestamp_source: str             # "device" | "arrival"
    energy_wh_delta: float


def _coerce_float(payload: Dict[str, Any], key: str, required: bool = False) -> Optional[float]:
    value = payload.get(key)
    if value is None:
        if required:
            raise TelemetryValidationError(f"'{key}' is required")
        return None
    try:
        out = float(value)
    except (TypeError, ValueError):
        raise TelemetryValidationError(f"'{key}' must be a number, got {value!r}")
    if out != out or out in (float("inf"), float("-inf")):
        raise TelemetryValidationError(f"'{key}' must be finite, got {value!r}")
    return out


def parse_timestamp(raw: Any) -> tuple[Optional[datetime], Optional[str]]:
    """
    Parses the device's ISO-8601 timestamp. Returns (datetime, None) on success
    or (None, reason) on failure, so the caller can fall back to arrival time
    while recording that it did.

    A timestamp with no timezone is treated as UTC: ESP32 firmware syncing via
    SNTP works in UTC, and guessing a local zone would shift readings by hours.
    """
    if raw is None:
        return None, "no timestamp field in payload"
    if isinstance(raw, datetime):
        dt = raw
    else:
        try:
            # Accept a trailing "Z", which fromisoformat rejects before 3.11.
            dt = datetime.fromisoformat(str(raw).strip().replace("Z", "+00:00"))
        except (TypeError, ValueError):
            return None, f"unparseable timestamp {raw!r} (expected ISO-8601)"
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc), None


def validate_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Validates a telemetry packet against the data contract.

    Returns the cleaned field values. Raises TelemetryValidationError with a
    specific reason on any violation -- a caller must never have to guess which
    field was wrong.
    """
    if not isinstance(payload, dict):
        raise TelemetryValidationError("payload must be a JSON object")

    external_id = payload.get("device_id")
    if not external_id or not str(external_id).strip():
        raise TelemetryValidationError("'device_id' is required")

    energy_wh_delta = _coerce_float(payload, "energy_wh_delta", required=True)
    if energy_wh_delta < 0:
        # A negative delta means the firmware sent a cumulative counter that
        # rolled over, or subtracted wrongly. Storing it would credit the
        # household energy it never returned to the grid.
        raise TelemetryValidationError(
            f"'energy_wh_delta' must be >= 0 (it is a delta since the previous "
            f"reading, not a cumulative counter); got {energy_wh_delta}"
        )
    if energy_wh_delta > MAX_ENERGY_WH_DELTA:
        raise TelemetryValidationError(
            f"'energy_wh_delta' {energy_wh_delta} Wh exceeds the {MAX_ENERGY_WH_DELTA} Wh "
            f"sanity limit for a single reading interval"
        )

    voltage = _coerce_float(payload, "voltage_rms")
    current = _coerce_float(payload, "current_rms")
    power = _coerce_float(payload, "power_w")
    pf = _coerce_float(payload, "power_factor")

    for name, value, limit in (
        ("voltage_rms", voltage, MAX_VOLTAGE_V),
        ("current_rms", current, MAX_CURRENT_A),
        ("power_w", power, MAX_POWER_W),
    ):
        if value is None:
            continue
        if value < 0:
            raise TelemetryValidationError(f"'{name}' must be >= 0, got {value}")
        if value > limit:
            raise TelemetryValidationError(f"'{name}' {value} exceeds sanity limit {limit}")

    if pf is not None and not (0.0 <= pf <= 1.0):
        raise TelemetryValidationError(f"'power_factor' must be between 0 and 1, got {pf}")

    is_backfilled = payload.get("is_backfilled", False)
    if not isinstance(is_backfilled, bool):
        raise TelemetryValidationError(
            f"'is_backfilled' must be a boolean, got {is_backfilled!r}"
        )

    return {
        "external_id": str(external_id).strip(),
        "energy_wh_delta": energy_wh_delta,
        "voltage_rms": voltage,
        "current_rms": current,
        "power_w": power,
        "power_factor": pf,
        "is_backfilled": is_backfilled,
        "raw_timestamp": payload.get("timestamp"),
    }


def resolve_device(db: Session, external_id: str) -> Optional[str]:
    """external_id ("esp32_meter_01") -> internal device UUID, or None."""
    row = db.execute(
        text("SELECT device_id FROM devices WHERE external_id = :ext_id"),
        {"ext_id": external_id},
    ).mappings().first()
    return str(row["device_id"]) if row else None


def ingest_reading(db: Session, payload: Dict[str, Any]) -> IngestResult:
    """
    Validates and stores one telemetry reading. Commits on success.

    Raises TelemetryValidationError if the payload violates the contract, or
    LookupError if the device_id is not registered. Both are the caller's to
    translate into an HTTP status or a log line.
    """
    clean = validate_payload(payload)

    device_uuid = resolve_device(db, clean["external_id"])
    if device_uuid is None:
        raise LookupError(f"device '{clean['external_id']}' is not registered")

    arrival = datetime.now(timezone.utc)
    ts, ts_problem = parse_timestamp(clean["raw_timestamp"])
    if ts is None:
        # Fall back to arrival time, but say so — never silently assert that a
        # reading was measured when it happened to reach us.
        ts, timestamp_source = arrival, "arrival"
        logger.warning(
            "Telemetry from %s: %s — falling back to arrival time.",
            clean["external_id"], ts_problem,
        )
    else:
        timestamp_source = "device"

    # ON CONFLICT DO NOTHING, not an existence check: a concurrent insert
    # between a SELECT and an INSERT would still raise. Letting the database
    # enforce it is the only race-free option, and RETURNING tells us whether
    # the row was new.
    inserted = db.execute(
        text("""
            INSERT INTO telemetry_raw (
                device_id, ts, voltage_rms, current_rms, power_w,
                power_factor, energy_wh_delta, is_backfilled, received_at
            ) VALUES (
                :device_id, :ts, :voltage, :current, :power,
                :pf, :wh_delta, :backfilled, :received_at
            )
            ON CONFLICT (device_id, ts) DO NOTHING
            RETURNING ts
        """),
        {
            "device_id": device_uuid,
            "ts": ts,
            "voltage": clean["voltage_rms"],
            "current": clean["current_rms"],
            "power": clean["power_w"],
            "pf": clean["power_factor"],
            "wh_delta": clean["energy_wh_delta"],
            "backfilled": clean["is_backfilled"],
            "received_at": arrival,
        },
    ).first()

    stored = inserted is not None

    # last_seen_at is the single source of truth for online/offline (see
    # api/routes/telemetry.py). It tracks CONTACT, so it advances on a duplicate
    # too — the device demonstrably just talked to us. It is set from arrival
    # time, not the reading timestamp, because a device flushing a buffer of
    # week-old readings is online now; stamping it with the reading's timestamp
    # would show a live device as long offline.
    #
    # GREATEST guards against an out-of-order flush moving last_seen_at
    # backwards and making a live device flap offline.
    db.execute(
        text("""
            UPDATE devices
            SET last_seen_at = GREATEST(COALESCE(last_seen_at, :arrival), :arrival)
            WHERE device_id = :device_id
        """),
        {"arrival": arrival, "device_id": device_uuid},
    )

    db.commit()

    return IngestResult(
        stored=stored,
        device_uuid=device_uuid,
        ts=ts,
        timestamp_source=timestamp_source,
        energy_wh_delta=clean["energy_wh_delta"],
    )
