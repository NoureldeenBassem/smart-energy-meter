"""
Egypt residential electricity tariff calculator.

This is the single, canonical source of truth for tariff logic in this
project. Brackets are hardcoded here as a Python constant — not stored in
the database — specifically to prevent the tested logic and the live logic
from ever drifting apart again.

Model: standard progressive/tiered pricing. Each bracket is only charged
on the slice of consumption that falls within it — NOT a flat rate applied
retroactively to the whole total once a threshold is crossed.
"""

from dataclasses import dataclass
from typing import List, Optional, Dict, Any


@dataclass(frozen=True)
class TariffBracket:
    bracket_order: int
    kwh_from: float
    kwh_to: Optional[float]  # None = unbounded top bracket
    price_per_kwh: float


# Egypt residential tariff brackets (EGP/kWh).
# Single canonical definition — do not duplicate this table anywhere else.
EGYPT_TARIFF_BRACKETS: List[TariffBracket] = [
    TariffBracket(1, 0,    50,   0.68),
    TariffBracket(2, 50,   100,  0.95),
    TariffBracket(3, 100,  200,  1.15),
    TariffBracket(4, 200,  350,  1.72),
    TariffBracket(5, 350,  650,  2.18),
    TariffBracket(6, 650,  1000, 2.40),
    TariffBracket(7, 1000, None, 2.74),
]


def calculate_bill(total_kwh: float, brackets: List[TariffBracket] = EGYPT_TARIFF_BRACKETS) -> float:
    """
    Forward function: total kWh consumed -> total bill in EGP.
    Charges each bracket's rate ONLY on the portion of consumption that
    falls within that bracket (progressive/tiered — never retroactive).
    """
    if total_kwh < 0:
        raise ValueError("total_kwh cannot be negative")

    bill = 0.0
    for bracket in sorted(brackets, key=lambda b: b.bracket_order):
        upper = bracket.kwh_to if bracket.kwh_to is not None else float("inf")
        portion = max(min(total_kwh, upper) - bracket.kwh_from, 0.0)
        bill += portion * bracket.price_per_kwh

    return round(bill, 2)


def bill_to_kwh(target_bill: float, brackets: List[TariffBracket] = EGYPT_TARIFF_BRACKETS) -> float:
    """
    Inverse function: a target bill in EGP -> the maximum kWh that would
    produce a bill at or below that amount.
    """
    if target_bill < 0:
        raise ValueError("target_bill cannot be negative")

    remaining_bill = target_bill
    total_kwh = 0.0

    for bracket in sorted(brackets, key=lambda b: b.bracket_order):
        upper = bracket.kwh_to if bracket.kwh_to is not None else float("inf")
        bracket_width = upper - bracket.kwh_from

        if bracket_width == float("inf"):
            total_kwh += remaining_bill / bracket.price_per_kwh
            return round(total_kwh, 3)

        cost_to_fill_bracket = bracket_width * bracket.price_per_kwh

        if remaining_bill <= cost_to_fill_bracket:
            total_kwh += remaining_bill / bracket.price_per_kwh
            return round(total_kwh, 3)

        remaining_bill -= cost_to_fill_bracket
        total_kwh += bracket_width

    return round(total_kwh, 3)


def current_bracket(total_kwh: float, brackets: List[TariffBracket] = EGYPT_TARIFF_BRACKETS) -> Optional[TariffBracket]:
    """Returns the bracket matching the current cumulative consumption."""
    for bracket in sorted(brackets, key=lambda b: b.bracket_order):
        upper = bracket.kwh_to if bracket.kwh_to is not None else float("inf")
        if bracket.kwh_from <= total_kwh < upper:
            return bracket
    return None


def get_tariff_summary(total_kwh: float, brackets: List[TariffBracket] = EGYPT_TARIFF_BRACKETS) -> Dict[str, Any]:
    """
    Convenience wrapper used by the telemetry/tariff API route.
    Returns bill, active bracket, and how much room is left before the
    next bracket kicks in (None if already in the unbounded top bracket).
    """
    if total_kwh < 0:
        raise ValueError("total_kwh cannot be negative")

    bracket = current_bracket(total_kwh, brackets)
    bill = calculate_bill(total_kwh, brackets)

    kwh_remaining_in_bracket = None
    if bracket and bracket.kwh_to is not None:
        kwh_remaining_in_bracket = round(bracket.kwh_to - total_kwh, 2)

    return {
        "consumption_kwh": round(total_kwh, 4),
        "total_bill_egp": bill,
        "active_bracket": bracket.bracket_order if bracket else None,
        "price_per_kwh_current": bracket.price_per_kwh if bracket else None,
        "kwh_remaining_in_bracket": kwh_remaining_in_bracket,
    }