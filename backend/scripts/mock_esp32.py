"""
Simulates an ESP32 smart meter publishing telemetry over MQTT.

    python scripts/mock_esp32.py                          # live, every 5s
    python scripts/mock_esp32.py --interval 2
    python scripts/mock_esp32.py --once                   # one reading, then exit
    python scripts/mock_esp32.py --backfill-minutes 60    # flush 60 min of buffered
                                                          # readings, then go live
    python scripts/mock_esp32.py --backfill-minutes 60 --no-live   # flush only

Requires a Device row already registered with this external_id via
POST /api/v1/devices — the ingest path drops packets for any external_id it
does not recognise (see app/services/telemetry/ingest.py).

WHY THIS SENDS AN EXPLICIT TIMESTAMP
====================================
Earlier versions of this script sent no `timestamp` field, so the ingest path fell
back to arrival time and every reading was stamped with the moment the server
happened to receive it. That is wrong in the one case that matters: a device
reconnecting after an outage. Its buffered readings would all be stamped "now",
collapsing hours of history into a single instant and corrupting the hourly and
daily rollups plus the bill forecast that reads them.

The device's clock is authoritative. A real ESP32 syncs via SNTP and works in UTC,
so timestamps are sent as ISO-8601 in UTC. The ingest path records whether it used
the device's timestamp or fell back to arrival time (`timestamp_source`), so the
distinction is visible rather than assumed.

WHY --backfill-minutes EXISTS
=============================
It demonstrates the offline-buffer case deliberately, because that is where the
data contract earns its design:

  * readings carry their ORIGINAL timestamps, not the flush time, so they land in
    the hour and day buckets they actually belong to;
  * `energy_wh_delta` is a DELTA for the interval, never a cumulative counter, so
    a burst of 720 buffered readings sums to exactly the energy consumed during the
    outage — and a device that reboots mid-outage does not reset a running total
    and lose everything before it;
  * they are flagged `is_backfilled=true`, so replayed data is never presented as a
    live measurement.

The burst is published back-to-back, the way a real device empties its buffer on
reconnect, not spaced at the publish interval.

NOTE ON THE LOAD MODEL
======================
The consumption model is deliberately simple: each tick draws current and power
factor independently at random inside a fixed range. It is adequate for exercising
the pipeline but it is NOT a realistic household load shape — a real house does not
redistribute its load across a 4x range every 5 seconds, so `peak_power_w` in the
rollups is higher relative to the mean than a real meter would report. Anything
that needs a realistic profile uses tools/backfill_demo_cycle.py instead, which
models base load, an air-conditioning duty cycle and the Egyptian weekend.
"""

import argparse
import json
import random
import sys
import time
from datetime import datetime, timedelta, timezone

import paho.mqtt.client as mqtt

MQTT_BROKER_HOST = "localhost"
MQTT_BROKER_PORT = 1883
DEVICE_EXTERNAL_ID = "esp32_meter_01"
PUBLISH_INTERVAL_SECONDS = 5

# Delay between messages while emptying the buffer. Small but non-zero so the
# broker and the ingest worker are not overrun by a few thousand messages.
BURST_DELAY_SECONDS = 0.01


def build_reading(external_id, ts, interval_seconds, is_backfilled):
    """
    One telemetry reading for the interval ENDING at `ts`.

    energy_wh_delta is the energy consumed during that interval only, derived from
    power_w so the two agree by construction. It is never a cumulative counter:
    a cumulative total would reset to zero when the ESP32 reboots and every reading
    before the reboot would be lost.
    """
    voltage = round(random.uniform(218.0, 226.0), 2)
    current = round(random.uniform(2.5, 9.8), 3)
    power_factor = round(random.uniform(0.92, 0.99), 2)
    power_w = round(voltage * current * power_factor, 2)

    return {
        "device_id": external_id,
        # UTC, ISO-8601. A real ESP32 keeps UTC via SNTP; local-time conversion is
        # the server's job (app/core/billing_time.py), not the device's.
        "timestamp": ts.astimezone(timezone.utc).isoformat(),
        "voltage_rms": voltage,
        "current_rms": current,
        "power_w": power_w,
        "power_factor": power_factor,
        "energy_wh_delta": round((power_w * interval_seconds) / 3600.0, 4),
        "is_backfilled": is_backfilled,
    }


