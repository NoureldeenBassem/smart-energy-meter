/*
 * Bench test for the SCT-013 current clamp ALONE — Arduino / ESP32 core.
 *
 * This is a PORT of ../../test_current.py for people running the Arduino IDE
 * rather than MicroPython. Same maths, same constants, same verdicts.
 *
 * READ THIS BEFORE FLASHING
 * =========================
 * The real firmware in this repo is MicroPython. Uploading this sketch
 * OVERWRITES the MicroPython interpreter on the board. That is fine — this is a
 * bench test and nothing else needs to be on the board while you run it — but
 * to go back to the real meter you must reflash MicroPython and re-copy
 * config.py / sensors.py / main.py. See ../../README.md, "Flashing".
 *
 * If you would rather not lose the interpreter, use the MicroPython version
 * instead: `python -m mpremote run test_current.py` runs from your PC without
 * storing anything on the board.
 *
 * WHY A SEPARATE SKETCH AT ALL
 * ============================
 * The real firmware needs Wi-Fi, a reachable broker, a registered DEVICE_ID,
 * NTP, and a ZMPT101B wired to live mains before it tells you anything. If the
 * current reading is wrong, all of that sits between you and the fault. This
 * needs none of it: just the clamp, the ADC and the serial monitor.
 *
 * Run this BEFORE wiring the ZMPT101B. The CT clamp is the safe sensor — it
 * clips around an insulated conductor without breaking it. The voltage module
 * is the one that connects to live mains, and there is no reason to take that
 * risk while the easy half is still unproven.
 *
 * WIRING — GPIO 35
 * ================
 * ADC1 only. ADC2 is used internally by the Wi-Fi radio and returns garbage the
 * moment the radio is active. GPIO 34-39 are ADC1 and input-only.
 *
 *         SCT-013 ---+----[ 33R burden ]----+--- GND
 *                    |                      |
 *                    +------[ 10uF ]--------+
 *                    |
 *                    +---> GPIO 35
 *                    |
 *      3V3 ---[10k]--+--[10k]--- GND      (bias to ~1.65 V)
 *
 * An SCT-013-030 (case says 30A/1V) has an internal burden — leave the 33R out
 * or you will load it down and read low. Clamp around ONE conductor only; around
 * both, the fields cancel and you read zero, which looks exactly like a dead
 * sensor.
 *
 * Serial Monitor at 115200 baud.
 */

#include <math.h>

// ---------------------------------------------------------------------------
// Constants — these MIRROR config.py and sensors.py.
//
// The MicroPython test imports them so the two can never disagree. A C++ sketch
// cannot import a Python module, so these are copies. If you change a value in
// config.py, change it here too, or this test stops predicting what the meter
// will actually report.
// ---------------------------------------------------------------------------
static const int   PIN_CURRENT            = 35;      // config.PIN_CURRENT
static const int   MAINS_FREQUENCY_HZ     = 50;      // config.MAINS_FREQUENCY_HZ
static const int   CYCLES_PER_SAMPLE      = 10;      // config.CYCLES_PER_SAMPLE
static const float CURRENT_CAL            = 0.0603f; // config.CURRENT_CAL
static const float CURRENT_NOISE_FLOOR_A  = 0.08f;   // config.CURRENT_NOISE_FLOOR_A
static const float HPF_ALPHA              = 0.996f;  // sensors._HPF_ALPHA

// Only used to turn amps into an indicative wattage. The real firmware measures
// voltage; this sketch deliberately does not, so anything derived from this is
// an estimate and is labelled as one.
static const float NOMINAL_VOLTAGE = 220.0f;

static const int   ADC_MAX = 4095;
static const float ADC_MID = ADC_MAX / 2.0f;

// A bias this far from mid-scale means the divider is missing, unbalanced, or
// the input is floating. 300 counts is ~0.24 V — well outside component
// tolerance, well inside "something is actually wrong".
static const int BIAS_TOLERANCE_COUNTS = 300;

// Cycles discarded while the high-pass filter settles. Without this the first
// reading after boot is badly inflated by the filter's own transient.
static const int WARMUP_CYCLES = 3;

static uint32_t windowUs;
static uint32_t warmupUs;

struct Reading {
  uint32_t n;
  int      rawMin;
  int      rawMax;
  int      rawPp;
  float    bias;
  float    rmsCounts;
};

// ---------------------------------------------------------------------------

static void setupAdc() {
  analogReadResolution(12);
  // ADC_11db gives the full ~0-3.3 V input range. Without it the input tops out
  // around 1.1 V and every waveform clips flat, which reads as a
  // plausible-looking but badly wrong RMS.
  analogSetPinAttenuation(PIN_CURRENT, ADC_11db);
}

