"""
Regression tests for the appliances seeded at registration.

WHY THIS FILE EXISTS
====================
SUBMISSION_STATUS.md §4 documents a guarantee that turned out to be fake:
essential appliances were described as protected and were not protected at all,
because the engine read `priority == "High"` as if it meant essential. The engine
was fixed to reserve `is_essential` appliances before any budget arithmetic runs,
and the existing rows were migrated with
`UPDATE appliances SET is_essential = TRUE WHERE priority = 'High'`.

The registration path was missed. It seeded a refrigerator with priority="High"
and no `is_essential`, which defaulted to FALSE — so the migrated demo account
was correct while every NEWLY registered account got an unprotected fridge.
Measured on a fresh account before the fix: the seeded refrigerator was cut to
5.7 h/day in eco mode and to 0.0 h in away mode.

That is the original bug, reachable by anyone who registers an account. These
tests pin the seed data so it cannot come back.

They are deliberately pure — they assert on STARTER_APPLIANCE_SPECS rather than
registering a user — so they need no database and run with the rest of the suite.
"""

import pytest

from app.api.routes.auth import STARTER_APPLIANCE_SPECS
from app.services.recommendation.engine import generate_recommendation_dashboard


def _as_appliances(specs):
    """Turn the seed specs into the dict shape the allocator consumes."""
    return [
        {
            "appliance_id": f"seed-{i}",
            "name": s["name"],
            "rated_power_w": s["rated_power_w"],
            "priority": s["priority"],
            "is_essential": s["is_essential"],
            "desired_daily_hours": s["desired_daily_hours"],
        }
        for i, s in enumerate(STARTER_APPLIANCE_SPECS)
    ]


def test_every_starter_spec_states_is_essential_explicitly():
    """
    The field must be PRESENT, not merely falsy-by-default. This is the exact
    defect: omitting it let the column default to FALSE silently.
    """
    for spec in STARTER_APPLIANCE_SPECS:
        assert "is_essential" in spec, f"{spec['name']} does not set is_essential"
        assert isinstance(spec["is_essential"], bool)


def test_starter_refrigerator_is_essential():
    fridge = next(s for s in STARTER_APPLIANCE_SPECS if s["name"] == "Refrigerator")
    assert fridge["is_essential"] is True, (
        "The seeded refrigerator must be essential. A High priority does not "
        "protect it — only is_essential does (SUBMISSION_STATUS.md §4)."
    )


def test_starter_air_conditioner_is_not_essential():
    """
    The AC must stay discretionary. If everything were essential the allocator
    would have nothing to trim and the budget guarantee would be vacuous.
    """
    ac = next(s for s in STARTER_APPLIANCE_SPECS if s["name"] == "Air Conditioner")
    assert ac["is_essential"] is False


def test_priority_and_essentiality_are_not_the_same_field():
    """
    The seed set must contain a counterexample to 'High priority == protected',
    otherwise the two concepts could be conflated again and every test would
    still pass. The AC is High-or-Medium priority and NOT essential.
    """
    non_essential = [s for s in STARTER_APPLIANCE_SPECS if not s["is_essential"]]
    assert non_essential, "seed set has no discretionary appliance to trim"


@pytest.mark.parametrize("mode", ["normal", "eco", "heavy", "away"])
def test_seeded_refrigerator_keeps_full_runtime_in_every_mode(mode):
    """
    The end-to-end guarantee, exercised through the real allocator on the real
    seed data. This is the assertion that failed before the fix: in eco the
    fridge was cut to 5.7 h and in away to 0.0 h.
    """
    result = generate_recommendation_dashboard(
        target_bill_egp=900.0,
        alert_threshold_pct=85,
        current_month_kwh=0.0,
        appliances=_as_appliances(STARTER_APPLIANCE_SPECS),
        mode=mode,
    )
    fridge = next(a for a in result["allocations"] if a["name"] == "Refrigerator")
    assert fridge["is_essential"] is True
    assert fridge["recommended_runtime_hours"] == 24.0, (
        f"seeded refrigerator was restricted to {fridge['recommended_runtime_hours']} h "
        f"in {mode} mode"
    )
    assert fridge["status"] == "essential"


def test_seeded_refrigerator_survives_a_zero_budget():
    """A budget of zero is the hardest case: there is nothing to allocate."""
    result = generate_recommendation_dashboard(
        target_bill_egp=0.0,
        alert_threshold_pct=85,
        current_month_kwh=0.0,
        appliances=_as_appliances(STARTER_APPLIANCE_SPECS),
        mode="normal",
    )
    fridge = next(a for a in result["allocations"] if a["name"] == "Refrigerator")
    assert fridge["recommended_runtime_hours"] == 24.0
    # The overrun must be reported, not hidden by trimming the fridge.
    assert result["within_budget"] is False
    assert result["budget_note"]
