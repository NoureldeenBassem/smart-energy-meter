"""
Recommendation engine tests.

The guarantees under test are the ones the project claims out loud:

  * an essential appliance always receives its full desired runtime — in every
    mode, at every budget, including a budget of zero;
  * the plan never spends more than the allowance it was given;
  * no runtime is ever negative;
  * when the two requirements collide (essentials alone cost more than the budget),
    the collision is REPORTED rather than resolved by quietly trimming the fridge.

The over-budget / under-budget / exact-fit scenarios are carried over from the
earlier greedy.py test file, rewritten against the current engine. Those tests
expressed essentiality through `priority="essential"`, which is precisely the
conflation that made the guarantee fake; here the two concepts are separate
fields and both are exercised.

DETERMINISM
-----------
`_days_remaining_in_cycle()` reads today's Cairo date, so any test that asserts a
specific kWh figure patches it. Tests that only assert a guarantee ("essentials are
whole", "nothing negative") are written to hold on any date and do not patch.
"""

import pytest

from app.services.recommendation import engine
from app.services.recommendation.engine import (
    check_budget_alert,
    generate_recommendation_dashboard,
)
from app.services.tariff_engine.calculator import bill_to_kwh

# --------------------------------------------------------------------------
# Fixtures. Deliberately chosen so that essentiality and priority disagree:
#   * PUMP is essential but LOW priority   -> protection is not priority
#   * AC is HIGH priority but not essential -> priority is not protection
# --------------------------------------------------------------------------

FRIDGE = {"appliance_id": "fridge-1", "name": "Fridge", "rated_power_w": 150,
          "priority": "High", "is_essential": True, "desired_daily_hours": 24}
PUMP = {"appliance_id": "pump-1", "name": "Water Pump", "rated_power_w": 400,
        "priority": "Low", "is_essential": True, "desired_daily_hours": 1}
AC = {"appliance_id": "ac-1", "name": "AC", "rated_power_w": 1800,
      "priority": "High", "is_essential": False, "desired_daily_hours": 6}
WASHER = {"appliance_id": "washer-1", "name": "Washing Machine", "rated_power_w": 500,
          "priority": "Low", "is_essential": False, "desired_daily_hours": 2}

APPLIANCES = [FRIDGE, PUMP, AC, WASHER]

ESSENTIAL_KWH = 0.150 * 24 + 0.400 * 1        # 3.6 + 0.4 = 4.0
NON_ESSENTIAL_KWH = 1.800 * 6 + 0.500 * 2     # 10.8 + 1.0 = 11.8
FULL_DEMAND_KWH = ESSENTIAL_KWH + NON_ESSENTIAL_KWH   # 15.8

ALL_MODES = ["normal", "eco", "heavy", "away"]

# bill_to_kwh(1000) is ~600 kWh, comfortably above every figure used below, so
# `current_month_kwh` can be used to dial the remaining budget to an exact value.
ALLOWED_AT_1000_EGP = bill_to_kwh(1000)


def plan(daily_kwh, appliances=APPLIANCES, mode="normal", days=1, monkeypatch=None):
    """
    Build a plan whose per-day budget share is exactly `daily_kwh`.

    Works by spending `ALLOWED_AT_1000_EGP - daily_kwh * days` of a 1000 EGP budget,
    which leaves `daily_kwh * days` remaining over `days` days. Patching the day
    count is what makes the arithmetic exact regardless of when the suite runs.
    """
    monkeypatch.setattr(engine, "_days_remaining_in_cycle", lambda: days)
    return generate_recommendation_dashboard(
        target_bill_egp=1000,
        alert_threshold_pct=85,
        current_month_kwh=ALLOWED_AT_1000_EGP - daily_kwh * days,
        appliances=appliances,
        mode=mode,
    )


def by_id(result):
    return {a["appliance_id"]: a for a in result["allocations"]}


def recomputed_kwh(result):
    """Total kWh implied by the returned rows, independent of the engine's own sum."""
    return sum(a["rated_power_w"] / 1000.0 * a["recommended_runtime_hours"]
               for a in result["allocations"])


# --------------------------------------------------------------------------
# THE CORE GUARANTEE: essentials are untouchable.
#
# This is the test that would have caught the original bug. Away mode used a 0.0
# multiplier, so the allowance was zero and the fridge came back with
# 0.0 h / "shed" / "Avoid running today if possible".
# --------------------------------------------------------------------------