/*
 * One measurement window. Returns raw diagnostics AND the filtered RMS.
 *
 * sensors.py deliberately throws the raw min/max/bias away — they are not part
 * of a reading. They are exactly what you need to diagnose wiring, so they are
 * kept here.
 *
 * On the RMS itself: a single analogRead() tells you almost nothing, because
 * both sensors output an AC waveform riding on a DC bias. Averaging raw samples
 * is worse — the mean of a sine is its bias, so you would measure the divider
 * rather than the mains. What matters is the root mean square over a whole
 * number of cycles, with the bias removed adaptively by a single-pole high-pass
 * filter (subtracting a hardcoded 2048 leaves a residual that shows up squared
 * in the RMS, inflating every reading — worst when the real signal is small,
 * which is exactly when accuracy matters).
 */
static Reading measure() {
  Reading r;
  r.n = 0;
  r.rawMin = ADC_MAX;
  r.rawMax = 0;
  r.rawPp = 0;
  r.bias = 0.0f;
  r.rmsCounts = 0.0f;

  int   lastRaw = analogRead(PIN_CURRENT);
  float filt    = 0.0f;

  // Let the high-pass filter settle. Its start-up transient is large enough to
  // dominate the first few cycles.
  uint32_t start = micros();
  while ((uint32_t)(micros() - start) < warmupUs) {
    int raw = analogRead(PIN_CURRENT);
    filt = HPF_ALPHA * (filt + raw - lastRaw);
    lastRaw = raw;
  }

  double rawSum = 0.0;
  double sumSq  = 0.0;

  start = micros();
  while ((uint32_t)(micros() - start) < windowUs) {
    int raw = analogRead(PIN_CURRENT);

    filt = HPF_ALPHA * (filt + raw - lastRaw);
    lastRaw = raw;

    if (raw < r.rawMin) r.rawMin = raw;
    if (raw > r.rawMax) r.rawMax = raw;
    rawSum += raw;
    sumSq  += (double)filt * (double)filt;
    r.n++;
  }

  if (r.n == 0) return r;

  r.rawPp     = r.rawMax - r.rawMin;
  r.bias      = (float)(rawSum / r.n);
  r.rmsCounts = (float)sqrt(sumSq / r.n);
  return r;
}

/*
 * Report the effective sample rate and what it does to the high-pass filter.
 *
 * HPF_ALPHA is a fixed coefficient, but the corner frequency it produces is
 * NOT fixed — it scales with how fast analogRead() returns:
 *
 *     f_corner ~= (1 - alpha) / (2 * pi * dt)
 *
 * At ~20 kHz that corner is ~13 Hz and 50 Hz passes essentially untouched,
 * which is the regime sensors.py was written for. At ~66 kHz it climbs to
 * ~42 Hz and the filter starts eating the very signal it is meant to pass — a
 * 23% attenuation, sitting silently inside every reading.
 *
 * That does not make the meter wrong, because calibration divides it straight
 * back out. It does mean CURRENT_CAL is only valid at the sample rate it was
 * calibrated at, and that no datasheet-derived default can be correct. Worth
 * seeing the number rather than assuming it.
 *
 * Note that the Arduino core and MicroPython do NOT read the ADC at the same
 * speed, so a CURRENT_CAL calibrated with this sketch is not automatically
 * valid for the MicroPython firmware. Compare the printed rates.
 */
static void checkFilter(const Reading &r) {
  float dtS    = (windowUs / 1000000.0f) / (float)r.n;
  float fs     = 1.0f / dtS;
  float corner = (1.0f - HPF_ALPHA) / (2.0f * PI * dtS);
  float gain   = MAINS_FREQUENCY_HZ /
                 sqrtf((float)MAINS_FREQUENCY_HZ * MAINS_FREQUENCY_HZ + corner * corner);

  Serial.println("--- sampling ---");
  Serial.printf("  %lu samples in %lu ms -> %.0f Hz\n",
                (unsigned long)r.n, (unsigned long)(windowUs / 1000), fs);
  Serial.printf("  high-pass corner: %.1f Hz, gain at %d Hz: %.3f\n",
                corner, MAINS_FREQUENCY_HZ, gain);

  if (gain < 0.90f) {
    Serial.printf("  NOTE: the filter is attenuating mains by %.0f%%.\n",
                  (1.0f - gain) * 100.0f);
    Serial.println("        Not an error - calibration divides it back out - but it");
    Serial.println("        means CURRENT_CAL is tied to THIS sample rate. Recalibrate");
    Serial.println("        if the sampling loop ever changes speed.");
  }
  Serial.println();
}

