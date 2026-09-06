"""
Wattwise ESP32 meter firmware (MicroPython).

Samples a ZMPT101B voltage module and an SCT-013 current clamp, and publishes
one JSON reading per interval to MQTT, on the contract the backend already
expects:

    topic    home/<DEVICE_ID>/telemetry
    payload  {device_id, timestamp, voltage_rms, current_rms, power_w,
              power_factor, energy_wh_delta, is_backfilled}

This replaces backend/scripts/mock_esp32.py. Do not run both against the same
DEVICE_ID — the simulator's invented numbers and the board's real ones would
interleave into one series and nothing downstream could tell them apart.

THREE THINGS THIS FIRMWARE IS CAREFUL ABOUT
===========================================

1. energy_wh_delta is a DELTA over the interval just measured, never a running
   total. An ESP32 loses its RAM counter on every brownout and reboot; a
   cumulative field would reset to zero and the server's "latest minus earliest"
   would go negative or lose the day. Deltas cost only the packet that is lost.

2. The delta uses the MEASURED elapsed time, not PUBLISH_INTERVAL_SECONDS.
   Sampling, Wi-Fi retries and garbage collection all add jitter; assuming the
   nominal interval silently mis-bills every reading that ran long.

3. Readings taken while the broker is unreachable keep their ORIGINAL
   timestamps and are flagged is_backfilled, so an outage lands in the hours it
   actually happened instead of collapsing into the reconnect instant.
"""

import json
import time

import machine
import network
import ntptime
from umqtt.simple import MQTTClient

import config
from sensors import MeterSampler

TOPIC = b"home/%s/telemetry" % config.DEVICE_ID.encode()

# Same bounds the server enforces in app/services/telemetry/ingest.py. Checking
# here too means a sensor fault shows up on the serial console, next to the
# wiring, rather than as a silently dropped packet an hour later.
MAX_VOLTAGE_V = 400.0
MAX_CURRENT_A = 200.0
MAX_POWER_W = 50_000.0
MAX_ENERGY_WH_DELTA = 10_000.0


# ---------------------------------------------------------------------------
# Network
# ---------------------------------------------------------------------------

def connect_wifi(timeout_s=30):
    wlan = network.WLAN(network.STA_IF)
    wlan.active(True)
    if not wlan.isconnected():
        print("[wifi] connecting to", config.WIFI_SSID)
        wlan.connect(config.WIFI_SSID, config.WIFI_PASSWORD)
        deadline = time.time() + timeout_s
        while not wlan.isconnected():
            if time.time() > deadline:
                raise OSError("wifi: could not join %s" % config.WIFI_SSID)
            time.sleep(0.5)
    print("[wifi] connected, ip =", wlan.ifconfig()[0])
    return wlan


def sync_clock(retries=3):
    """
    Set the RTC from NTP, in UTC.

    The device's timestamp is authoritative for the whole pipeline, so an
    unsynced clock is not a cosmetic problem: readings would land in 2000-01-01
    and the rollups and forecaster would read an empty current month.
    """
    for attempt in range(retries):
        try:
            ntptime.settime()
            print("[ntp] clock set:", iso_now())
            return True
        except Exception as exc:
            print("[ntp] attempt %d failed: %s" % (attempt + 1, exc))
            time.sleep(2)
    print("[ntp] WARNING: clock not set; readings will carry a wrong timestamp")
    return False


def iso_now():
    """
    ISO-8601 UTC, built from time.gmtime() rather than an epoch arithmetic.

    MicroPython on the ESP32 counts from 2000-01-01, not 1970-01-01. Doing the
    maths by hand against the Unix epoch is the classic way to end up 30 years
    off; gmtime() sidesteps the question entirely.
    """
    y, m, d, hh, mm, ss, _, _ = time.gmtime()
    return "%04d-%02d-%02dT%02d:%02d:%02d+00:00" % (y, m, d, hh, mm, ss)


def connect_mqtt():
    client = MQTTClient(
        client_id=config.MQTT_CLIENT_ID,
        server=config.MQTT_BROKER_HOST,
        port=config.MQTT_BROKER_PORT,
        keepalive=60,
    )
    client.connect()
    print("[mqtt] connected to %s:%d" % (config.MQTT_BROKER_HOST, config.MQTT_BROKER_PORT))
    return client


# ---------------------------------------------------------------------------
# Readings
# ---------------------------------------------------------------------------

def build_payload(measurement, elapsed_s, timestamp, is_backfilled):
    """
    One reading in the server's contract.

    energy_wh_delta is derived from power_w and the interval actually measured,
    so the two agree by construction and cannot drift apart.
    """
    energy_wh = (measurement["power_w"] * elapsed_s) / 3600.0
    return {
        "device_id": config.DEVICE_ID,
        "timestamp": timestamp,
        "voltage_rms": measurement["voltage_rms"],
        "current_rms": measurement["current_rms"],
        "power_w": measurement["power_w"],
        "power_factor": measurement["power_factor"],
        "energy_wh_delta": round(energy_wh, 4),
        "is_backfilled": is_backfilled,
    }


