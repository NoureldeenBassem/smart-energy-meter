"""
Live contract test for POST /telemetry against the running API and real DB.

Run from backend/ with the API up:
    python -m tools.check_telemetry_contract

Exercises the accept path, the duplicate path, and every validation rule,
printing the real HTTP status and body for each so the behaviour is visible
rather than asserted in silence.
"""

import json
import sys
from datetime import datetime, timedelta, timezone

import requests
from sqlalchemy import text, bindparam

from app.core.database import SessionLocal

BASE = "http://127.0.0.1:8000/api/v1"
DEVICE = "esp32_meter_01"

# Well clear of the mock device's live data so this test cannot pollute the
# current billing cycle's daily series.
TS = datetime(2026, 3, 15, 10, 0, 0, tzinfo=timezone.utc)


def valid(**overrides):
    payload = {
        "device_id": DEVICE,
        "timestamp": TS.isoformat(),
        "voltage_rms": 223.4,
        "current_rms": 2.15,
        "power_w": 462.0,
        "energy_wh_delta": 38.5,
        "power_factor": 0.96,
        "is_backfilled": False,
    }
    payload.update(overrides)
    return payload


def post(payload, label):
    r = requests.post(f"{BASE}/telemetry", json=payload, timeout=10)
    try:
        body = r.json()
    except ValueError:
        body = r.text
    detail = body.get("detail") if isinstance(body, dict) else body
    if isinstance(detail, list):  # pydantic error list
        detail = "; ".join(f"{'.'.join(str(x) for x in e.get('loc', []))}: {e.get('msg')}"
                           for e in detail)
    print(f"  {label:<44} -> {r.status_code}  {detail if r.status_code >= 400 else json.dumps(body)}")
    return r


def cleanup(probe_timestamps):
    """
    Remove the rows this test inserted.

    Without this the probes accumulate in telemetry_raw and, worse, the
    arrival-time probe lands inside the CURRENT billing cycle and shifts the
    live bill forecast. A test must not silently alter the data the app reports
    on.
    """
    if not probe_timestamps:
        return
    db = SessionLocal()
    try:
        # Expanding bindparam rather than `= ANY(:list)`: psycopg needs an
        # explicit array type for ANY, and IN with an expanded list needs none.
        stmt = text("""
            DELETE FROM telemetry_raw
            WHERE device_id = (SELECT device_id FROM devices WHERE external_id = :ext)
              AND ts IN :timestamps
        """).bindparams(bindparam("timestamps", expanding=True))
        result = db.execute(stmt, {"ext": DEVICE, "timestamps": probe_timestamps})
        db.commit()
        print(f"[*] Cleaned up {result.rowcount} probe row(s) from telemetry_raw.")
    finally:
        db.close()


def main():
    probes = []

    print("[*] Accept path")
    r = post(valid(), "valid reading")
    if r.status_code == 202:
        probes.append(r.json()["ts"])
    if r.status_code != 202 or not r.json().get("stored"):
        print("[FAIL] valid reading was not stored")
        cleanup(probes)
        return 1
    if r.json().get("timestamp_source") != "device":
        print("[FAIL] device timestamp was not honoured")
        cleanup(probes)
        return 1

    print()
    print("[*] Duplicate suppression (same device_id + ts)")
    r = post(valid(power_w=999.0), "exact same timestamp, different power")
    body = r.json()
    if r.status_code != 202 or body.get("stored") or not body.get("duplicate"):
        print("[FAIL] duplicate was not silently ignored")
        cleanup(probes)
        return 1

    print()
    print("[*] Missing timestamp falls back to arrival, flagged")
    r = post({"device_id": DEVICE, "energy_wh_delta": 1.0}, "no timestamp field")
    if r.status_code == 202:
        probes.append(r.json()["ts"])
    if r.json().get("timestamp_source") != "arrival":
        print("[FAIL] missing timestamp was not flagged as arrival-sourced")
        cleanup(probes)
        return 1

    print()
    print("[*] Contract violations (must all be rejected)")
    cases = [
        (valid(energy_wh_delta=-5.0), "negative energy_wh_delta"),
        (valid(energy_wh_delta=99999.0), "energy_wh_delta over sanity limit"),
        (valid(power_factor=1.7), "power_factor > 1"),
        (valid(voltage_rms=-1.0), "negative voltage"),
        (valid(voltage_rms=9999.0), "voltage over sanity limit"),
        (valid(current_rms=5000.0), "current over sanity limit"),
        (valid(power_w=999999.0), "power over sanity limit"),
        (valid(timestamp="not-a-date"), "unparseable timestamp"),
        ({"device_id": DEVICE}, "missing energy_wh_delta"),
        (valid(device_id="no_such_device"), "unregistered device"),
    ]
    failures = []
    for payload, label in cases:
        r = post(payload, label)
        if r.status_code < 400:
            failures.append(label)

    print()
    cleanup(probes)
    print()
    if failures:
        print(f"[FAIL] these invalid payloads were ACCEPTED: {failures}")
        return 1

    print("[OK] All contract cases behaved correctly.")
    print("     Note: 'unparseable timestamp' is rejected at the Pydantic layer (422)")
    print("     before reaching the ingest service; a payload arriving over MQTT")
    print("     instead falls back to arrival time with a warning, since dropping a")
    print("     real reading is worse than recording it with a known-approximate ts.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
