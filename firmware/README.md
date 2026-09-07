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
| `test_current.py` | Bench test for the CT clamp alone — no Wi-Fi, no broker, no mains on the board |
| `arduino/test_current/test_current.ino` | The same bench test as an Arduino sketch, for the Arduino IDE. **Uploading it erases MicroPython** — see below |

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

## Testing the current clamp on its own

Do this **before** wiring the ZMPT101B. The CT clamp is the non-invasive sensor;
the voltage module is the one that touches live mains, and there is no reason to
take that risk while the easy half is unproven.

`test_current.py` needs no Wi-Fi, no broker, no `DEVICE_ID` and no voltage
sensor. It reads GPIO 35, prints a wiring verdict, then streams live readings.

### With Thonny (recommended — no command line at all)

Thonny can install MicroPython itself, so you never touch `esptool`.

1. **Install Thonny** from [thonny.org](https://thonny.org). Plug the ESP32 in.
2. **Install MicroPython on the board** (once):
   **Tools → Options → Interpreter**, set the interpreter to
   *MicroPython (ESP32)*, then click **Install or update MicroPython** at the
   bottom of that dialog. Choose your port, variant *ESP32 / ESP32 Generic*, and
   press Install. Wait for it to finish, then **OK**.
3. **Pick the port.** Same dialog, *Port* dropdown → your device. The Shell pane
   at the bottom should now show a `>>>` prompt. If it does not, press the red
   Stop button once — the board may be mid-script.
4. **Upload the two files this test imports.** Open the **Files** pane
   (*View → Files*). In the top half, browse to this `firmware/` folder.
   Right-click `config.py` → **Upload to /**. Do the same for `sensors.py`.
   They should appear in the lower *MicroPython device* half.
   Do **not** upload `main.py` yet — it would start trying to reach Wi-Fi and
   the broker on every boot, which is exactly the noise this test avoids.
5. **Open `test_current.py`** (*File → Open* → this `firmware/` folder) and
   press **F5** / the green Run button.

Thonny runs the open editor file on the board without storing it, so nothing on
the device is overwritten. Output appears in the Shell pane. **Stop with the red
Stop button** (or Ctrl-C in the Shell) — the script catches that and prints
`stopped.`

Why `config.py` and `sensors.py` have to be there: the test imports the pin
number, the calibration constants and the filter coefficient from them rather
than keeping its own copies, so it can never drift from what the meter actually
does. You need both files on the board for the real firmware anyway.

### With mpremote instead

If you would rather stay on the command line:

```bash
python -m mpremote run test_current.py
```

`run` executes it from your PC without storing it on the board. `config.py` and
`sensors.py` still need to be on the device (`python -m mpremote fs cp config.py
sensors.py :`). If `main.py` is already looping, mpremote interrupts it; the
board resumes normal operation on the next reset.

### What it tells you

It reports three things before any scaling can hide them:

- **DC bias** — should sit near 2048 counts (~1.65 V). Near 0 means the 10k/10k
  divider is not connected. This is the fault worth catching first: with no bias
  the negative half of every cycle is clipped off at 0, so the RMS reads roughly
  half-right, which looks plausible and is wrong.
- **Clipping** — raw min/max hitting 0 or 4095 means the burden resistor is too
  large. A clipped peak reads *low*, not high, because the flat top removes
  energy from the RMS.
- **Sample rate and filter corner** — see the note below.

Then a live table. Switch a known load on and off; `raw_i` and `amps` should
move immediately. Amps are scaled with the datasheet-estimate `CURRENT_CAL`, so
treat them as ballpark until you calibrate — the raw counts are the number to
trust here.

### If you are using the Arduino IDE instead

`arduino/test_current/test_current.ino` is the same test as a sketch, kept for
anyone who prefers the Arduino IDE. It needs no libraries. Two caveats: uploading
it **overwrites the MicroPython interpreter**, and the Arduino core does not read
the ADC at the same speed as MicroPython, so a `CURRENT_CAL` calibrated with the
sketch is not valid for the firmware. The MicroPython path above avoids both.

### The high-pass corner moves with sample rate

`_HPF_ALPHA` is a fixed coefficient, but the corner frequency it produces is
not — it scales with how fast `adc.read()` returns:

```
f_corner ~= (1 - alpha) / (2 * pi * dt)
```

| Effective sample rate | Corner | Gain at 50 Hz |
|---|---|---|
| 10 kHz | 6.4 Hz | 0.992 |
| 20 kHz | 12.7 Hz | 0.969 |
| 66 kHz | 42.0 Hz | **0.766** |

At 20 kHz — the regime `sensors.py` was written for — 50 Hz passes essentially
untouched. On a faster read loop the corner climbs toward the mains frequency
and the filter begins attenuating the signal it exists to pass, silently.

This does not make the meter wrong: calibration divides the attenuation straight
back out. It does mean **`CURRENT_CAL` is only valid at the sample rate it was
calibrated at**, and that no datasheet-derived default can be correct. If the
sampling loop ever changes speed, recalibrate. `test_current.py` prints the
measured rate and warns when the gain drops below 0.90.

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
