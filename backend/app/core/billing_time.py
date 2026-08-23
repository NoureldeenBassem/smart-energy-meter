"""
Billing-cycle time helpers — one definition of "today" and "this cycle".

WHY THIS IS CENTRALISED
=======================
An Egyptian electricity bill runs over a LOCAL calendar month. Cairo is UTC+2
(UTC+3 under summer time), so "today" in UTC and "today" in Cairo disagree for
two to three hours every night. If the forecaster buckets a day one way and the
dashboard's "today's kWh" buckets it another, the two disagree by whatever was
consumed in that window — and the numbers on screen contradict each other with
no obvious cause.

That is the same failure mode the online/offline flapping bug had: one quantity
computed independently in two places. So the timezone and the cycle boundaries
are defined once, here, and imported everywhere.

Postgres does the bucketing with `(ts AT TIME ZONE :tz)::date`, which needs the
zone NAME (not a fixed offset) so that summer time is handled by the database's
own tz database rather than hardcoded. BILLING_TIMEZONE_NAME is that string.
"""

from calendar import monthrange
from datetime import date, datetime
from zoneinfo import ZoneInfo

BILLING_TIMEZONE_NAME = "Africa/Cairo"
BILLING_TIMEZONE = ZoneInfo(BILLING_TIMEZONE_NAME)


def now_local() -> datetime:
    """Current time in the billing timezone."""
    return datetime.now(BILLING_TIMEZONE)


def today_local() -> date:
    """Today's date in the billing timezone."""
    return now_local().date()


def cycle_start(on: date | None = None) -> date:
    """First day of the billing cycle containing `on` (default: today)."""
    d = on or today_local()
    return d.replace(day=1)


def cycle_length_days(on: date | None = None) -> int:
    """
    Days in the billing cycle containing `on` — 28, 29, 30 or 31.

    The forecaster handles all of these because it predicts a per-DAY rate error
    scaled by however many days actually remain (see ml/features.py); nothing
    assumes a fixed cycle length at serving time.
    """
    d = on or today_local()
    return monthrange(d.year, d.month)[1]


def cycle_end(on: date | None = None) -> date:
    """
    LAST day of the billing cycle containing `on` — inclusive.

    Inclusive because a bill covers the 1st through the last day of the month, so
    for August this is the 31st, not the 1st of September. Derived from
    cycle_length_days rather than from a separate calendar call, so the cycle's
    length and its end can never disagree.
    """
    d = on or today_local()
    return cycle_start(d).replace(day=cycle_length_days(d))
