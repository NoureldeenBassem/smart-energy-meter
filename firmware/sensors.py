"""
True-RMS sampling for a ZMPT101B voltage module and an SCT-013 current clamp.

WHY NOT JUST READ THE ADC AND SCALE IT
======================================
Both sensors output an AC waveform riding on a DC bias of roughly half the
supply, because the ESP32's ADC cannot read negative voltages. A single
adc.read() therefore tells you almost nothing: it is one point on a 50 Hz sine,
and it will be different 5 ms later. Averaging raw samples is worse — the mean
of a sine is its DC bias, so you would measure the bias network, not the mains.

What matters is the ROOT MEAN SQUARE over a whole number of cycles, which is
what a meter actually bills on.

REMOVING THE DC BIAS
====================
The bias is not exactly half-supply: it drifts with temperature, supply ripple
and component tolerance. Subtracting a hardcoded 2048 leaves a residual offset
that shows up squared in the RMS, inflating every reading — worst when the real
signal is small, which is exactly when accuracy matters (a house drawing 40 W).

So the bias is removed adaptively with a single-pole high-pass filter, the same
approach EmonLib uses:

    filtered[n] = a * (filtered[n-1] + raw[n] - raw[n-1])

At a ~0.996 coefficient this passes 50 Hz essentially untouched while rejecting
DC and slow drift. It needs a few cycles to settle, hence the warm-up below.

REAL POWER, NOT APPARENT POWER
==============================
Real power is the mean of v[n] * i[n] sampled simultaneously — it accounts for
the phase shift that motors and compressors introduce. Multiplying Vrms by Irms
instead gives APPARENT power, which over-reports a fridge or an air conditioner
by 10-40%. Since the whole product bills on kWh, that error would compound all
month. Power factor falls out as the ratio of the two.
"""

import math
import time

from machine import ADC, Pin

import config

# Filter coefficient. Close enough to 1 to leave 50 Hz alone, far enough below
# to reject DC and mains-frequency drift.
_HPF_ALPHA = 0.996

# Cycles discarded while the high-pass filter settles. Without this the first
# reading after boot is badly inflated by the filter's own transient.
_WARMUP_CYCLES = 3


class MeterSampler:
    def __init__(self):
        self._adc_v = self._make_adc(config.PIN_VOLTAGE)
        self._adc_i = self._make_adc(config.PIN_CURRENT)

        cycle_us = 1_000_000 // config.MAINS_FREQUENCY_HZ
        self._window_us = cycle_us * config.CYCLES_PER_SAMPLE
        self._warmup_us = cycle_us * _WARMUP_CYCLES

    @staticmethod
    def _make_adc(pin_number):
        """
        ATTN_11DB gives the full ~0-3.3 V input range. Without it the ADC tops
        out around 1.1 V and every waveform clips flat, which reads as a
        plausible-looking but badly wrong RMS.
        """
        adc = ADC(Pin(pin_number))
        # The API moved between MicroPython versions; support both spellings
        # rather than pinning the firmware to one build.
        try:
            adc.atten(ADC.ATTN_11DB)
            adc.width(ADC.WIDTH_12BIT)
        except AttributeError:
            adc = ADC(Pin(pin_number), atten=ADC.ATTN_11DB)
        return adc

    def _read_pair(self):
        return self._adc_v.read(), self._adc_i.read()

    def sample(self):
        """
        Integrate over a whole number of mains cycles and return one reading.

        Returns a dict of physical units: voltage_rms, current_rms, power_w,
        power_factor, plus sample_count for diagnostics.
        """
        read_pair = self._read_pair

        # ---- warm-up: run the filter without accumulating ----------------
        last_raw_v, last_raw_i = read_pair()
        filt_v = 0.0
        filt_i = 0.0
        start = time.ticks_us()
        while time.ticks_diff(time.ticks_us(), start) < self._warmup_us:
            raw_v, raw_i = read_pair()
            filt_v = _HPF_ALPHA * (filt_v + raw_v - last_raw_v)
            filt_i = _HPF_ALPHA * (filt_i + raw_i - last_raw_i)
            last_raw_v, last_raw_i = raw_v, raw_i

        # ---- measurement window ------------------------------------------
        sum_v2 = 0.0
        sum_i2 = 0.0
        sum_vi = 0.0
        n = 0

        start = time.ticks_us()
        while time.ticks_diff(time.ticks_us(), start) < self._window_us:
            raw_v, raw_i = read_pair()

            filt_v = _HPF_ALPHA * (filt_v + raw_v - last_raw_v)
            filt_i = _HPF_ALPHA * (filt_i + raw_i - last_raw_i)
            last_raw_v, last_raw_i = raw_v, raw_i

            sum_v2 += filt_v * filt_v
            sum_i2 += filt_i * filt_i
            sum_vi += filt_v * filt_i
            n += 1

        if n == 0:
            return self._empty()

        # ---- counts -> physical units ------------------------------------
        v_counts = math.sqrt(sum_v2 / n)
        i_counts = math.sqrt(sum_i2 / n)

        voltage_rms = v_counts * config.VOLTAGE_CAL
        current_rms = i_counts * config.CURRENT_CAL

        # Mean of the instantaneous product, scaled by both calibrations.
        power_w = (sum_vi / n) * config.VOLTAGE_CAL * config.CURRENT_CAL

        # An open or unloaded CT still picks up hum. Reporting that as real
        # current makes an empty house look like it draws 30-60 W all night.
        if current_rms < config.CURRENT_NOISE_FLOOR_A:
            current_rms = 0.0
            power_w = 0.0

        # Real power cannot be negative for a consuming load. A small negative
        # here means phase error or noise, not export.
        if power_w < 0.0:
            power_w = 0.0

        apparent = voltage_rms * current_rms
        if apparent > 0.0:
            power_factor = power_w / apparent
            # Numerical noise can nudge this just past 1.
            if power_factor > 1.0:
                power_factor = 1.0
        else:
            power_factor = 0.0

        return {
            "voltage_rms": round(voltage_rms, 2),
            "current_rms": round(current_rms, 3),
            "power_w": round(power_w, 2),
            "power_factor": round(power_factor, 3),
            "sample_count": n,
            # Raw RMS counts, kept because calibration is impossible without
            # them and printing them later would mean sampling twice.
            "raw_v_counts": round(v_counts, 2),
            "raw_i_counts": round(i_counts, 2),
        }

    @staticmethod
    def _empty():
        return {
            "voltage_rms": 0.0,
            "current_rms": 0.0,
            "power_w": 0.0,
            "power_factor": 0.0,
            "sample_count": 0,
            "raw_v_counts": 0.0,
            "raw_i_counts": 0.0,
        }
