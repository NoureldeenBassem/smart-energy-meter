"""
Bench test for the SCT-013 current clamp ALONE.

WHY A SEPARATE SCRIPT
=====================
main.py needs Wi-Fi, a reachable broker, a registered DEVICE_ID, NTP, and a
ZMPT101B wired to live mains before it tells you anything. If the current
reading is wrong, all of that sits between you and the fault. This script
removes every one of those dependencies: no Wi-Fi, no MQTT, no voltage sensor,
no mains connection on the board side. Just the clamp, the ADC and the serial
console.

Run this BEFORE wiring the ZMPT101B. The CT clamp is the safe sensor - it clips
around an insulated conductor without breaking it. The voltage module is the one
that connects to live mains, and there is no reason to take that risk while the
easy half is still unproven.

WHAT IT CHECKS, IN ORDER
========================
1. DC bias  - is the 10k/10k divider actually holding the input near mid-rail?
              This is the most common wiring fault and it is invisible in a
              scaled reading: with no bias the negative half of every cycle is
              clipped off at 0, so the RMS reads roughly half-right, which looks
              plausible and is wrong.
2. Clipping - is the waveform hitting 0 or 4095? A clipped peak reads LOW, not
              high, because the flattened top removes energy from the RMS.
3. RMS      - the same high-pass + true-RMS maths sensors.py uses, so numbers
              printed here are directly comparable to what the meter will
              report. The filter coefficient is imported rather than copied.

Amps and watts are scaled with CURRENT_CAL from config.py, which is a DATASHEET
ESTIMATE until you calibrate. Treat them as ballpark. The raw counts are the
trustworthy number here, and they are what calibration needs.
"""

import math
import time

from machine import ADC, Pin

import config

# Imported, not copied: if the filter is retuned in sensors.py this test must
# move with it, or it stops predicting what the meter will actually report.
from sensors import _HPF_ALPHA

# Only used to turn amps into an indicative wattage. The real firmware measures
# voltage; this script deliberately does not, so anything derived from this is
# an estimate and is labelled as one.
NOMINAL_VOLTAGE = 220.0

ADC_MAX = 4095
ADC_MID = ADC_MAX / 2

# A bias this far from mid-scale means the divider is missing, unbalanced, or
# the input is floating. 300 counts is ~0.24 V - well outside component
# tolerance, well inside "something is actually wrong".
BIAS_TOLERANCE_COUNTS = 300


def make_adc(pin_number):
    """
    Same ADC setup as sensors.MeterSampler, for the same reason: without
    ATTN_11DB the input tops out near 1.1 V and every waveform clips flat.
    """
    adc = ADC(Pin(pin_number))
    try:
        adc.atten(ADC.ATTN_11DB)
        adc.width(ADC.WIDTH_12BIT)
    except AttributeError:
        adc = ADC(Pin(pin_number), atten=ADC.ATTN_11DB)
    return adc


def measure(adc, window_us, warmup_us):
    """
    One measurement window. Returns raw diagnostics AND the filtered RMS.

    sensors.py deliberately throws the raw min/max/bias away - they are not part
    of a reading. They are exactly what you need to diagnose wiring, so they are
    kept here.
    """
    last_raw = adc.read()
    filt = 0.0

    # Let the high-pass filter settle. Its start-up transient is large enough to
    # dominate the first few cycles.
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

    _HPF_ALPHA is a fixed coefficient, but the corner frequency it produces is
    NOT fixed - it scales with how fast adc.read() returns:

        f_corner ~= (1 - alpha) / (2 * pi * dt)

    At ~20 kHz that corner is ~13 Hz and 50 Hz passes essentially untouched,
    which is the regime sensors.py was written for. At ~66 kHz it climbs to
    ~42 Hz and the filter starts eating the very signal it is meant to pass -
    a 23% attenuation, sitting silently inside every reading.

    That does not make the meter wrong, because calibration divides it straight
    back out. It does mean CURRENT_CAL is only valid at the sample rate it was
    calibrated at, and that no datasheet-derived default can be correct. Worth
    seeing the number rather than assuming it.
    """
    dt_s = (window_us / 1000000.0) / m["n"]
    fs = 1.0 / dt_s
    corner = (1.0 - _HPF_ALPHA) / (2 * math.pi * dt_s)
    gain = config.MAINS_FREQUENCY_HZ / math.sqrt(
        config.MAINS_FREQUENCY_HZ ** 2 + corner ** 2)

    print("--- sampling ---")
    print("  {} samples in {} ms -> {:.0f} Hz".format(
        m["n"], window_us // 1000, fs))
    print("  high-pass corner: {:.1f} Hz, gain at {} Hz: {:.3f}".format(
        corner, config.MAINS_FREQUENCY_HZ, gain))

    if gain < 0.90:
        print("  NOTE: the filter is attenuating mains by {:.0f}%.".format(
            (1 - gain) * 100))
        print("        Not an error - calibration divides it back out - but it")
        print("        means CURRENT_CAL is tied to THIS sample rate. Recalibrate")
        print("        if the sampling loop ever changes speed.")
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
                config.PIN_CURRENT))
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
    cycle_us = 1000000 // config.MAINS_FREQUENCY_HZ
    window_us = cycle_us * config.CYCLES_PER_SAMPLE
    warmup_us = cycle_us * 3

    print("")
    print("==============================================================")
    print(" SCT-013 current clamp test - GPIO {}".format(config.PIN_CURRENT))
    print("==============================================================")
    print(" mains       : {} Hz, integrating {} cycles ({} ms)".format(
        config.MAINS_FREQUENCY_HZ, config.CYCLES_PER_SAMPLE, window_us // 1000))
    print(" CURRENT_CAL : {} A per RMS count".format(config.CURRENT_CAL))
    print("               (datasheet estimate - calibrate before believing amps)")
    print(" noise floor : {} A".format(config.CURRENT_NOISE_FLOOR_A))
    print("")
    print(" Ctrl-C to stop.")
    print("")

    adc = make_adc(config.PIN_CURRENT)

    # Discard the very first window: the ADC's first conversions after the
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

        amps = m["rms_counts"] * config.CURRENT_CAL

        # Mirror the firmware's own gate, so this test agrees with what the
        # meter would publish rather than showing hum as a load.
        if amps < config.CURRENT_NOISE_FLOOR_A:
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
