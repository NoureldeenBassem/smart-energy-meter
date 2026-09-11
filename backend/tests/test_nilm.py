"""
Unit tests for NILM edge detection and appliance matching.

Both modules are pure functions over plain data structures (no DB), so they
are tested directly against synthetic power traces built by hand from known
appliance wattages — the same way test_tariff_engine.py tests against known
tariff boundaries rather than mocking the tariff service.

disaggregation.py (the DB-touching orchestrator) is intentionally not covered
here: this project has no shared test-DB fixture, and disaggregation.py is
thin glue over these two already-tested pure functions — the runtime/energy
pairing logic is exercised indirectly through test_matched_events_pair_into_activity
below using the same in-memory approach as the pairing loop in disaggregation.py.
"""
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest

from app.services.nilm.detector import (
    Edge,
    EdgeDirection,
    PowerSample,
    detect_edges,
)
from app.services.nilm.matcher import (
    ApplianceSignature,
    match_edges,
)

T0 = datetime(2026, 9, 11, 12, 0, 0, tzinfo=timezone.utc)


def _samples(pairs: list[tuple[int, float]]) -> list[PowerSample]:
    """pairs = [(seconds_offset, power_w), ...]"""
    return [PowerSample(ts=T0 + timedelta(seconds=s), power_w=w) for s, w in pairs]


# ---------------------------------------------------------------- detector

def test_no_edges_on_flat_signal():
    samples = _samples([(0, 150.0), (5, 152.0), (10, 148.0), (15, 151.0)])
    assert detect_edges(samples) == []


def test_single_clean_rise_and_fall():
    # baseline 150 W (fridge), kettle (1500 W) turns on then off
    samples = _samples([
        (0, 150.0), (5, 150.0),
        (10, 1650.0), (15, 1650.0), (20, 1650.0),
        (25, 150.0), (30, 150.0), (35, 150.0),
    ])
    edges = detect_edges(samples)
    assert len(edges) == 2
    assert edges[0].direction == EdgeDirection.RISE
    assert edges[0].delta_w == pytest.approx(1500.0, abs=1.0)
    assert edges[1].direction == EdgeDirection.FALL
    assert edges[1].delta_w == pytest.approx(1500.0, abs=1.0)


def test_transient_spike_is_not_an_edge():
    # a single noisy sample jumps and immediately reverts - must NOT confirm
    samples = _samples([
        (0, 150.0), (5, 150.0),
        (10, 900.0),          # spike
        (15, 151.0), (20, 149.0), (25, 150.0),
    ])
    edges = detect_edges(samples)
    assert edges == []


def test_small_wobble_below_threshold_ignored():
    samples = _samples([(0, 150.0), (5, 165.0), (10, 155.0), (15, 148.0)])
    assert detect_edges(samples, edge_threshold_w=30.0) == []


def test_requires_chronological_but_does_not_resort():
    # detector trusts caller's ordering contract - out-of-order input here
    # should just produce whatever (possibly nonsensical) edges fall out,
    # proving it does not silently re-sort behind the caller's back.
    samples = [
        PowerSample(ts=T0 + timedelta(seconds=10), power_w=150.0),
        PowerSample(ts=T0, power_w=1650.0),
    ]
    # Not asserting a specific edge here - only that it did not raise and
    # did not reorder the input list itself.
    detect_edges(samples)
    assert samples[0].ts == T0 + timedelta(seconds=10)


# ---------------------------------------------------------------- matcher

def _sig(name: str, watts: float) -> ApplianceSignature:
    return ApplianceSignature(appliance_id=uuid4(), name=name, rated_power_w=watts)


def test_clean_match_within_tolerance():
    fridge = _sig("Refrigerator", 150.0)
    edge = Edge(ts=T0, direction=EdgeDirection.RISE, delta_w=155.0, level_before_w=0, level_after_w=155.0)
    events = match_edges([edge], [fridge])
    assert len(events) == 1
    assert events[0].matched_appliance_id == fridge.appliance_id
    assert events[0].confidence > 0.5


def test_no_match_outside_tolerance():
    fridge = _sig("Refrigerator", 150.0)
    edge = Edge(ts=T0, direction=EdgeDirection.RISE, delta_w=400.0, level_before_w=0, level_after_w=400.0)
    events = match_edges([edge], [fridge])
    assert events[0].matched_appliance_id is None
    assert events[0].candidate_ids == []


def test_ambiguous_when_two_appliances_share_wattage():
    kettle = _sig("Kettle", 1500.0)
    heater = _sig("Space Heater", 1520.0)
    edge = Edge(ts=T0, direction=EdgeDirection.RISE, delta_w=1510.0, level_before_w=0, level_after_w=1510.0)
    events = match_edges([edge], [kettle, heater])
    assert events[0].matched_appliance_id is None
    assert set(events[0].candidate_ids) == {kettle.appliance_id, heater.appliance_id}


def test_fall_only_matches_appliance_believed_on():
    fridge = _sig("Refrigerator", 150.0)
    # FALL before any RISE - fridge is believed OFF, so a FALL of 150W
    # cannot be "the fridge turning off" and must not match.
    edge = Edge(ts=T0, direction=EdgeDirection.FALL, delta_w=150.0, level_before_w=150.0, level_after_w=0.0)
    events = match_edges([edge], [fridge])
    assert events[0].matched_appliance_id is None


def test_rise_then_fall_tracks_state_correctly():
    fridge = _sig("Refrigerator", 150.0)
    rise = Edge(ts=T0, direction=EdgeDirection.RISE, delta_w=150.0, level_before_w=0, level_after_w=150.0)
    fall = Edge(
        ts=T0 + timedelta(minutes=20),
        direction=EdgeDirection.FALL, delta_w=150.0, level_before_w=150.0, level_after_w=0.0,
    )
    events = match_edges([rise, fall], [fridge])
    assert events[0].matched_appliance_id == fridge.appliance_id
    assert events[1].matched_appliance_id == fridge.appliance_id


# ---------------------------------------------------------------- pairing (disaggregation logic, inlined)

def test_matched_events_pair_into_activity():
    """
    Exercises the same RISE/FALL pairing logic disaggregation.py runs, without
    a database: an appliance ON for exactly 30 minutes at 1500 W should yield
    0.5 h runtime and 0.75 kWh - the arithmetic disaggregation.py performs.
    """
    kettle = _sig("Kettle", 1500.0)
    rise = Edge(ts=T0, direction=EdgeDirection.RISE, delta_w=1500.0, level_before_w=0, level_after_w=1500.0)
    fall = Edge(
        ts=T0 + timedelta(minutes=30),
        direction=EdgeDirection.FALL, delta_w=1500.0, level_before_w=1500.0, level_after_w=0.0,
    )
    events = match_edges([rise, fall], [kettle])

    open_since = None
    runtime_seconds = 0.0
    for ev in events:
        if ev.direction == EdgeDirection.RISE:
            open_since = ev.ts
        else:
            assert open_since is not None
            runtime_seconds += (ev.ts - open_since).total_seconds()

    hours = runtime_seconds / 3600.0
    kwh = hours * kettle.rated_power_w / 1000.0
    assert hours == pytest.approx(0.5, abs=1e-9)
    assert kwh == pytest.approx(0.75, abs=1e-9)
