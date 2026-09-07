"""
Everything you need to edit lives in this file.

Copy this onto the ESP32 alongside main.py and sensors.py, then change the
values marked EDIT ME. Nothing else in the firmware needs touching.
"""

# --------------------------------------------------------------------------
# Wi-Fi   (EDIT ME)
# --------------------------------------------------------------------------
# The ESP32 radio is 2.4 GHz only. If your router publishes 2.4 and 5 GHz under
# the same name, the board may fail to associate — give the 2.4 GHz band its own
# SSID if you hit that.
WIFI_SSID = "YOUR_WIFI_NAME"
WIFI_PASSWORD = "YOUR_WIFI_PASSWORD"

# --------------------------------------------------------------------------
# MQTT broker   (EDIT ME)
# --------------------------------------------------------------------------
# The LAN IP of the PC running docker compose. NOT "localhost" — localhost on
# the ESP32 means the ESP32 itself. Find it with `ipconfig` on Windows and read
# the IPv4 address of the adapter you are actually connected through.
MQTT_BROKER_HOST = "192.168.40.111"
MQTT_BROKER_PORT = 1883

# Must match the external_id of a Device row already registered through
# POST /api/v1/devices. The ingest path silently drops packets for any
# external_id it does not recognise, which looks exactly like a wiring fault —
# check this first if readings never appear.
DEVICE_ID = "esp32_meter_01"

# Published topic is home/<DEVICE_ID>/telemetry. The worker subscribes to
# home/+/telemetry, so the shape matters but the id does not have to be known
# to the broker in advance.
MQTT_CLIENT_ID = "esp32-" + DEVICE_ID

# --------------------------------------------------------------------------
# Pins
# --------------------------------------------------------------------------
# ADC1 ONLY. ADC2 is used internally by the Wi-Fi radio, and any ADC2 pin
# returns garbage (or blocks) the moment the radio is active. ADC1 is GPIO
# 32-39. GPIO 34-39 are input-only, which is what you want for a sensor input.
PIN_VOLTAGE = 34  # ZMPT101B output
PIN_CURRENT = 35  # SCT-013 CT clamp, across the burden resistor

# --------------------------------------------------------------------------
# Mains
# --------------------------------------------------------------------------
MAINS_FREQUENCY_HZ = 50  # Egypt is 50 Hz
CYCLES_PER_SAMPLE = 10  # whole mains cycles to integrate over, ~200 ms at 50 Hz

# --------------------------------------------------------------------------
# Calibration   (EDIT ME — see CALIBRATION in README.md)
# --------------------------------------------------------------------------
# These convert the ADC's raw counts into volts and amps. The defaults below
# are ESTIMATES from component datasheets, not measurements. Readings will be
# in the right ballpark and WRONG in detail until you calibrate against a
# reference meter. Run main.py with CALIBRATION_MODE = True to get the numbers.
#
# VOLTAGE_CAL: mains volts per unit of RMS ADC count.
#   The ZMPT101B has a trimpot on board, so its gain is whatever you left the
#   pot at. This value is only meaningful for YOUR module at YOUR pot setting.
VOLTAGE_CAL = 0.4470

# CURRENT_CAL: amps per unit of RMS ADC count.
#   For an SCT-013-000 (100 A : 50 mA) with a 33 ohm burden:
#   100 A primary -> 50 mA secondary -> 1.65 V peak -> 1.167 V RMS.
#   Adjust if your clamp ratio or burden resistor differs.
CURRENT_CAL = 0.0603

# Below this the reading is noise from an unloaded CT rather than real current.
# An open CT clamp still picks up hum; without this the house appears to draw
# 30-60 W at 3 a.m. with everything off.
CURRENT_NOISE_FLOOR_A = 0.08

# --------------------------------------------------------------------------
# Publishing
# --------------------------------------------------------------------------
PUBLISH_INTERVAL_SECONDS = 5

# Readings held in RAM while the broker is unreachable, flushed on reconnect.
# 360 x 5 s = 30 minutes. Raising this is tempting but each buffered reading
# costs heap, and an ESP32 that runs out of heap reboots and loses ALL of it.
MAX_BUFFERED_READINGS = 360

# --------------------------------------------------------------------------
# Diagnostics
# --------------------------------------------------------------------------
# True  -> print raw and scaled values to the serial console, publish nothing.
#          Use this to calibrate and to check wiring.
# False -> normal operation.
CALIBRATION_MODE = False
