# Wattwise ESP32 firmware (MicroPython)

Real sensor readings, published to the same MQTT contract the backend already
expects. This replaces `backend/scripts/mock_esp32.py`.

**Do not run both at once against the same `DEVICE_ID`.** The simulator's
invented numbers and the board's real ones would interleave into one series and
nothing downstream could tell them apart.

## Files

| File | What it is |
|---|---|
| `config.py` | Everything you edit — Wi-Fi, broker IP, pins, calibration |
| `sensors.py` | True-RMS sampling and real-power maths |
| `main.py` | Wi-Fi, NTP, MQTT, buffering, the publish loop |

## Wiring

**ADC1 pins only.** ADC2 is used internally by the Wi-Fi radio; any ADC2 pin
returns garbage the moment the radio is active. GPIO 34 and 35 are input-only,
which is what you want for a sensor input.

### ZMPT101B — voltage

| Module | ESP32 |
|---|---|
| VCC | 3V3 |
| GND | GND |
| OUT | GPIO 34 |

Mains side goes to the module's screw terminals. The module has an onboard
trimpot; set it so the output swings around half of 3.3 V without clipping, then
**do not touch it again** — the calibration constant is only valid for the pot
position you calibrated at.

### SCT-013 — current

The clamp is a current transformer. It needs a **burden resistor** across its
output and a **bias network** to lift the AC swing into the ADC's positive-only
range.

```
        SCT-013 ---+----[ 33R burden ]----+--- GND
                   |                      |
                   +------[ 10uF ]--------+
                   |
                   +---> GPIO 35
                   |
     3V3 ---[10k]--+--[10k]--- GND      (bias to ~1.65 V)
```

If your clamp is an **SCT-013-030** (or any model with a voltage output — it
says `1V` or `30A/1V` on the case) it already has an internal burden. Leave the
33R out or you will load it down and read low.

**Clamp around ONE conductor only** — live *or* neutral, never both. Around both
the fields cancel and the reading is zero, which looks exactly like a dead
sensor.

## Flashing

1. Install MicroPython on the board (once):

```bash
pip install esptool mpremote
```

```bash
python -m esptool --chip esp32 erase_flash
```

Download the ESP32 build from micropython.org/download/ESP32_GENERIC/, then:

```bash
python -m esptool --chip esp32 --baud 460800 write_flash -z 0x1000 ESP32_GENERIC-20250415-v1.25.0.bin
```

2. Install the MQTT library on the board:

```bash
python -m mpremote mip install umqtt.simple
```

3. Edit `config.py`, then copy all three files across:

```bash
python -m mpremote fs cp config.py sensors.py main.py :
```

4. Watch it run:

```bash
python -m mpremote repl
```

`main.py` runs automatically on boot. Ctrl-C in the REPL stops it; Ctrl-D
reboots.

## Calibration

**The defaults in `config.py` are estimates from datasheets, not measurements.**
Readings will be in the right ballpark and wrong in detail until you calibrate.
The ZMPT101B especially — its gain is whatever you left the trimpot at, so no
default can be right.

1. Set `CALIBRATION_MODE = True` in `config.py`, copy it across, open the REPL.
2. It prints `raw_v` and `raw_i` — RMS ADC counts — and publishes nothing.
3. With mains connected and a **known resistive load** running (a kettle or an
   incandescent bulb — *not* a motor or anything with a switch-mode supply,
   whose power factor makes amps and watts disagree), read your reference meter
   and compute:

```
VOLTAGE_CAL = actual_mains_volts / raw_v
CURRENT_CAL = actual_load_amps   / raw_i
```

4. Put those in `config.py`, set `CALIBRATION_MODE = False`, copy across again.

Sanity check afterwards: a 1000 W kettle on ~220 V should read close to 1000 W
with a power factor near 1.0. If PF reads low on a resistive load, your two
channels are out of phase — usually a long lead on one sensor.

## Safety

Mains wiring kills. The CT clamp is non-invasive and clips around an insulated
conductor without breaking it — that part is safe. The ZMPT101B is **not**: it
connects directly to live mains. Have someone qualified do that connection, work
on a de-energised circuit, and never leave the board's mains side exposed while
it is powered.

## Troubleshooting

| Symptom | Cause |
|---|---|
| Publishes fine, nothing in the app | `DEVICE_ID` is not a registered `external_id`. The ingest path silently drops unknown devices. Check this first. |
| `[mqtt] connect failed` | Wrong broker IP, or Windows Firewall blocking inbound 1883 on the PC. |
| Timestamps in the year 2000 | NTP failed. The board needs internet, not just LAN. |
| Voltage reads 0 | ZMPT101B trimpot at an extreme, or output not on an ADC1 pin. |
| Current reads 0 with load on | Clamp around both conductors instead of one, or clamp not closed. |
| ~40 W with everything off | Noise floor too low — raise `CURRENT_NOISE_FLOOR_A`. |
| Readings jump wildly | Using an ADC2 pin. Move to GPIO 32-39. |
