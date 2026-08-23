"""
Daily appliance load recommendation engine.

The single canonical recommendation engine for the project. Output matches
ApplianceAllocation / RecommendationDashboardOut in app/api/schemas.py field for
field.

ESSENTIALS ARE RESERVED, NOT PRIORITISED
========================================
The allocator runs in two stages, and the order matters:

  1. Every appliance marked `is_essential` is granted its FULL desired runtime and
     its cost is subtracted from the day's allowance up front.
  2. Whatever allowance survives that subtraction is handed to the greedy loop,
     which spends it on non-essential appliances in priority order.

Essentials therefore never enter the greedy loop at all, so no budget arithmetic
can reach them. That is the difference between a guarantee and a coincidence.

The previous version had no `is_essential` concept and treated `priority == "High"`
as if it meant essential. It did not protect anything — it only reordered the
greedy loop, so the fridge kept its 24 hours whenever it happened to fit and was
trimmed whenever it did not. Measured on a 150 W fridge wanting 24 h/day:

    away mode          -> 0.0 h, status "shed", "Avoid running today if possible"
    10 EGP/month budget -> 9.8 h, status "constrained"
    0 EGP budget        -> 0.0 h, status "shed"

Away mode was the worst of the three: its multiplier is 0.0, so the allowance was
zero and the fridge — the appliance that most needs to keep running while the house
is empty — was told to switch off.

WHEN "NEVER RESTRICT ESSENTIALS" AND "NEVER EXCEED BUDGET" COLLIDE
=================================================================
These two requirements are not always simultaneously satisfiable. If the essential
appliances alone cost more than the daily allowance, something has to give.

This engine always keeps the essentials whole and reports the overrun instead of
hiding it: `within_budget` goes False and `budget_note` explains why. Silently
trimming the fridge to make a budget number look achievable would be the dishonest
resolution, and quietly reporting "within budget" while the plan overspends would
be worse. An unreachable budget is a fact about the budget, not something the
allocator should paper over.

MODES SCALE ONLY THE DISCRETIONARY POOL
=======================================
The mode multiplier is applied AFTER essentials are reserved, so it scales only
what is left over. This is what makes `away` behave sensibly: multiplier 0.0 sheds
every discretionary load and leaves the essentials running.

`heavy` (1.3) deliberately front-loads — it plans a day that costs more than one
day's even share of the budget, on the understanding that later days get less. It
is still capped at the total kWh actually remaining in the cycle, so no plan can
ever spend more than the household has left. `within_budget` reports False for
heavy whenever it exceeds the even daily share, so the overspend is visible rather
than implied.

ROUNDING IS FLOORED, NOT ROUNDED
================================
Constrained runtimes are floored to 0.1 h. Rounding to nearest would round up
about half the time and push the plan over the allowance it was just clamped to —
a 150 W appliance given 1.0 kWh rounds 6.67 h up to 6.7 h, which costs 1.005 kWh.
Small, but it makes the "never exceeds budget" guarantee untestable.
"""

import math
from typing import Any, Dict, List

from app.core.billing_time import cycle_length_days, today_local
from app.services.tariff_engine.calculator import bill_to_kwh

# Soft ordering among NON-essential appliances only. An essential appliance's
# priority is never consulted — it is already fully reserved.
PRIORITY_WEIGHTS = {"high": 3, "medium": 2, "low": 1}

MODE_MULTIPLIERS = {
    "normal": 1.0,
    "eco": 0.8,
    "heavy": 1.3,   # front-loads within the cycle; capped at kWh actually remaining
    "away": 0.0,    # sheds all discretionary load; essentials keep running
}

VALID_MODES = set(MODE_MULTIPLIERS.keys())

# Float slack for the budget comparisons. Allocation is done in exact floats and
# only rounded for display, so the real error is ~1e-15; 1e-6 is generous.
EPSILON = 1e-6


