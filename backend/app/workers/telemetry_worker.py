"""
MQTT telemetry ingestion worker.

Subscribes to home/+/telemetry and hands each packet to
app/services/telemetry/ingest.py — the SAME function POST /telemetry uses. This
worker is deliberately thin: it owns the MQTT transport and nothing else.

Validation, external_id resolution, timestamp handling, duplicate suppression
and last_seen_at updates all live in the shared ingest service. When this file
carried its own copy of the insert it also carried its own bug: it stamped every
row with datetime.now(), discarding the device's own timestamp, so a meter that
buffered readings through a Wi-Fi outage had the whole backlog land on the minute
it reconnected.

Run as a standalone long-running process, separate from the API server:
    python -m app.workers.telemetry_worker
"""

import json
import logging
import os

import paho.mqtt.client as mqtt
from dotenv import load_dotenv

from app.core.database import SessionLocal
from app.services.telemetry.ingest import (
    ingest_reading, TelemetryValidationError,
)

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger("telemetry_worker")

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

    db = SessionLocal()
    try:
        result = ingest_reading(db, payload)

        if not result.stored:
            # Normal under at-least-once delivery, not a fault.
            print(f"[=] {payload.get('device_id')} duplicate reading at {result.ts} — ignored")
        else:
            flag = "" if result.timestamp_source == "device" else "  (no device timestamp)"
            print(
                f"[OK] {payload.get('device_id')} -> {payload.get('power_w')} W | "
                f"{result.energy_wh_delta} Wh delta @ {result.ts.isoformat()}{flag}"
            )

    except TelemetryValidationError as e:
        # Contract violation: log the specific field and drop the packet. Do not
        # store a partially-valid reading — every aggregate downstream would
        # inherit the corruption.
        print(f"[!] Rejected packet from '{payload.get('device_id')}': {e}")
    except LookupError as e:
        print(f"[!] {e} — skipping")
    except Exception as e:  # noqa: BLE001 - the worker must survive one bad packet
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