/* Print a verdict on the raw numbers, before any scaling hides them. */
static bool checkWiring(const Reading &r) {
  Serial.println("--- wiring check ---");
  Serial.printf("  DC bias      : %.0f counts (~%.2f V) - want ~%.0f (~1.65 V)\n",
                r.bias, r.bias * 3.3f / ADC_MAX, ADC_MID);
  Serial.printf("  raw min/max  : %d / %d   peak-to-peak %d\n",
                r.rawMin, r.rawMax, r.rawPp);

  bool ok = true;

  if (fabsf(r.bias - ADC_MID) > BIAS_TOLERANCE_COUNTS) {
    ok = false;
    if (r.bias < BIAS_TOLERANCE_COUNTS) {
      Serial.println("  FAIL: input sits at the bottom of the range.");
      Serial.println("        The bias network is not doing anything. Check both");
      Serial.printf ("        10k resistors and that their midpoint reaches GPIO %d.\n",
                     PIN_CURRENT);
    } else if (r.bias > ADC_MAX - BIAS_TOLERANCE_COUNTS) {
      Serial.println("  FAIL: input is pinned at the top of the range.");
      Serial.println("        Looks like the pin is tied to 3V3 rather than to the");
      Serial.println("        divider midpoint.");
    } else {
      Serial.println("  WARN: bias is off mid-rail. The divider is probably");
      Serial.println("        unbalanced (mismatched resistors), which costs");
      Serial.println("        headroom on one half of the waveform.");
    }
  }

  if (r.rawMin <= 1 || r.rawMax >= ADC_MAX - 1) {
    ok = false;
    Serial.println("  FAIL: waveform is CLIPPING at the rail.");
    Serial.println("        Burden resistor is too large for this load. A clipped");
    Serial.println("        peak reads LOW, not high - the flat top removes energy");
    Serial.println("        from the RMS, so it under-reports and still looks fine.");
  }

  if (r.rawPp < 4) {
    Serial.println("  note: almost no AC swing. Correct if nothing is switched on;");
    Serial.println("        if a load IS running, the clamp is the suspect.");
  }

  if (ok) Serial.println("  OK: bias and headroom look right.");
  Serial.println();
  return ok;
}

// ---------------------------------------------------------------------------

void setup() {
  Serial.begin(115200);
  delay(300);

  uint32_t cycleUs = 1000000UL / MAINS_FREQUENCY_HZ;
  windowUs = cycleUs * CYCLES_PER_SAMPLE;
  warmupUs = cycleUs * WARMUP_CYCLES;

  setupAdc();

  Serial.println();
  Serial.println("==============================================================");
  Serial.printf (" SCT-013 current clamp test - GPIO %d\n", PIN_CURRENT);
  Serial.println("==============================================================");
  Serial.printf (" mains       : %d Hz, integrating %d cycles (%lu ms)\n",
                 MAINS_FREQUENCY_HZ, CYCLES_PER_SAMPLE,
                 (unsigned long)(windowUs / 1000));
  Serial.printf (" CURRENT_CAL : %.4f A per RMS count\n", CURRENT_CAL);
  Serial.println("               (datasheet estimate - calibrate before believing amps)");
  Serial.printf (" noise floor : %.2f A\n", CURRENT_NOISE_FLOOR_A);
  Serial.println();

  // Discard the very first window: the ADC's first conversions after the
  // attenuation change are not trustworthy.
  measure();

  Reading first = measure();
  if (first.n == 0) {
    Serial.println("No samples taken - the measurement window is too short.");
    return;
  }
  checkFilter(first);
  checkWiring(first);

  Serial.println("--- live readings ---");
  Serial.println("Turn a known load on and off. The numbers should move immediately.");
  Serial.println();
  Serial.printf("   raw_i     p-p    bias      amps    watts@%dV  note\n",
                (int)NOMINAL_VOLTAGE);
  Serial.println("  ------   -----   -----   -------   ----------  ----");
}

void loop() {
  Reading r = measure();
  if (r.n == 0) return;

  float amps = r.rmsCounts * CURRENT_CAL;
  const char *note = "";

  // Mirror the firmware's own gate, so this test agrees with what the meter
  // would publish rather than showing hum as a load.
  if (amps < CURRENT_NOISE_FLOOR_A) {
    note = "below noise floor -> meter reports 0";
    amps = 0.0f;
  } else if (r.rawMin <= 1 || r.rawMax >= ADC_MAX - 1) {
    note = "CLIPPING - reading is too low";
  }

  Serial.printf("  %6.1f   %5d   %5.0f   %7.3f   %10.1f  %s\n",
                r.rmsCounts, r.rawPp, r.bias, amps,
                amps * NOMINAL_VOLTAGE, note);

  delay(1000);
}
