"""
Bench test for the SCT-013 current clamp - SINGLE FILE, nothing to upload.

Open this in Thonny and press F5. That is the whole procedure. It imports
nothing from this project, so config.py and sensors.py do not need to be on the
board.

THE CONSTANTS BELOW ARE COPIES
==============================
test_current.py imports them from config.py and sensors.py so the two can never
disagree. This file cannot, because the point of it is to have no dependencies.
That trade is fine for a bench test and NOT fine for anything else: if you
change a value in config.py, change it here too, or this test stops predicting
what the meter actually does.

Values below were taken from config.py and sensors.py and verified equal to them
at the time this file was written.

WHAT IT CHECKS
==============
1. DC bias  - is the 10k/10k divider actually holding the input near mid-rail?
              The most common wiring fault, and invisible in a scaled reading:
              with no bias the negative half of every cycle is clipped off at 0,
              so the RMS reads roughly half-right, which looks plausible.
2. Clipping - is the waveform hitting 0 or 4095? A clipped peak reads LOW, not
              high, because the flattened top removes energy from the RMS.
3. RMS      - true RMS over a whole number of mains cycles, with the DC bias
              removed by a single-pole high-pass filter. A single adc.read()
              tells you almost nothing (it is one point on a 50 Hz sine), and
              averaging raw samples is worse - the mean of a sine is its bias,
              so you would measure the divider rather than the mains.

WIRING - GPIO 35
================
ADC1 only. ADC2 is used internally by the Wi-Fi radio and returns garbage the
moment the radio is active. GPIO 34-39 are ADC1 and input-only.

        SCT-013 ---+----[ 33R burden ]----+--- GND
                   |                      |
                   +------[ 10uF ]--------+
                   |
                   +---> GPIO 35
                   |
     3V3 ---[10k]--+--[10k]--- GND      (bias to ~1.65 V)

An SCT-013-030 (case says 30A/1V) has an internal burden - leave the 33R out.
Clamp around ONE conductor only; around both the fields cancel and you read
zero, which looks exactly like a dead sensor.

Stop with the red Stop button in Thonny.
"""

import math
import time

from machine import ADC, Pin

# ---- copies of config.py -------------------------------------------------
PIN_CURRENT = 35
MAINS_FREQUENCY_HZ = 50
CYCLES_PER_SAMPLE = 10
CURRENT_CAL = 0.0603
CURRENT_NOISE_FLOOR_A = 0.08

# ---- copy of sensors._HPF_ALPHA ------------------------------------------
# Close enough to 1 to leave 50 Hz alone, far enough below to reject DC drift.
_HPF_ALPHA = 0.996

# Only used to turn amps into an indicative wattage. This test does not measure
# voltage, so the watts column is an estimate and is labelled as one.
NOMINAL_VOLTAGE = 220.0

ADC_MAX = 4095
ADC_MID = ADC_MAX / 2

# 300 counts is ~0.24 V - well outside component tolerance, well inside
# "something is actually wrong".
BIAS_TOLERANCE_COUNTS = 300

# Cycles discarded while the high-pass filter settles. Without this the first
# reading after boot is badly inflated by the filter's own transient.
_WARMUP_CYCLES = 3


def make_adc(pin_number):
    """
    ATTN_11DB gives the full ~0-3.3 V input range. Without it the input tops out
    around 1.1 V and every waveform clips flat, which reads as a
    plausible-looking but badly wrong RMS.
    """
    adc = ADC(Pin(pin_number))
    try:
        adc.atten(ADC.ATTN_11DB)
        adc.width(ADC.WIDTH_12BIT)
    except AttributeError:
        adc = ADC(Pin(pin_number), atten=ADC.ATTN_11DB)
    return adc


def measure(adc, window_us, warmup_us):
    """One measurement window: raw diagnostics plus the filtered RMS."""
    last_raw = adc.read()
    filt = 0.0

    start = time.ticks_us()
    while time.ticks_diff(time.ticks_us(), start) < warmup_us:
        raw = adc.read()
        filt = _HPF_ALPHA * (filt + raw - last_raw)
        last_raw = raw

    raw_min = ADC_MAX
    raw_max = 0
    raw_sum = 0
    sum_sq = 0.0
    n = 0

    start = time.ticks_us()
    while time.ticks_diff(time.ticks_us(), start) < window_us:
        raw = adc.read()

        filt = _HPF_ALPHA * (filt + raw - last_raw)
        last_raw = raw

        if raw < raw_min:
            raw_min = raw
        if raw > raw_max:
            raw_max = raw
        raw_sum += raw
        sum_sq += filt * filt
        n += 1

    if n == 0:
        return None

    return {
        "n": n,
        "raw_min": raw_min,
        "raw_max": raw_max,
        "raw_pp": raw_max - raw_min,
        "bias": raw_sum / n,
        "rms_counts": math.sqrt(sum_sq / n),
    }


