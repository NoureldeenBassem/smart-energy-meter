"""
Match detected power-step edges to the household's registered appliances.

An edge on its own only says "something drawing about 1500 W turned on" — it
does not say which appliance. This module resolves that by comparing the
edge's magnitude against every appliance's `rated_power_w` within a tolerance
band, tracking each appliance's current ON/OFF state so a RISE can only match
an appliance believed to be OFF (and a FALL only one believed to be ON).

HONESTY OVER CONFIDENCE
========================================
When more than one appliance's rated wattage falls inside the tolerance band
for the same edge, this returns `matched_appliance_id=None` and lists every
candidate in `candidate_ids`, rather than silently picking the closest one.
Two appliances of similar wattage (e.g. a 1500 W kettle and a 1500 W space
heater) are genuinely indistinguishable to an edge-detection method with no
per-appliance signature training — claiming certainty there would be the
exact kind of overclaim this project has been careful to avoid everywhere
else (see PROJECT_MEMORY.md's NILM entries).
"""
from dataclasses import dataclass, field
from datetime import datetime
from uuid import UUID

from app.services.nilm.detector import Edge, EdgeDirection

DEFAULT_TOLERANCE_PCT = 0.15  # +/- 15% of rated_power_w counts as a match


@dataclass(frozen=True)
class ApplianceSignature:
    appliance_id: UUID
    name: str
    rated_power_w: float


@dataclass
class MatchedEvent:
    ts: datetime
    direction: EdgeDirection
    delta_w: float
    matched_appliance_id: UUID | None
    matched_appliance_name: str | None
    confidence: float          # 0..1 — see _confidence()
    candidate_ids: list[UUID] = field(default_factory=list)


def _confidence(delta_w: float, rated_power_w: float, tolerance_pct: float) -> float:
    """
    1.0 at a perfect match, decaying linearly to 0.0 at the edge of the
    tolerance band. This is a simple, auditable function on purpose — a
    black-box confidence score would be exactly as unverifiable as the thing
    this whole module exists to avoid.
    """
    rel_error = abs(delta_w - rated_power_w) / rated_power_w
    return max(0.0, 1.0 - (rel_error / tolerance_pct))


def match_edges(
    edges: list[Edge],
    appliances: list[ApplianceSignature],
    tolerance_pct: float = DEFAULT_TOLERANCE_PCT,
) -> list[MatchedEvent]:
    """
    `appliances` should be every appliance registered for the household.
    State (which appliances are currently believed ON) is tracked internally
    across the whole `edges` list, so pass edges for one device in
    chronological order — the same ordering contract detector.detect_edges
    already requires of its input.
    """
    on_state: dict[UUID, bool] = {a.appliance_id: False for a in appliances}
    events: list[MatchedEvent] = []

    for edge in edges:
        # A RISE can only be an appliance turning ON (so it must currently be
        # OFF); a FALL can only be one turning OFF (must currently be ON).
        # This halves the candidate pool and is what prevents, e.g., a
        # fridge's compressor cycling ON from being matched against itself
        # cycling OFF five minutes earlier.
        pool = [
            a
            for a in appliances
            if on_state[a.appliance_id] == (edge.direction == EdgeDirection.FALL)
        ]

        candidates = [
            a
            for a in pool
            if abs(edge.delta_w - a.rated_power_w) / a.rated_power_w <= tolerance_pct
        ]

        if len(candidates) == 1:
            matched = candidates[0]
            on_state[matched.appliance_id] = edge.direction == EdgeDirection.RISE
            events.append(
                MatchedEvent(
                    ts=edge.ts,
                    direction=edge.direction,
                    delta_w=edge.delta_w,
                    matched_appliance_id=matched.appliance_id,
                    matched_appliance_name=matched.name,
                    confidence=_confidence(edge.delta_w, matched.rated_power_w, tolerance_pct),
                    candidate_ids=[matched.appliance_id],
                )
            )
        elif len(candidates) > 1:
            # Ambiguous — do not guess. State is intentionally left
            # unchanged for every candidate, since we do not know which one
            # (if any) actually switched.
            events.append(
                MatchedEvent(
                    ts=edge.ts,
                    direction=edge.direction,
                    delta_w=edge.delta_w,
                    matched_appliance_id=None,
                    matched_appliance_name=None,
                    confidence=0.0,
                    candidate_ids=[a.appliance_id for a in candidates],
                )
            )
        else:
            # No registered appliance explains this edge at all — some
            # unregistered load (or vampire/standby drift) changed. Reported,
            # not discarded, so the household can see what the plan is
            # missing rather than have it silently vanish.
            events.append(
                MatchedEvent(
                    ts=edge.ts,
                    direction=edge.direction,
                    delta_w=edge.delta_w,
                    matched_appliance_id=None,
                    matched_appliance_name=None,
                    confidence=0.0,
                    candidate_ids=[],
                )
            )

    return events
