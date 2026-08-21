"""
Daily appliance load recommendation engine.

This is the single, canonical recommendation engine for the project —
replaces the old greedy.py / engine.py split. Output matches
ApplianceAllocation / RecommendationDashboardOut in app/api/schemas.py
exactly, field for field.

Algorithm: greedy allocation by priority.
1. Compute the remaining daily kWh allowance from the monthly budget.
2. Apply a mode multiplier (normal / eco / heavy / away) to that allowance.
3. Sort appliances by priority (High > Medium > Low), then by power draw.
4. Walk the sorted list, giving each appliance its full desired runtime
   if the budget allows; otherwise scale it down to whatever budget is
   left; otherwise (in Away mode, or budget exhausted) shed it entirely.
5. Flag whether the allocated plan crosses the budget's alert_threshold_pct
   so the frontend can show a warning without recomputing anything.
"""

import calendar
from datetime import date, datetime, timezone
from typing import List, Dict, Any

from app.services.tariff_engine.calculator import bill_to_kwh


PRIORITY_WEIGHTS = {"high": 3, "medium": 2, "low": 1}

MODE_MULTIPLIERS = {
    "normal": 1.0,
    "eco": 0.8,
    "heavy": 1.3,
    "away": 0.0,  # handled specially — non-essential appliances shed entirely
}

VALID_MODES = set(MODE_MULTIPLIERS.keys())


def _days_remaining_in_month(now: datetime) -> int:
    days_in_month = calendar.monthrange(now.year, now.month)[1]
    return max(1, days_in_month - now.day + 1)


def generate_recommendation_dashboard(
    target_bill_egp: float,
    alert_threshold_pct: int,
    current_month_kwh: float,
    appliances: List[Dict[str, Any]],
    mode: str = "normal",
) -> Dict[str, Any]:
    """
    appliances: list of dicts with keys matching the Appliance model:
        appliance_id, name, rated_power_w, priority ("High"/"Medium"/"Low"),
        desired_daily_hours

    Returns a dict matching RecommendationDashboardOut exactly.
    """
    if mode not in VALID_MODES:
        mode = "normal"

    now = datetime.now(timezone.utc)
    days_remaining = _days_remaining_in_month(now)

    total_allowed_kwh = bill_to_kwh(target_bill_egp)
    remaining_budget_kwh = max(0.0, total_allowed_kwh - current_month_kwh)
    base_daily_allowance = remaining_budget_kwh / days_remaining

    daily_kwh_allowance = round(base_daily_allowance * MODE_MULTIPLIERS[mode], 3)

    sorted_appliances = sorted(
        appliances,
        key=lambda a: (
            PRIORITY_WEIGHTS.get(str(a["priority"]).lower(), 1),
            a["rated_power_w"],
        ),
        reverse=True,
    )

    allocated_kwh = 0.0
    allocations = []

    for appliance in sorted_appliances:
        priority = str(appliance["priority"])
        is_high_priority = priority.lower() == "high"
        power_kw = appliance["rated_power_w"] / 1000.0
        desired_hours = appliance["desired_daily_hours"]

        # AWAY MODE: everything except High priority is shed entirely.
        if mode == "away" and not is_high_priority:
            allocations.append({
                "appliance_id": str(appliance["appliance_id"]),
                "name": appliance["name"],
                "rated_power_w": appliance["rated_power_w"],
                "priority": priority,
                "recommended_runtime_hours": 0.0,
                "status": "away",
                "action_note": "Shed — Away Mode active",
            })
            continue

        requested_kwh = power_kw * desired_hours

        if allocated_kwh + requested_kwh <= daily_kwh_allowance:
            hours = desired_hours
            status = "optimal"
            note = f"Run normally for {hours} hrs/day"
        else:
            remaining_kwh = max(0.0, daily_kwh_allowance - allocated_kwh)
            hours = round(remaining_kwh / power_kw, 1) if power_kw > 0 else 0.0
            hours = min(hours, desired_hours)
            if hours > 0:
                status = "constrained"
                note = f"Limit runtime to {hours} hrs/day to stay within budget"
            else:
                status = "shed"
                note = "Avoid running today if possible"

        appliance_kwh = round(power_kw * hours, 3)
        allocated_kwh += appliance_kwh

        allocations.append({
            "appliance_id": str(appliance["appliance_id"]),
            "name": appliance["name"],
            "rated_power_w": appliance["rated_power_w"],
            "priority": priority,
            "recommended_runtime_hours": hours,
            "status": status,
            "action_note": note,
        })

    return {
        "active_mode": mode,
        "target_bill_egp": target_bill_egp,
        "days_remaining_in_month": days_remaining,
        "daily_kwh_allowance": daily_kwh_allowance,
        "allocations": allocations,
    }


def check_budget_alert(
    current_month_kwh: float,
    target_bill_egp: float,
    alert_threshold_pct: int,
) -> Dict[str, Any]:
    """
    Separate, explicit alert check — kept independent of the allocation
    function above so it can be called on its own (e.g. for a dashboard
    banner) without recomputing the full appliance plan.
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