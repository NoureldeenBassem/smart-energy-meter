"""
Step-change (edge) detection over the aggregate power signal.

This is the first half of Hart's 1992 NILM algorithm — the original, and still
the most widely deployed, non-intrusive load monitoring technique. It needs no
training data and no labeled dataset (there is no Egyptian one; see
SUBMISSION_STATUS.md), because it does not learn appliance signatures — it
reads them from the wattage the user already typed in at onboarding
(`Appliance.rated_power_w`) and looks for steps of that size in the aggregate
signal. The tradeoff for not needing training data is that it cannot tell two
appliances of near-identical wattage apart with certainty — see matcher.py's
`ambiguous` field, which says so honestly rather than guessing.

WHY EDGE DETECTION, NOT A LEARNED MODEL
========================================
A deep-learning disaggregator (e.g. seq2seq or a CNN over the power trace)
would need thousands of hours of *labeled* per-appliance data to train on —
exactly the "no Egyptian household dataset exists yet" gap already documented
for the bill forecaster. Edge detection needs none: an appliance's ON/OFF
transition is a real, physical step in real power, and its size is
approximately its rated wattage — that is true by definition of what "rated
wattage" means, not something to be learned from examples.

WHY A DEBOUNCE WINDOW
========================================
A single noisy sample can look like a two-step edge (up, then straight back
down) even though nothing switched — line noise, an ADC glitch, or a motor's
inrush current settling. Requiring the new power level to hold for
`MIN_HOLD_SAMPLES` consecutive readings before confirming an edge turns that
noise into nothing, at the cost of a few seconds of detection latency, which
is irrelevant for a system whose finest granularity is a daily plan.
"""
from dataclasses import dataclass
from datetime import datetime
from enum import Enum


class EdgeDirection(str, Enum):
    RISE = "rise"   # power stepped up — something turned ON, or increased draw
    FALL = "fall"   # power stepped down — something turned OFF, or decreased draw


@dataclass(frozen=True)
class PowerSample:
    ts: datetime
    power_w: float


@dataclass(frozen=True)
class Edge:
    ts: datetime
    direction: EdgeDirection
    delta_w: float          # magnitude of the step, always positive
    level_before_w: float
    level_after_w: float


# Steps smaller than this are treated as normal load wobble (a TV's picture
# changing, a compressor's duty cycle), not a new appliance switching.
DEFAULT_EDGE_THRESHOLD_W = 30.0

# The new power level must hold for this many consecutive samples before the
# edge is confirmed — see module docstring.
DEFAULT_MIN_HOLD_SAMPLES = 2


def detect_edges(
    samples: list[PowerSample],
    edge_threshold_w: float = DEFAULT_EDGE_THRESHOLD_W,
    min_hold_samples: int = DEFAULT_MIN_HOLD_SAMPLES,
) -> list[Edge]:
    """
    Walk a chronological power trace and return every confirmed step change.

    `samples` must already be sorted by ts ascending — the caller (disaggregation.py)
    reads them straight out of an ORDER BY ts query, so this never re-sorts and
    never silently accepts out-of-order data, which would corrupt every delta.
    """
    if len(samples) < min_hold_samples + 1:
        return []

    edges: list[Edge] = []
    # `baseline` is the power level we are currently confirmed to be at —
    # not necessarily samples[0], because we only accept it once it holds.
    baseline = samples[0].power_w
    baseline_ts = samples[0].ts
    i = 1
    n = len(samples)

    while i < n:
        delta = samples[i].power_w - baseline
        if abs(delta) < edge_threshold_w:
            i += 1
            continue

        # Candidate step. Require the NEXT (min_hold_samples - 1) readings to
        # stay within edge_threshold_w of this new level before confirming —
        # a single spike that immediately reverts is noise, not an edge.
        candidate_level = samples[i].power_w
        hold_end = min(i + min_hold_samples, n)
        held = all(
            abs(samples[j].power_w - candidate_level) < edge_threshold_w
            for j in range(i, hold_end)
        )
        if not held or hold_end - i < min_hold_samples:
            # Not enough trailing samples to confirm, or it reverted — skip
            # this single sample and keep walking from the same baseline.
            i += 1
            continue

        edges.append(
            Edge(
                ts=samples[i].ts,
                direction=EdgeDirection.RISE if delta > 0 else EdgeDirection.FALL,
                delta_w=abs(delta),
                level_before_w=baseline,
                level_after_w=candidate_level,
            )
        )
        baseline = candidate_level
        baseline_ts = samples[i].ts
        i += 1

    return edges
