"""
MQTT telemetry ingestion worker.

Subscribes to home/+/telemetry, resolves each incoming packet's
"device_id" (an external_id string like "esp32_meter_01") against the
Device table, inserts a row into telemetry_raw, and updates
Device.last_seen_at — the single source of truth used by
telemetry.py's is_online check.

Run as a standalone long-running process, separate from the API server:
    python -m app.workers.telemetry_worker
"""

import os
import json
from datetime import datetime, timezone
from dotenv import load_dotenv
import paho.mqtt.client as mqtt
from sqlalchemy import text

from app.core.database import SessionLocal

load_dotenv()

MQTT_BROKER_HOST = os.getenv("MQTT_BROKER_HOST", "localhost")
MQTT_BROKER_PORT = int(os.getenv("MQTT_BROKER_PORT", "1883"))
MQTT_TOPIC_FILTER = os.getenv("MQTT_TOPIC_FILTER", "home/+/telemetry")


def on_connect(client, userdata, flags, rc, properties=None):
    if rc == 0:
        print(f"[*] Connected to MQTT broker at {MQTT_BROKER_HOST}:{MQTT_BROKER_PORT}")
        client.subscribe(MQTT_TOPIC_FILTER)
        print(f"[*] Subscribed to topic: {MQTT_TOPIC_FILTER}")
    else:
        print(f"[!] MQTT connection failed with code {rc}")


def on_message(client, userdata, msg):
    try:
        payload = json.loads(msg.payload.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as e:
        print(f"[!] Failed to parse message payload: {e}")
        return

    external_id = payload.get("device_id")
    if not external_id:
        print("[!] Skipping message: missing device_id field")
        return

    db = SessionLocal()
    try:
        # Resolve external_id -> internal UUID device_id
        device_row = db.execute(
            text("SELECT device_id FROM devices WHERE external_id = :ext_id"),
            {"ext_id": external_id},
        ).mappings().first()

        if not device_row:
            print(f"[!] Received telemetry for unregistered device '{external_id}' — skipping")
            return

        device_uuid = device_row["device_id"]
        now_utc = datetime.now(timezone.utc)

        db.execute(
            text("""
                INSERT INTO telemetry_raw (
                    device_id, ts, voltage_rms, current_rms, power_w,
                    power_factor, energy_wh_delta, is_backfilled, received_at
                ) VALUES (
                    :device_id, :ts, :voltage, :current, :power,
                    :pf, :wh_delta, :backfilled, :received_at
                )
            """),
            {
                "device_id": str(device_uuid),
                "ts": now_utc,
                "voltage": payload.get("voltage_rms"),
                "current": payload.get("current_rms"),
                "power": payload.get("power_w"),
                "pf": payload.get("power_factor"),
                "wh_delta": payload.get("energy_wh_delta", 0.0),
                "backfilled": payload.get("is_backfilled", False),
                "received_at": now_utc,
            },
        )

        # Single source of truth for online/offline status — updated on
        # every successfully ingested packet, in the same transaction
        # as the telemetry insert so they can never drift apart.
        db.execute(
            text("UPDATE devices SET last_seen_at = :ts WHERE device_id = :device_id"),
            {"ts": now_utc, "device_id": str(device_uuid)},
        )

        db.commit()
        print(f"[✓] {external_id} -> {payload.get('power_w')} W | {payload.get('energy_wh_delta')} Wh delta")

    except Exception as e:
        db.rollback()
        print(f"[!] Database error while ingesting packet: {e}")
    finally:
        db.close()


def run():
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    client.on_connect = on_connect
    client.on_message = on_message

    client.connect(MQTT_BROKER_HOST, MQTT_BROKER_PORT, keepalive=60)
    print("[*] Telemetry ingestion worker starting...")
    client.loop_forever()


if __name__ == "__main__":
    run()