def is_sane(payload):
    """Reject impossible readings here so they never enter the series."""
    if payload["voltage_rms"] > MAX_VOLTAGE_V:
        return False, "voltage %.1f V above %.0f" % (payload["voltage_rms"], MAX_VOLTAGE_V)
    if payload["current_rms"] > MAX_CURRENT_A:
        return False, "current %.1f A above %.0f" % (payload["current_rms"], MAX_CURRENT_A)
    if payload["power_w"] > MAX_POWER_W:
        return False, "power %.0f W above %.0f" % (payload["power_w"], MAX_POWER_W)
    if payload["energy_wh_delta"] > MAX_ENERGY_WH_DELTA:
        return False, "energy delta %.1f Wh above %.0f" % (
            payload["energy_wh_delta"], MAX_ENERGY_WH_DELTA)
    return True, None


# ---------------------------------------------------------------------------
# Calibration mode
# ---------------------------------------------------------------------------

def run_calibration(sampler):
    """
    Print raw counts and scaled values; publish nothing.

    Read the two RMS count figures with a KNOWN load connected, then set:

        VOLTAGE_CAL = actual_mains_volts / raw_v_counts
        CURRENT_CAL = actual_load_amps   / raw_i_counts

    Use a reference the numbers can be checked against — a plug-in energy
    monitor, a clamp meter, or a resistive load of known wattage (a kettle or an
    incandescent bulb; NOT anything with a motor or a switch-mode supply, whose
    power factor makes amps and watts disagree).
    """
    print("\n=== CALIBRATION MODE — nothing is published ===")
    print("raw_v / raw_i are RMS ADC counts. Divide your reference reading by")
    print("them to get VOLTAGE_CAL and CURRENT_CAL.\n")
    while True:
        m = sampler.sample()
        print(
            "raw_v=%8.2f  raw_i=%8.2f  |  V=%6.1f  I=%6.3f  P=%8.1f W  PF=%.3f  (n=%d)"
            % (m["raw_v_counts"], m["raw_i_counts"], m["voltage_rms"],
               m["current_rms"], m["power_w"], m["power_factor"], m["sample_count"])
        )
        time.sleep(1)


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------

def main():
    print("\n=== Wattwise ESP32 meter ===")
    sampler = MeterSampler()

    if config.CALIBRATION_MODE:
        # Deliberately before Wi-Fi: calibration works on a bench with no
        # network, and joining Wi-Fi first would just add a failure mode.
        run_calibration(sampler)
        return

    connect_wifi()
    sync_clock()

    client = None
    buffered = []
    last_tick = time.ticks_ms()

    while True:
        loop_start = time.ticks_ms()

        measurement = sampler.sample()

        now = time.ticks_ms()
        elapsed_s = time.ticks_diff(now, last_tick) / 1000.0
        last_tick = now

        payload = build_payload(measurement, elapsed_s, iso_now(), False)
        ok, why = is_sane(payload)
        if not ok:
            print("[skip] implausible reading:", why)
            time.sleep(config.PUBLISH_INTERVAL_SECONDS)
            continue

        # -- connect lazily, so a broker that is down does not stop sampling --
        if client is None:
            try:
                client = connect_mqtt()
            except Exception as exc:
                print("[mqtt] connect failed:", exc)

        published = False
        if client is not None:
            try:
                # Flush the outage buffer first, so history goes in before the
                # live reading that follows it.
                if buffered:
                    print("[mqtt] flushing %d buffered readings" % len(buffered))
                    while buffered:
                        old = buffered[0]
                        client.publish(TOPIC, json.dumps(old).encode(), qos=1)
                        buffered.pop(0)
                        # Small gap so a few hundred messages do not overrun the
                        # broker and the ingest worker.
                        time.sleep_ms(10)

                client.publish(TOPIC, json.dumps(payload).encode(), qos=1)
                published = True
                print("[>] %s  %.1f V  %.3f A  %.1f W  pf %.2f  %.4f Wh"
                      % (payload["timestamp"], payload["voltage_rms"],
                         payload["current_rms"], payload["power_w"],
                         payload["power_factor"], payload["energy_wh_delta"]))
            except Exception as exc:
                print("[mqtt] publish failed:", exc)
                try:
                    client.disconnect()
                except Exception:
                    pass
                client = None

        if not published:
            # Keep the original timestamp and mark it replayed, so the server
            # never presents buffered data as a live measurement.
            payload["is_backfilled"] = True
            buffered.append(payload)
            if len(buffered) > config.MAX_BUFFERED_READINGS:
                # Drop the OLDEST. Recent history is what the live dashboard and
                # the current-cycle bill depend on.
                buffered.pop(0)
            print("[buf] held %d/%d readings" % (len(buffered), config.MAX_BUFFERED_READINGS))

        # Sleep only the remainder, so sampling time does not stretch the
        # interval and skew the energy deltas.
        spent_ms = time.ticks_diff(time.ticks_ms(), loop_start)
        remaining_ms = config.PUBLISH_INTERVAL_SECONDS * 1000 - spent_ms
        if remaining_ms > 0:
            time.sleep_ms(remaining_ms)


try:
    main()
except Exception as exc:
    # A crash on a board with no console attached would otherwise hang dark.
    # Print, pause long enough to be read, then reboot.
    print("[fatal]", exc)
    time.sleep(10)
    machine.reset()