def _days_remaining_in_cycle() -> int:
    """
    Days left in the billing cycle INCLUDING today.

    Uses the Africa/Cairo local date, not UTC. A UTC date is up to 3 hours behind
    the local one in summer, so on the 1st of a month it would still report the
    previous cycle and divide the budget by the wrong number of days. The same
    helpers back the aggregation rollups and the bill forecast, so all three agree
    on which day it is.
    """
    today = today_local()
    return max(1, cycle_length_days(today) - today.day + 1)


def _split_essentials(appliances: List[Dict[str, Any]]):
    """
    Partition into (essentials, non_essentials) with a stable, meaningful order.

    Essentials come out sorted by power descending so the UI lists the biggest
    protected loads first; non-essentials by priority then power descending, which
    is the order the greedy loop spends the remaining allowance in.

    `is_essential` is read with .get(..., False): a caller that has not been
    updated to supply the field gets the safe default of "not essential" rather
    than a KeyError, and no appliance is silently promoted to protected status.
    """
    essentials = [a for a in appliances if bool(a.get("is_essential", False))]
    non_essentials = [a for a in appliances if not bool(a.get("is_essential", False))]

    essentials.sort(key=lambda a: a["rated_power_w"], reverse=True)
    non_essentials.sort(
        key=lambda a: (
            PRIORITY_WEIGHTS.get(str(a.get("priority", "Medium")).lower(), 1),
            a["rated_power_w"],
        ),
        reverse=True,
    )
    return essentials, non_essentials


def _kwh(appliance: Dict[str, Any], hours: float) -> float:
    return (appliance["rated_power_w"] / 1000.0) * hours


def _allocation_row(appliance, hours, status, note, is_essential):
    return {
        "appliance_id": str(appliance["appliance_id"]),
        "name": appliance["name"],
        "rated_power_w": appliance["rated_power_w"],
        "priority": str(appliance.get("priority", "Medium")),
        "is_essential": is_essential,
        "recommended_runtime_hours": round(hours, 1),
        "estimated_kwh": round(_kwh(appliance, hours), 3),
        "status": status,
        "action_note": note,
    }


