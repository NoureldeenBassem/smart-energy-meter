"""
Budget routes: create/update the user's monthly target, and serve the
daily appliance recommendation dashboard built on top of it.

Depends on:
- app/services/tariff_engine/calculator.py  (bill_to_kwh, via the engine)
- app/services/recommendation/engine.py     (generate_recommendation_dashboard, check_budget_alert)
"""

from uuid import UUID
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.core.database import get_db
from app.core.security import get_current_user_id
from app.models.models import Budget, Appliance, Device, TelemetryRaw
from app.api.schemas import BudgetCreate, BudgetOut, RecommendationDashboardOut
from app.services.recommendation.engine import (
    generate_recommendation_dashboard,
    check_budget_alert,
)
from app.services.tariff_engine.calculator import bill_to_kwh

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
    """Sums energy_wh_delta from telemetry_raw for the current calendar month."""
    result = db.execute(
        text("""
            SELECT COALESCE(SUM(energy_wh_delta) / 1000.0, 0) AS kwh
            FROM telemetry_raw
            WHERE device_id = :device_id
              AND ts >= date_trunc('month', now() AT TIME ZONE 'UTC')
        """),
        {"device_id": str(device_id)},
    ).scalar()
    return float(result or 0.0)


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