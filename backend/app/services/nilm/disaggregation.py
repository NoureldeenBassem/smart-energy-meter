"""
Orchestrates NILM end to end: telemetry_raw -> edges -> matched events ->
per-appliance runtime and energy for a time window.

This is the only module in app/services/nilm that touches the database — the
detector and matcher are both pure functions over plain data structures
(testable with synthetic power traces, no DB needed; see tests/test_nilm.py).
"""
from dataclasses import dataclass
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.models import Appliance, TelemetryRaw
from app.services.nilm.detector import PowerSample, detect_edges
from app.services.nilm.matcher import ApplianceSignature, MatchedEvent, match_edges


@dataclass
class ApplianceActivity:
    appliance_id: UUID
    name: str
    is_essential: bool
    on_events: int
    estimated_runtime_hours: float
    estimated_energy_kwh: float


@dataclass
class DisaggregationResult:
    window_start: datetime
    window_end: datetime
    sample_count: int
    events: list[MatchedEvent]
    unmatched_event_count: int
    ambiguous_event_count: int
    per_appliance: list[ApplianceActivity]


def _load_samples(db: Session, device_id: UUID, window_start: datetime, window_end: datetime) -> list[PowerSample]:
    rows = db.execute(
        select(TelemetryRaw.ts, TelemetryRaw.power_w)
        .where(
            TelemetryRaw.device_id == device_id,
            TelemetryRaw.ts >= window_start,
            TelemetryRaw.ts <= window_end,
            TelemetryRaw.power_w.is_not(None),
        )
        .order_by(TelemetryRaw.ts.asc())
    ).all()
    return [PowerSample(ts=r.ts, power_w=r.power_w) for r in rows]


def _load_appliance_signatures(db: Session, user_id: UUID) -> tuple[list[ApplianceSignature], dict[UUID, Appliance]]:
    appliances = db.execute(
        select(Appliance).where(Appliance.user_id == user_id)
    ).scalars().all()
    signatures = [
        ApplianceSignature(appliance_id=a.appliance_id, name=a.name, rated_power_w=a.rated_power_w)
        for a in appliances
    ]
    by_id = {a.appliance_id: a for a in appliances}
    return signatures, by_id


def disaggregate(
    db: Session,
    device_id: UUID,
    user_id: UUID,
    window_start: datetime,
    window_end: datetime,
) -> DisaggregationResult:
    """
    Run NILM over one device's telemetry for [window_start, window_end].

    Runtime/energy accounting: for each appliance, pair its RISE events with
    the next FALL event matched to the SAME appliance to get a runtime
    interval. An appliance still ON at window_end (a RISE with no matching
    FALL yet — the fridge is the common case) is closed out at window_end,
    not silently dropped, so a query ending mid-cycle still reports the
    partial runtime honestly rather than reporting zero.
    """
    samples = _load_samples(db, device_id, window_start, window_end)
    edges = detect_edges(samples)
    signatures, appliances_by_id = _load_appliance_signatures(db, user_id)
    events = match_edges(edges, signatures)

    # open_since[appliance_id] = ts of the RISE event currently believed
    # still active for that appliance (None if OFF).
    open_since: dict[UUID, datetime] = {}
    on_event_counts: dict[UUID, int] = {}
    runtime_seconds: dict[UUID, float] = {a.appliance_id: 0.0 for a in signatures}

    for ev in events:
        if ev.matched_appliance_id is None:
            continue
        aid = ev.matched_appliance_id
        if ev.direction.value == "rise":
            open_since[aid] = ev.ts
            on_event_counts[aid] = on_event_counts.get(aid, 0) + 1
        else:  # fall
            started = open_since.pop(aid, None)
            if started is not None:
                runtime_seconds[aid] += (ev.ts - started).total_seconds()

    # Close out anything still ON at the end of the window.
    for aid, started in open_since.items():
        runtime_seconds[aid] += (window_end - started).total_seconds()

    per_appliance: list[ApplianceActivity] = []
    for sig in signatures:
        appliance = appliances_by_id[sig.appliance_id]
        hours = runtime_seconds.get(sig.appliance_id, 0.0) / 3600.0
        per_appliance.append(
            ApplianceActivity(
                appliance_id=sig.appliance_id,
                name=sig.name,
                is_essential=appliance.is_essential,
                on_events=on_event_counts.get(sig.appliance_id, 0),
                estimated_runtime_hours=round(hours, 3),
                estimated_energy_kwh=round(hours * sig.rated_power_w / 1000.0, 4),
            )
        )

    unmatched = sum(1 for e in events if e.matched_appliance_id is None and not e.candidate_ids)
    ambiguous = sum(1 for e in events if e.matched_appliance_id is None and e.candidate_ids)

    return DisaggregationResult(
        window_start=window_start,
        window_end=window_end,
        sample_count=len(samples),
        events=events,
        unmatched_event_count=unmatched,
        ambiguous_event_count=ambiguous,
        per_appliance=per_appliance,
    )
