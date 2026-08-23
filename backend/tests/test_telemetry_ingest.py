"""
Unit tests for the telemetry data contract.

These cover the pure validation and timestamp-parsing functions in
app/services/telemetry/ingest.py — no database needed. The DB-dependent
behaviour (duplicate suppression, last_seen_at) is exercised end-to-end against
a running API by tools/check_telemetry_contract.py.

The contract is the foundation everything else reads: a bad reading stored here
silently corrupts the hourly rollups, the daily series, the forecast and the
bill. So each rule gets an explicit test rather than being assumed.
"""

from datetime import datetime, timezone

import pytest

from app.services.telemetry.ingest import (
    TelemetryValidationError,
    parse_timestamp,
    validate_payload,
)


def valid_payload(**overrides):
    payload = {
        "device_id": "esp32_meter_01",
        "timestamp": "2026-08-22T10:00:00Z",
        "voltage_rms": 223.4,
        "current_rms": 2.15,
        "power_w": 462.0,
        "energy_wh_delta": 38.5,
        "power_factor": 0.96,
        "is_backfilled": False,
    }
    payload.update(overrides)
    return payload


# --------------------------------------------------------------------------
# Accept path
# --------------------------------------------------------------------------

def test_valid_payload_passes_through_cleanly():
    clean = validate_payload(valid_payload())
    assert clean["external_id"] == "esp32_meter_01"
    assert clean["energy_wh_delta"] == 38.5
    assert clean["power_factor"] == 0.96
    assert clean["is_backfilled"] is False


def test_optional_electrical_fields_may_be_absent():
    """
    Only device_id and energy_wh_delta are structurally required. A reading that
    carries energy but not instantaneous power is still useful for the bill, so
    it must not be rejected.
    """
    clean = validate_payload({"device_id": "d1", "energy_wh_delta": 12.0})
    assert clean["voltage_rms"] is None
    assert clean["power_w"] is None
    assert clean["energy_wh_delta"] == 12.0


def test_numeric_strings_are_coerced():
    """JSON from embedded firmware sometimes quotes numbers."""
    clean = validate_payload(valid_payload(energy_wh_delta="38.5", power_w="462"))
    assert clean["energy_wh_delta"] == 38.5
    assert clean["power_w"] == 462.0


def test_zero_energy_delta_is_valid():
    """An idle interval consumed nothing. That is a real reading, not an error."""
    assert validate_payload(valid_payload(energy_wh_delta=0.0))["energy_wh_delta"] == 0.0


# --------------------------------------------------------------------------
# energy_wh_delta — the most important field in the contract
# --------------------------------------------------------------------------

def test_negative_energy_delta_is_rejected():
    """
    A negative delta means the firmware sent a cumulative counter that rolled
    over on reboot, or subtracted wrongly. Storing it would credit the household
    for energy it never returned to the grid and would make the bill too low.
    """
    with pytest.raises(TelemetryValidationError, match="must be >= 0"):
        validate_payload(valid_payload(energy_wh_delta=-5.0))


def test_absurd_energy_delta_is_rejected():
    with pytest.raises(TelemetryValidationError, match="sanity limit"):
        validate_payload(valid_payload(energy_wh_delta=99_999.0))


def test_missing_energy_delta_is_rejected():
    with pytest.raises(TelemetryValidationError, match="required"):
        validate_payload({"device_id": "d1"})


def test_non_numeric_energy_delta_is_rejected():
    with pytest.raises(TelemetryValidationError, match="must be a number"):
        validate_payload(valid_payload(energy_wh_delta="not-a-number"))


def test_nan_and_infinity_are_rejected():
    """
    float("nan") parses fine but poisons every downstream SUM into NaN, which is
    far worse than a rejected packet.
    """
    for bad in (float("nan"), float("inf"), float("-inf")):
        with pytest.raises(TelemetryValidationError):
            validate_payload(valid_payload(energy_wh_delta=bad))


# --------------------------------------------------------------------------
# Identity and remaining fields
# --------------------------------------------------------------------------

def test_missing_or_blank_device_id_is_rejected():
    for bad in (None, "", "   "):
        with pytest.raises(TelemetryValidationError, match="device_id"):
            validate_payload(valid_payload(device_id=bad))


def test_device_id_is_stripped():
    assert validate_payload(valid_payload(device_id="  esp32_meter_01 "))["external_id"] == "esp32_meter_01"


@pytest.mark.parametrize("field,value", [
    ("voltage_rms", 9999.0),
    ("current_rms", 5000.0),
    ("power_w", 999_999.0),
])
def test_out_of_range_electrical_values_are_rejected(field, value):
    with pytest.raises(TelemetryValidationError, match="sanity limit"):
        validate_payload(valid_payload(**{field: value}))


@pytest.mark.parametrize("field", ["voltage_rms", "current_rms", "power_w"])
def test_negative_electrical_values_are_rejected(field):
    with pytest.raises(TelemetryValidationError, match="must be >= 0"):
        validate_payload(valid_payload(**{field: -1.0}))


@pytest.mark.parametrize("pf", [-0.1, 1.7])
def test_power_factor_outside_zero_to_one_is_rejected(pf):
    with pytest.raises(TelemetryValidationError, match="power_factor"):
        validate_payload(valid_payload(power_factor=pf))


@pytest.mark.parametrize("pf", [0.0, 0.5, 1.0])
def test_power_factor_boundaries_are_accepted(pf):
    assert validate_payload(valid_payload(power_factor=pf))["power_factor"] == pf


def test_non_boolean_is_backfilled_is_rejected():
    """
    A truthy string like "false" would be stored as True and permanently
    mislabel simulated data as live.
    """
    with pytest.raises(TelemetryValidationError, match="is_backfilled"):
        validate_payload(valid_payload(is_backfilled="false"))


def test_payload_must_be_an_object():
    with pytest.raises(TelemetryValidationError, match="JSON object"):
        validate_payload([1, 2, 3])


# --------------------------------------------------------------------------
# Timestamps — the device's clock is authoritative, not arrival time
# --------------------------------------------------------------------------

def test_iso_timestamp_with_z_suffix_parses_as_utc():
    dt, err = parse_timestamp("2026-08-22T10:00:00Z")
    assert err is None
    assert dt == datetime(2026, 8, 22, 10, 0, tzinfo=timezone.utc)


def test_timestamp_with_offset_is_converted_to_utc():
    """A Cairo-local timestamp (UTC+3 in August) must land on 07:00 UTC."""
    dt, err = parse_timestamp("2026-08-22T10:00:00+03:00")
    assert err is None
    assert dt == datetime(2026, 8, 22, 7, 0, tzinfo=timezone.utc)


def test_naive_timestamp_is_assumed_utc():
    """
    ESP32 firmware syncing via SNTP works in UTC. Guessing a local zone for a
    naive timestamp would shift every reading by hours.
    """
    dt, err = parse_timestamp("2026-08-22T10:00:00")
    assert err is None
    assert dt == datetime(2026, 8, 22, 10, 0, tzinfo=timezone.utc)


def test_datetime_object_passes_through():
    """FastAPI/Pydantic hands the ingest service a real datetime, not a string."""
    given = datetime(2026, 8, 22, 10, 0, tzinfo=timezone.utc)
    dt, err = parse_timestamp(given)
    assert err is None and dt == given


def test_missing_timestamp_reports_a_reason_rather_than_guessing():
    dt, err = parse_timestamp(None)
    assert dt is None
    assert "no timestamp" in err


def test_unparseable_timestamp_reports_a_reason():
    dt, err = parse_timestamp("not-a-date")
    assert dt is None
    assert "unparseable" in err
