"""
Budget routes: create/update the user's monthly target, and serve the
daily appliance recommendation dashboard built on top of it.

Depends on:
- app/services/recommendation/engine.py       (generate_recommendation_dashboard, check_budget_alert)
- app/services/forecasting/bill_forecast.py   (daily_kwh_this_cycle — the shared
  "kWh so far this cycle" query, so the budget figure here cannot disagree with
  the predicted bill shown beside it)
"""

from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user_id
from app.core.billing_time import cycle_start, today_local
from app.models.models import Budget, Appliance, Device
from app.api.schemas import BudgetCreate, BudgetOut, RecommendationDashboardOut
from app.services.forecasting.bill_forecast import daily_kwh_this_cycle
from app.services.recommendation.engine import (
    generate_recommendation_dashboard,
    check_budget_alert,
)

router = APIRouter(prefix="/budgets", tags=["budgets"])


@router.post("", response_model=BudgetOut)
def set_or_update_budget(
    payload: BudgetCreate,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    """
    Creates a new budget row for the current month. We intentionally do
    NOT upsert/overwrite an existing budget here — get_active_budget()
    below always picks the most recently created one, so simply inserting
    a new row each time the user changes their target is enough, and it
    preserves history for free.
    """
    budget = Budget(
        user_id=UUID(user_id),
        target_bill_egp=payload.target_bill_egp,
        alert_threshold_pct=payload.alert_threshold_pct or 85,
    )
    db.add(budget)
    db.commit()
    db.refresh(budget)
    return budget


@router.get("/active", response_model=BudgetOut)
def get_active_budget(
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    """Returns the user's most recently set budget, or 404 if none exists yet."""
    budget = (
        db.query(Budget)
        .filter(Budget.user_id == UUID(user_id))
        .order_by(Budget.created_at.desc())
        .first()
    )
    if not budget:
        raise HTTPException(status_code=404, detail="No budget set yet")
    return budget


def _get_month_to_date_kwh(db: Session, device_id: UUID) -> float:
    """
    kWh consumed so far in the current BILLING cycle.

    Delegates to the same helper the bill forecast uses, rather than running its
    own SUM. It previously had its own query bucketed on
    `date_trunc('month', now() AT TIME ZONE 'UTC')`, which was wrong twice over:
    the cycle boundary was a UTC month rather than an Africa/Cairo one, and it was
    a third independent implementation of "kWh so far this cycle" alongside the
    forecaster's and the aggregation worker's. The recommendation budget and the
    predicted bill on the same screen could therefore disagree about how much had
    already been used.
    """
    today = today_local()
    daily = daily_kwh_this_cycle(db, device_id, cycle_start(today), today)
    return round(sum(daily), 4)


@router.get("/recommendations/{device_id}", response_model=RecommendationDashboardOut)
def get_recommendations(
    device_id: UUID,
    mode: str = Query("normal", pattern="^(normal|eco|heavy|away)$"),
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    device = (
        db.query(Device)
        .filter(Device.device_id == device_id, Device.user_id == UUID(user_id))
        .first()
    )
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    budget = (
        db.query(Budget)
        .filter(Budget.user_id == UUID(user_id))
        .order_by(Budget.created_at.desc())
        .first()
    )
    if not budget:
        raise HTTPException(
            status_code=400,
            detail="No budget set yet — create one via POST /budgets before requesting recommendations",
        )

    appliances = (
        db.query(Appliance)
        .filter(Appliance.user_id == UUID(user_id))
        .all()
    )
    if not appliances:
        raise HTTPException(
            status_code=400,
            detail="No appliances registered yet — add at least one before requesting recommendations",
        )

    appliance_dicts = [
        {
            "appliance_id": a.appliance_id,
            "name": a.name,
            "rated_power_w": a.rated_power_w,
            "priority": a.priority,
            "is_essential": a.is_essential,
            "desired_daily_hours": a.desired_daily_hours,
        }
        for a in appliances
    ]

    current_month_kwh = _get_month_to_date_kwh(db, device_id)

    dashboard = generate_recommendation_dashboard(
        target_bill_egp=budget.target_bill_egp,
        alert_threshold_pct=budget.alert_threshold_pct,
        current_month_kwh=current_month_kwh,
        appliances=appliance_dicts,
        mode=mode,
    )
    return dashboard


@router.get("/alert/{device_id}")
def get_budget_alert(
    device_id: UUID,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    """
    Separate, lightweight endpoint — just the alert_threshold_pct check,
    without recomputing the full appliance allocation. Useful for a
    dashboard banner that polls more frequently than the full
    recommendations panel needs to.
    """
    device = (
        db.query(Device)
        .filter(Device.device_id == device_id, Device.user_id == UUID(user_id))
        .first()
    )
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    budget = (
        db.query(Budget)
        .filter(Budget.user_id == UUID(user_id))
        .order_by(Budget.created_at.desc())
        .first()
    )
    if not budget:
        raise HTTPException(status_code=400, detail="No budget set yet")

    current_month_kwh = _get_month_to_date_kwh(db, device_id)

    return check_budget_alert(
        current_month_kwh=current_month_kwh,
        target_bill_egp=budget.target_bill_egp,
        alert_threshold_pct=budget.alert_threshold_pct,
    )