def generate_recommendation_dashboard(
    target_bill_egp: float,
    alert_threshold_pct: int,
    current_month_kwh: float,
    appliances: List[Dict[str, Any]],
    mode: str = "normal",
) -> Dict[str, Any]:
    """
    Build the daily load plan.

    appliances: list of dicts with keys matching the Appliance model —
        appliance_id, name, rated_power_w, priority ("High"/"Medium"/"Low"),
        is_essential (bool), desired_daily_hours

    Returns a dict matching RecommendationDashboardOut exactly.

    Guarantees, all covered by tests in tests/test_recommendation_engine.py:
      * every essential appliance receives exactly its desired_daily_hours, in
        every mode, at every budget, including zero;
      * total planned kWh never exceeds `daily_kwh_allowance`;
      * no runtime is ever negative;
      * when the plan does exceed the even daily share of the budget, that is
        reported in `within_budget` / `budget_note` rather than concealed.
    """
    if mode not in VALID_MODES:
        mode = "normal"

    days_remaining = _days_remaining_in_cycle()

    total_allowed_kwh = bill_to_kwh(target_bill_egp)
    remaining_budget_kwh = max(0.0, total_allowed_kwh - current_month_kwh)
    budget_daily_kwh = remaining_budget_kwh / days_remaining

    essentials, non_essentials = _split_essentials(appliances)

    # ---- Stage 1: reserve essentials in full, before any budget arithmetic ----
    allocations = []
    essential_kwh = 0.0
    for appliance in essentials:
        hours = max(0.0, float(appliance["desired_daily_hours"]))
        essential_kwh += _kwh(appliance, hours)
        allocations.append(_allocation_row(
            appliance, hours, "essential",
            f"Essential — runs {round(hours, 1)} hrs/day, never restricted",
            True,
        ))

    # ---- Stage 2: the discretionary pool is whatever survived stage 1 ----
    leftover = max(0.0, budget_daily_kwh - essential_kwh)
    discretionary_pool = leftover * MODE_MULTIPLIERS[mode]

    # heavy mode may plan above the even daily share, but never above the kWh the
    # cycle actually has left after the essentials are paid for.
    discretionary_pool = min(discretionary_pool, max(0.0, remaining_budget_kwh - essential_kwh))

    spent = 0.0
    for appliance in non_essentials:
        power_kw = appliance["rated_power_w"] / 1000.0
        desired_hours = max(0.0, float(appliance["desired_daily_hours"]))

        if mode == "away":
            allocations.append(_allocation_row(
                appliance, 0.0, "away", "Shed — Away Mode active", False,
            ))
            continue

        requested_kwh = power_kw * desired_hours

        if spent + requested_kwh <= discretionary_pool + EPSILON:
            hours, status = desired_hours, "optimal"
            note = f"Run normally for {round(hours, 1)} hrs/day"
        else:
            affordable_kwh = max(0.0, discretionary_pool - spent)
            # Floor, never round: rounding up would breach the allowance.
            hours = math.floor((affordable_kwh / power_kw) * 10) / 10 if power_kw > 0 else 0.0
            hours = min(hours, desired_hours)
            if hours > 0:
                status = "constrained"
                note = f"Limit runtime to {round(hours, 1)} hrs/day to stay within budget"
            else:
                status = "shed"
                note = "Avoid running today if possible"

        spent += power_kw * hours
        allocations.append(_allocation_row(appliance, hours, status, note, False))

    daily_kwh_allowance = essential_kwh + discretionary_pool
    total_allocated_kwh = essential_kwh + spent

    # Reported against the even daily share, which is the actual budget constraint.
    within_budget = total_allocated_kwh <= budget_daily_kwh + EPSILON

    if within_budget:
        budget_note = None
    elif essential_kwh > budget_daily_kwh + EPSILON:
        budget_note = (
            f"Essential appliances alone need {round(essential_kwh, 2)} kWh/day, but the "
            f"budget allows {round(budget_daily_kwh, 2)} kWh/day. Essentials are never "
            f"restricted, so this target bill is not achievable without removing an "
            f"appliance from the essential list or raising the target."
        )
    else:
        budget_note = (
            f"{mode.capitalize()} mode plans {round(total_allocated_kwh, 2)} kWh today "
            f"against a daily share of {round(budget_daily_kwh, 2)} kWh. Later days in "
            f"the cycle get correspondingly less."
        )

    return {
        "active_mode": mode,
        "target_bill_egp": target_bill_egp,
        "days_remaining_in_month": days_remaining,
        "daily_kwh_allowance": round(daily_kwh_allowance, 3),
        "budget_daily_kwh": round(budget_daily_kwh, 3),
        "essential_kwh": round(essential_kwh, 3),
        "discretionary_kwh_allowance": round(discretionary_pool, 3),
        "total_allocated_kwh": round(total_allocated_kwh, 3),
        "within_budget": within_budget,
        "budget_note": budget_note,
        "allocations": allocations,
        "alert": check_budget_alert(
            current_month_kwh=current_month_kwh,
            target_bill_egp=target_bill_egp,
            alert_threshold_pct=alert_threshold_pct,
        ),
    }


def check_budget_alert(
    current_month_kwh: float,
    target_bill_egp: float,
    alert_threshold_pct: int,
) -> Dict[str, Any]:
    """
    Budget-consumption check, kept callable on its own so a dashboard banner can
    poll it without recomputing the whole appliance plan.

    Included in the dashboard payload as well, so the frontend does not have to
    make a second request to know whether to show the warning.
    """
    total_allowed_kwh = bill_to_kwh(target_bill_egp)
    if total_allowed_kwh <= 0:
        pct_used = 0.0
    else:
        pct_used = round((current_month_kwh / total_allowed_kwh) * 100, 1)

    triggered = pct_used >= alert_threshold_pct

    return {
        "pct_of_budget_used": pct_used,
        "alert_threshold_pct": alert_threshold_pct,
        "alert_triggered": triggered,
        "message": (
            f"You've used {pct_used}% of your monthly energy budget."
            if triggered else None
        ),
    }
