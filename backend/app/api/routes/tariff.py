"""
Tariff routes — thin wrapper around the canonical calculator in
app/services/tariff_engine/calculator.py. No tariff math lives here;
this file only handles the HTTP layer.
"""

from fastapi import APIRouter, Query
from app.services.tariff_engine.calculator import get_tariff_summary

router = APIRouter(prefix="/tariff", tags=["tariff"])


@router.get("/summary")
def get_summary(kwh: float = Query(..., ge=0, description="Total kWh consumed this billing period")):
    """
    Given a kWh figure, returns the bill, active bracket, and how much
    room is left before the next bracket. Stateless — does not touch
    the database. The caller (budgets.py, or the frontend directly)
    is responsible for supplying the correct current_month_kwh figure.
    """
    return get_tariff_summary(kwh)