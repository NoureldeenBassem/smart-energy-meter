"""
Tariff routes — thin wrapper around the canonical calculator in
app/services/tariff_engine/calculator.py. No tariff math lives here;
this file only handles the HTTP layer.
"""

from fastapi import APIRouter, Query
from app.services.tariff_engine.calculator import (
    EGYPT_TARIFF_BRACKETS,
    bill_to_kwh,
    calculate_bill,
    get_tariff_summary,
)

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


@router.get("/brackets")
def list_brackets():
    """
    The bracket table itself, so the Budget Planner can show WHY a target bill
    buys the kWh it buys. Served from EGYPT_TARIFF_BRACKETS rather than from the
    tariff_brackets table: the calculator's hardcoded constant is the definition
    the bill is actually computed from, and shipping the DB copy to the UI would
    let the screen and the arithmetic drift apart.
    """
    return [
        {
            "bracket_order": b.bracket_order,
            "kwh_from": b.kwh_from,
            "kwh_to": b.kwh_to,          # null = unbounded top bracket
            "price_per_kwh": b.price_per_kwh,
        }
        for b in sorted(EGYPT_TARIFF_BRACKETS, key=lambda b: b.bracket_order)
    ]


@router.get("/allowance")
def get_allowance(
    target_bill_egp: float = Query(..., ge=0, description="Target monthly bill in EGP"),
):
    """
    Inverse direction: a target bill -> the most kWh you can use and still land at
    or below it. This is the Budget Planner's whole answer.

    `bill_at_allowance` is `calculate_bill(allowed_kwh)` -- the forward function
    applied to the inverse function's own output. It is returned so the round trip
    is visible on screen rather than asserted: if the two functions ever disagreed,
    this number would not come back equal to the target.

    Stateless. Nothing about the user's actual consumption enters here.
    """
    allowed_kwh = bill_to_kwh(target_bill_egp)
    return {
        "target_bill_egp": round(target_bill_egp, 2),
        "allowed_kwh": allowed_kwh,
        "bill_at_allowance": calculate_bill(allowed_kwh),
        "tariff_position": get_tariff_summary(allowed_kwh),
    }