@pytest.mark.parametrize("mode", ALL_MODES)
@pytest.mark.parametrize("target_bill", [0, 1, 40, 500, 100_000])
def test_essentials_always_get_full_runtime(mode, target_bill):
    result = generate_recommendation_dashboard(
        target_bill_egp=target_bill, alert_threshold_pct=85,
        current_month_kwh=0, appliances=APPLIANCES, mode=mode,
    )
    rows = by_id(result)

    assert rows["fridge-1"]["recommended_runtime_hours"] == 24
    assert rows["pump-1"]["recommended_runtime_hours"] == 1
    for essential in ("fridge-1", "pump-1"):
        assert rows[essential]["status"] == "essential"
        assert rows[essential]["is_essential"] is True


@pytest.mark.parametrize("mode", ALL_MODES)
def test_essentials_survive_a_budget_already_blown(mode):
    """current_month_kwh far past the budget: remaining is clamped to 0, not negative."""
    result = generate_recommendation_dashboard(
        target_bill_egp=100, alert_threshold_pct=85,
        current_month_kwh=99_999, appliances=APPLIANCES, mode=mode,
    )
    rows = by_id(result)
    assert rows["fridge-1"]["recommended_runtime_hours"] == 24
    assert rows["pump-1"]["recommended_runtime_hours"] == 1
    assert result["budget_daily_kwh"] == 0.0


def test_away_mode_sheds_discretionary_load_but_not_essentials():
    result = generate_recommendation_dashboard(
        target_bill_egp=500, alert_threshold_pct=85,
        current_month_kwh=0, appliances=APPLIANCES, mode="away",
    )
    rows = by_id(result)

    # The fridge keeps running while the house is empty — that is the whole point.
    assert rows["fridge-1"]["status"] == "essential"
    assert rows["fridge-1"]["recommended_runtime_hours"] == 24
    assert rows["pump-1"]["recommended_runtime_hours"] == 1

    for discretionary in ("ac-1", "washer-1"):
        assert rows[discretionary]["status"] == "away"
        assert rows[discretionary]["recommended_runtime_hours"] == 0.0

    assert result["discretionary_kwh_allowance"] == 0.0


def test_priority_does_not_confer_protection(monkeypatch):
    """
    AC is High priority but NOT essential, so a tight budget must still trim it —
    while PUMP, which is Low priority but essential, is untouched. This is the
    distinction the old engine could not express.
    """
    result = plan(daily_kwh=ESSENTIAL_KWH + 1.0, monkeypatch=monkeypatch)
    rows = by_id(result)

    assert rows["ac-1"]["priority"] == "High"
    assert rows["ac-1"]["recommended_runtime_hours"] < AC["desired_daily_hours"]
    assert rows["pump-1"]["priority"] == "Low"
    assert rows["pump-1"]["recommended_runtime_hours"] == 1


# --------------------------------------------------------------------------
# Carried over: exact fit, over budget, under budget.
# --------------------------------------------------------------------------

def test_exact_fit_everything_requested_is_granted(monkeypatch):
    """Budget equal to total demand: every appliance runs its full desired hours."""
    result = plan(daily_kwh=FULL_DEMAND_KWH, monkeypatch=monkeypatch)
    rows = by_id(result)

    assert rows["fridge-1"]["status"] == "essential"
    assert rows["ac-1"]["status"] == "optimal"
    assert rows["ac-1"]["recommended_runtime_hours"] == 6
    assert rows["washer-1"]["status"] == "optimal"
    assert rows["washer-1"]["recommended_runtime_hours"] == 2

    assert result["total_allocated_kwh"] == pytest.approx(FULL_DEMAND_KWH, abs=1e-3)
    assert result["within_budget"] is True
    assert result["budget_note"] is None


def test_exact_fit_essentials_only_sheds_all_discretionary(monkeypatch):
    """
    Budget exactly equal to the essential load. Essentials are whole, the
    discretionary pool is exactly zero, and nothing else runs — the carried-over
    `test_exact_fit_budget` case, which asserted ac == 0 and washer == 0.
    """
    result = plan(daily_kwh=ESSENTIAL_KWH, monkeypatch=monkeypatch)
    rows = by_id(result)

    assert rows["fridge-1"]["recommended_runtime_hours"] == 24
    assert rows["pump-1"]["recommended_runtime_hours"] == 1
    assert rows["ac-1"]["recommended_runtime_hours"] == 0.0
    assert rows["washer-1"]["recommended_runtime_hours"] == 0.0

    assert result["discretionary_kwh_allowance"] == pytest.approx(0.0, abs=1e-3)
    assert result["total_allocated_kwh"] == pytest.approx(ESSENTIAL_KWH, abs=1e-3)
    # Exactly on the line still counts as within budget.
    assert result["within_budget"] is True