def publish(client, topic, payload, qos=0, wait=False):
    info = client.publish(topic, json.dumps(payload), qos=qos)
    if wait:
        info.wait_for_publish(timeout=10)
    return info


def flush_buffer(client, topic, external_id, minutes, interval_seconds):
    """
    Publish the readings a device would have buffered during a `minutes`-long
    outage, each carrying the timestamp of the interval it actually covers.

    Returns (count, total_kwh) so the flush can be reconciled against the database.
    """
    now = datetime.now(timezone.utc)
    start = now - timedelta(minutes=minutes)
    n = int((minutes * 60) // interval_seconds)

    print(f"[*] Simulating a {minutes}-minute outage: flushing {n} buffered readings")
    print(f"    covering {start.isoformat()}")
    print(f"       .. to {now.isoformat()}")
    print(f"    with their ORIGINAL timestamps and is_backfilled=true.")

    total_wh = 0.0
    sent = 0
    for i in range(1, n + 1):
        ts = start + timedelta(seconds=i * interval_seconds)
        reading = build_reading(external_id, ts, interval_seconds, is_backfilled=True)
        total_wh += reading["energy_wh_delta"]
        # QoS 1 for the burst: a dropped message here is a permanent hole in the
        # history, unlike a dropped live reading which the next tick supersedes.
        publish(client, topic, reading, qos=1, wait=False)
        sent += 1
        if sent % 100 == 0:
            print(f"    ... {sent}/{n}")
        time.sleep(BURST_DELAY_SECONDS)

    total_kwh = total_wh / 1000.0
    print(f"[OK] Flushed {sent} readings, {total_kwh:.4f} kWh total.")
    print(f"     The deltas sum to the energy consumed during the outage — verify with:")
    print(f"       SELECT COUNT(*), SUM(energy_wh_delta)/1000.0 FROM telemetry_raw")
    print(f"       WHERE is_backfilled AND ts > '{start.isoformat()}';")
    return sent, total_kwh


def main():
    p = argparse.ArgumentParser(description="Mock ESP32 smart meter (MQTT publisher).")
    p.add_argument("--device", default=DEVICE_EXTERNAL_ID, help="external device id")
    p.add_argument("--broker", default=MQTT_BROKER_HOST)
    p.add_argument("--port", type=int, default=MQTT_BROKER_PORT)
    p.add_argument("--interval", type=float, default=PUBLISH_INTERVAL_SECONDS,
                   help=f"publish interval in seconds (default {PUBLISH_INTERVAL_SECONDS})")
    p.add_argument("--backfill-minutes", type=int, default=0,
                   help="simulate an outage of N minutes and flush the buffered "
                        "readings before going live")
    p.add_argument("--no-live", action="store_true",
                   help="with --backfill-minutes, exit after flushing")
    p.add_argument("--once", action="store_true", help="publish one live reading, then exit")
    args = p.parse_args()

    topic = f"home/{args.device}/telemetry"

    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    try:
        client.connect(args.broker, args.port, keepalive=60)
    except OSError as e:
        print(f"[!] Could not reach MQTT broker at {args.broker}:{args.port} — {e}")
        return 1

    # The previous version never started the network loop, which left QoS
    # handshakes and reconnects unserviced. The buffer flush below depends on it.
    client.loop_start()

    try:
        if args.backfill_minutes > 0:
            flush_buffer(client, topic, args.device, args.backfill_minutes, args.interval)
            if args.no_live:
                return 0
            print()

        if args.once:
            reading = build_reading(args.device, datetime.now(timezone.utc),
                                    args.interval, is_backfilled=False)
            publish(client, topic, reading, qos=1, wait=True)
            print(f"[>] {json.dumps(reading)}")
            return 0

        print(f"[*] Publishing live telemetry to '{topic}' every {args.interval}s "
              f"(Ctrl+C to stop)...")
        while True:
            reading = build_reading(args.device, datetime.now(timezone.utc),
                                    args.interval, is_backfilled=False)
            publish(client, topic, reading)
            print(f"[>] {reading['timestamp']}  {reading['power_w']:>8.2f} W  "
                  f"{reading['energy_wh_delta']:.4f} Wh")
            time.sleep(args.interval)

    except KeyboardInterrupt:
        print("\n[*] Simulator stopped.")
        return 0
    finally:
        client.loop_stop()
        client.disconnect()


if __name__ == "__main__":
    sys.exit(main())