def check_filter(m, window_us):
    """
    Report the effective sample rate and what it does to the high-pass filter.

    _HPF_ALPHA is fixed, but the corner frequency it produces is not - it scales
    with how fast adc.read() returns:

        f_corner ~= (1 - alpha) / (2 * pi * dt)

    At ~20 kHz the corner is ~13 Hz and 50 Hz passes untouched. At ~66 kHz it
    climbs to ~42 Hz and the filter starts eating the very signal it is meant to
    pass - a 23% attenuation sitting silently inside every reading.

    That does not make the meter wrong: calibration divides it straight back
    out. It does mean CURRENT_CAL is only valid at the sample rate it was
    calibrated at.
    """
    dt_s = (window_us / 1000000.0) / m["n"]
    fs = 1.0 / dt_s
    corner = (1.0 - _HPF_ALPHA) / (2 * math.pi * dt_s)
    gain = MAINS_FREQUENCY_HZ / math.sqrt(
        MAINS_FREQUENCY_HZ ** 2 + corner ** 2)

    print("--- sampling ---")
    print("  {} samples in {} ms -> {:.0f} Hz".format(
        m["n"], window_us // 1000, fs))
    print("  high-pass corner: {:.1f} Hz, gain at {} Hz: {:.3f}".format(
        corner, MAINS_FREQUENCY_HZ, gain))

    if gain < 0.90:
        print("  NOTE: the filter is attenuating mains by {:.0f}%.".format(
            (1 - gain) * 100))
        print("        Not an error - calibration divides it back out - but it")
        print("        means CURRENT_CAL is tied to THIS sample rate.")
    print("")


def check_wiring(m):
    """Print a verdict on the raw numbers, before any scaling hides them."""
    print("--- wiring check ---")
    print("  DC bias      : {:.0f} counts (~{:.2f} V) - want ~{:.0f} (~1.65 V)".format(
        m["bias"], m["bias"] * 3.3 / ADC_MAX, ADC_MID))
    print("  raw min/max  : {} / {}   peak-to-peak {}".format(
        m["raw_min"], m["raw_max"], m["raw_pp"]))

    ok = True

    if abs(m["bias"] - ADC_MID) > BIAS_TOLERANCE_COUNTS:
        ok = False
        if m["bias"] < BIAS_TOLERANCE_COUNTS:
            print("  FAIL: input sits at the bottom of the range.")
            print("        The bias network is not doing anything. Check both")
            print("        10k resistors and that their midpoint reaches GPIO {}.".format(
                PIN_CURRENT))
        elif m["bias"] > ADC_MAX - BIAS_TOLERANCE_COUNTS:
            print("  FAIL: input is pinned at the top of the range.")
            print("        Looks like the pin is tied to 3V3 rather than to the")
            print("        divider midpoint.")
        else:
            print("  WARN: bias is off mid-rail. The divider is probably")
            print("        unbalanced (mismatched resistors), which costs")
            print("        headroom on one half of the waveform.")

    if m["raw_min"] <= 1 or m["raw_max"] >= ADC_MAX - 1:
        ok = False
        print("  FAIL: waveform is CLIPPING at the rail.")
        print("        Burden resistor is too large for this load. A clipped")
        print("        peak reads LOW, not high - the flat top removes energy")
        print("        from the RMS, so it under-reports and still looks fine.")

    if m["raw_pp"] < 4:
        print("  note: almost no AC swing. Correct if nothing is switched on;")
        print("        if a load IS running, the clamp is the suspect.")

    if ok:
        print("  OK: bias and headroom look right.")
    print("")
    return ok


def main():
    cycle_us = 1000000 // MAINS_FREQUENCY_HZ
    window_us = cycle_us * CYCLES_PER_SAMPLE
    warmup_us = cycle_us * _WARMUP_CYCLES

    print("")
    print("==============================================================")
    print(" SCT-013 current clamp test - GPIO {}".format(PIN_CURRENT))
    print("==============================================================")
    print(" mains       : {} Hz, integrating {} cycles ({} ms)".format(
        MAINS_FREQUENCY_HZ, CYCLES_PER_SAMPLE, window_us // 1000))
    print(" CURRENT_CAL : {} A per RMS count".format(CURRENT_CAL))
    print("               (datasheet estimate - calibrate before believing amps)")
    print(" noise floor : {} A".format(CURRENT_NOISE_FLOOR_A))
    print("")
    print(" Red Stop button to quit.")
    print("")

    adc = make_adc(PIN_CURRENT)

    # Discard the first window: the ADC's first conversions after the
    # attenuation change are not trustworthy.
    measure(adc, window_us, warmup_us)

    first = measure(adc, window_us, warmup_us)
    if first is None:
        print("No samples taken - the measurement window is too short.")
        return
    check_filter(first, window_us)
    check_wiring(first)

    print("--- live readings ---")
    print("Turn a known load on and off. The numbers should move immediately.")
    print("")
    print("   raw_i     p-p    bias      amps    watts@{}V  note".format(
        int(NOMINAL_VOLTAGE)))
    print("  ------   -----   -----   -------   ----------  ----")

    while True:
        m = measure(adc, window_us, warmup_us)
        if m is None:
            continue

        amps = m["rms_counts"] * CURRENT_CAL

        # Mirror the firmware's own gate, so this test agrees with what the
        # meter would publish rather than showing hum as a load.
        if amps < CURRENT_NOISE_FLOOR_A:
            note = "below noise floor -> meter reports 0"
            amps = 0.0
        elif m["raw_min"] <= 1 or m["raw_max"] >= ADC_MAX - 1:
            note = "CLIPPING - reading is too low"
        else:
            note = ""

        watts = amps * NOMINAL_VOLTAGE

        print("  {:6.1f}   {:5d}   {:5.0f}   {:7.3f}   {:10.1f}  {}".format(
            m["rms_counts"], m["raw_pp"], m["bias"], amps, watts, note))

        time.sleep(1)


try:
    main()
except KeyboardInterrupt:
    print("\nstopped.")