def test_over_budget_nothing_goes_negative_and_nothing_crashes():
    """The carried-over zero-budget case. Also the one that must not raise."""
    result = generate_recommendation_dashboard(
        target_bill_egp=0, alert_threshold_pct=85,
        current_month_kwh=0, appliances=APPLIANCES, mode="normal",
    )
    rows = by_id(result)

    assert rows["ac-1"]["recommended_runtime_hours"] == 0.0
    assert rows["washer-1"]["recommended_runtime_hours"] == 0.0
    for row in result["allocations"]:
        assert row["recommended_runtime_hours"] >= 0.0
        assert row["estimated_kwh"] >= 0.0
    assert result["discretionary_kwh_allowance"] >= 0.0
    assert result["budget_daily_kwh"] >= 0.0


def test_over_budget_is_reported_not_concealed():
    """
    Essentials cost 4.0 kWh/day and a 0 EGP budget allows none, so the plan
    genuinely exceeds the budget. The engine must say so.
    """
    result = generate_recommendation_dashboard(
        target_bill_egp=0, alert_threshold_pct=85,
        current_month_kwh=0, appliances=APPLIANCES, mode="normal",
    )
    assert result["within_budget"] is False
    assert result["budget_note"] is not None
    assert "Essential appliances alone" in result["budget_note"]
    # ... and the essentials are still whole. Both facts hold at once.
    assert by_id(result)["fridge-1"]["recommended_runtime_hours"] == 24


def test_under_budget_allocates_every_discretionary_appliance():
    result = generate_recommendation_dashboard(
        target_bill_egp=100_000, alert_threshold_pct=85,
        current_month_kwh=0, appliances=APPLIANCES, mode="normal",
    )
    rows = by_id(result)
    assert rows["ac-1"]["recommended_runtime_hours"] == 6
    assert rows["washer-1"]["recommended_runtime_hours"] == 2
    assert rows["ac-1"]["status"] == "optimal"
    assert rows["washer-1"]["status"] == "optimal"
    assert result["within_budget"] is True


# --------------------------------------------------------------------------
# The budget ceiling.
# --------------------------------------------------------------------------

@pytest.mark.parametrize("mode", ALL_MODES)
@pytest.mark.parametrize("daily_kwh", [0.0, 0.05, 4.0, 4.37, 7.0, 15.8, 40.0])
def test_plan_never_exceeds_its_allowance(mode, daily_kwh, monkeypatch):
    result = plan(daily_kwh=daily_kwh, mode=mode, days=10, monkeypatch=monkeypatch)

    assert result["total_allocated_kwh"] <= result["daily_kwh_allowance"] + 1e-3
    # Recomputed from the rows, so a bug in the engine's own accounting cannot
    # hide behind its own reported total.
    assert recomputed_kwh(result) <= result["daily_kwh_allowance"] + 1e-3


@pytest.mark.parametrize("daily_kwh", [0.0, 1.0, 4.37, 9.99, 40.0])
def test_engine_total_matches_the_rows_it_returned(daily_kwh, monkeypatch):
    result = plan(daily_kwh=daily_kwh, days=10, monkeypatch=monkeypatch)
    assert result["total_allocated_kwh"] == pytest.approx(recomputed_kwh(result), abs=1e-2)


def test_constrained_hours_are_floored_not_rounded(monkeypatch):
    """
    A single 150 W appliance against a 1.0 kWh pool wants 6.667 h. Rounding to
    nearest gives 6.7 h = 1.005 kWh, which breaches the pool it was clamped to.
    Flooring gives 6.6 h = 0.99 kWh.
    """
    lamp = {"appliance_id": "lamp-1", "name": "Lamp", "rated_power_w": 150,
            "priority": "Low", "is_essential": False, "desired_daily_hours": 24}
    result = plan(daily_kwh=1.0, appliances=[lamp], monkeypatch=monkeypatch)

    hours = by_id(result)["lamp-1"]["recommended_runtime_hours"]
    assert hours == 6.6
    assert 0.150 * hours <= 1.0 + 1e-9


# --------------------------------------------------------------------------
# Modes.
# --------------------------------------------------------------------------

def test_eco_allocates_less_discretionary_than_normal(monkeypatch):
    kwargs = dict(daily_kwh=10.0, days=10, monkeypatch=monkeypatch)
    normal = plan(mode="normal", **kwargs)
    eco = plan(mode="eco", **kwargs)
    assert eco["discretionary_kwh_allowance"] < normal["discretionary_kwh_allowance"]
    # Essentials are identical in both — the multiplier never touches them.
    assert eco["essential_kwh"] == normal["essential_kwh"] == pytest.approx(ESSENTIAL_KWH)


