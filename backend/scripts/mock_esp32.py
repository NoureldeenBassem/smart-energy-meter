"""
Simulates an ESP32 smart meter, publishing realistic mock telemetry
over MQTT every 5 seconds. Used for development/testing before real
hardware is flashed.

Run:
    python scripts/mock_esp32.py

Requires a Device row already registered with this external_id via
POST /api/v1/devices — the worker will silently drop packets for any
external_id it doesn't recognize.
"""

import time
import json
import random
import paho.mqtt.client as mqtt

MQTT_BROKER_HOST = "localhost"
MQTT_BROKER_PORT = 1883
DEVICE_EXTERNAL_ID = "esp32_meter_01"
MQTT_TOPIC = f"home/{DEVICE_EXTERNAL_ID}/telemetry"
PUBLISH_INTERVAL_SECONDS = 5


def main():
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    client.connect(MQTT_BROKER_HOST, MQTT_BROKER_PORT, keepalive=60)
    print(f"[*] Publishing simulated telemetry to '{MQTT_TOPIC}' every {PUBLISH_INTERVAL_SECONDS}s (Ctrl+C to stop)...")

    try:
        while True:
            voltage = round(random.uniform(218.0, 226.0), 2)
            current = round(random.uniform(2.5, 9.8), 3)
            power_factor = round(random.uniform(0.92, 0.99), 2)
            power_w = round(voltage * current * power_factor, 2)

            energy_wh_delta = round((power_w * PUBLISH_INTERVAL_SECONDS) / 3600.0, 4)

            payload = {
                "device_id": DEVICE_EXTERNAL_ID,
                "voltage_rms": voltage,
                "current_rms": current,
                "power_w": power_w,
                "power_factor": power_factor,
                "energy_wh_delta": energy_wh_delta,
                "is_backfilled": False,
            }

            client.publish(MQTT_TOPIC, json.dumps(payload))
            print(f"[>] Published: {payload}")
            time.sleep(PUBLISH_INTERVAL_SECONDS)

    except KeyboardInterrupt:
        print("\n[*] Simulator stopped.")
        client.disconnect()


if __name__ == "__main__":
    main()