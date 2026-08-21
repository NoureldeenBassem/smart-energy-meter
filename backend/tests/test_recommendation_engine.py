import pytest
from app.services.recommendation.engine import (
    generate_recommendation_dashboard, check_budget_alert
)

FRIDGE = {
    "appliance_id": "fridge-1", "name": "Fridge",
    "rated_power_w": 150, "priority": "High", "desired_daily_hours": 24
}
AC = {
    "appliance_id": "ac-1", "name": "AC",
    "rated_power_w": 1800, "priority": "Medium", "desired_daily_hours": 6
}
WASHER = {
    "appliance_id": "washer-1", "name": "Washing Machine",
    "rated_power_w": 500, "priority": "Low", "desired_daily_hours": 2
}
APPLIANCES = [FRIDGE, AC, WASHER]


def test_comfortable_budget_all_optimal():
    result = generate_recommendation_dashboard(
        target_bill_egp=1000, alert_threshold_pct=85,
        current_month_kwh=0, appliances=APPLIANCES, mode="normal"
    )
    statuses = {a["appliance_id"]: a["status"] for a in result["allocations"]}
    assert statuses["fridge-1"] == "optimal"


def test_away_mode_sheds_everything_except_high_priority():
    result = generate_recommendation_dashboard(
        target_bill_egp=500, alert_threshold_pct=85,
        current_month_kwh=0, appliances=APPLIANCES, mode="away"
    )
    by_id = {a["appliance_id"]: a for a in result["allocations"]}
    assert by_id["fridge-1"]["status"] != "away"          # High priority stays on
    assert by_id["ac-1"]["status"] == "away"
    assert by_id["ac-1"]["recommended_runtime_hours"] == 0.0
    assert by_id["washer-1"]["status"] == "away"


def test_eco_mode_allocates_less_than_normal_mode():
    normal = generate_recommendation_dashboard(
        target_bill_egp=500, alert_threshold_pct=85,
        current_month_kwh=0, appliances=APPLIANCES, mode="normal"
    )
    eco = generate_recommendation_dashboard(
        target_bill_egp=500, alert_threshold_pct=85,
        current_month_kwh=0, appliances=APPLIANCES, mode="eco"
    )
    assert eco["daily_kwh_allowance"] < normal["daily_kwh_allowance"]


def test_tight_budget_constrains_lower_priority_appliance():
    result = generate_recommendation_dashboard(
        target_bill_egp=40, alert_threshold_pct=85,
        current_month_kwh=0, appliances=APPLIANCES, mode="normal"
    )
    by_id = {a["appliance_id"]: a for a in result["allocations"]}
    assert by_id["fridge-1"]["recommended_runtime_hours"] == 24  # High priority always protected
    assert by_id["washer-1"]["recommended_runtime_hours"] < WASHER["desired_daily_hours"]


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