def test_heavy_mode_front_loads_and_says_so(monkeypatch):
    heavy = plan(daily_kwh=6.0, mode="heavy", days=10, monkeypatch=monkeypatch)
    normal = plan(daily_kwh=6.0, mode="normal", days=10, monkeypatch=monkeypatch)

    assert heavy["discretionary_kwh_allowance"] > normal["discretionary_kwh_allowance"]
    assert heavy["total_allocated_kwh"] > heavy["budget_daily_kwh"]
    assert heavy["within_budget"] is False
    assert "Heavy mode" in heavy["budget_note"]


def test_heavy_mode_cannot_outspend_the_remaining_cycle(monkeypatch):
    """
    On the last day of a cycle there is nothing left to borrow from, so the 1.3x
    multiplier must not conjure kWh that the household does not have.
    """
    result = plan(daily_kwh=6.0, mode="heavy", days=1, monkeypatch=monkeypatch)
    assert result["total_allocated_kwh"] <= 6.0 + 1e-6


def test_unknown_mode_falls_back_to_normal():
    for bogus in ("turbo", "", "AWAY", None):
        result = generate_recommendation_dashboard(
            target_bill_egp=500, alert_threshold_pct=85,
            current_month_kwh=0, appliances=APPLIANCES, mode=bogus,
        )
        assert result["active_mode"] == "normal"


def test_monotonic_in_budget(monkeypatch):
    """More budget must never mean less runtime for a discretionary appliance."""
    previous = -1.0
    for daily_kwh in [4.0, 5.0, 6.0, 8.0, 12.0, 20.0]:
        result = plan(daily_kwh=daily_kwh, days=10, monkeypatch=monkeypatch)
        hours = by_id(result)["ac-1"]["recommended_runtime_hours"]
        assert hours >= previous
        previous = hours


# --------------------------------------------------------------------------
# Robustness and payload shape.
# --------------------------------------------------------------------------

def test_missing_is_essential_key_defaults_to_not_essential():
    """
    A caller that has not been updated must not have its appliances silently
    promoted to protected status — the default is the unprotected one.
    """
    legacy = {"appliance_id": "legacy-1", "name": "Heater", "rated_power_w": 2000,
              "priority": "High", "desired_daily_hours": 8}
    result = generate_recommendation_dashboard(
        target_bill_egp=1, alert_threshold_pct=85,
        current_month_kwh=0, appliances=[legacy], mode="normal",
    )
    row = by_id(result)["legacy-1"]
    assert row["is_essential"] is False
    assert row["status"] != "essential"


def test_empty_appliance_list_is_a_valid_empty_plan():
    result = generate_recommendation_dashboard(
        target_bill_egp=500, alert_threshold_pct=85,
        current_month_kwh=0, appliances=[], mode="normal",
    )
    assert result["allocations"] == []
    assert result["essential_kwh"] == 0.0
    assert result["total_allocated_kwh"] == 0.0
    assert result["within_budget"] is True


def test_dashboard_carries_the_alert_block():
    """So the frontend banner does not need a second request."""
    result = generate_recommendation_dashboard(
        target_bill_egp=100, alert_threshold_pct=50,
        current_month_kwh=300, appliances=APPLIANCES, mode="normal",
    )
    assert result["alert"]["alert_triggered"] is True
    assert result["alert"]["alert_threshold_pct"] == 50


def test_essentials_are_listed_before_discretionary_appliances():
    """The Recommendations page shows locked rows first without re-sorting."""
    result = generate_recommendation_dashboard(
        target_bill_egp=500, alert_threshold_pct=85,
        current_month_kwh=0, appliances=[WASHER, AC, FRIDGE, PUMP], mode="normal",
    )
    flags = [a["is_essential"] for a in result["allocations"]]
    assert flags == sorted(flags, reverse=True)


# --------------------------------------------------------------------------
# check_budget_alert, unchanged behaviour.
# --------------------------------------------------------------------------

def test_budget_alert_triggers_above_threshold():
    alert = check_budget_alert(
        current_month_kwh=300, target_bill_egp=100, alert_threshold_pct=50
    )
    assert alert["alert_triggered"] is True
    assert alert["message"] is not None


def test_budget_alert_silent_below_threshold():
    alert = check_budget_alert(
        current_month_kwh=1, target_bill_egp=1000, alert_threshold_pct=85
    )
    assert alert["alert_triggered"] is False
    assert alert["message"] is None


def test_budget_alert_handles_zero_budget_without_dividing_by_zero():
    alert = check_budget_alert(
        current_month_kwh=50, target_bill_egp=0, alert_threshold_pct=85
    )
    assert alert["pct_of_budget_used"] == 0.0
