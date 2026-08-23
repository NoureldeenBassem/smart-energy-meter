"""
Unit tests for the billing-cycle boundaries.

These matter more than their size suggests. cycle_start / cycle_end define the
billing_period_start and billing_period_end written into bills_predicted, and
cycle_length_days is what the forecaster multiplies its per-day rate correction by
to reach a cycle total. An off-by-one here shifts every predicted bill.

The functions are pure date arithmetic, so they are tested directly against known
calendars rather than by mocking the clock.
"""

from datetime import date

from app.core.billing_time import (
    BILLING_TIMEZONE,
    BILLING_TIMEZONE_NAME,
    cycle_end,
    cycle_length_days,
    cycle_start,
    now_local,
    today_local,
)

import pytest


# --------------------------------------------------------------------------
# cycle_start — an Egyptian bill runs over a local calendar month
# --------------------------------------------------------------------------

@pytest.mark.parametrize("given", [
    date(2026, 8, 1),      # already the first
    date(2026, 8, 22),     # mid-cycle
    date(2026, 8, 31),     # last day
])
def test_cycle_start_is_the_first_of_the_month(given):
    assert cycle_start(given) == date(2026, 8, 1)


def test_cycle_start_does_not_leak_into_the_previous_month():
    """The 1st must map to itself, not roll back to the previous month's 1st."""
    assert cycle_start(date(2026, 9, 1)) == date(2026, 9, 1)


# --------------------------------------------------------------------------
# cycle_length_days — 28, 29, 30 and 31 all occur, and the model is
# cycle-length agnostic precisely because this is not hardcoded to 30.
# --------------------------------------------------------------------------

@pytest.mark.parametrize("given,expected", [
    (date(2026, 1, 15), 31),
    (date(2026, 2, 15), 28),    # common year
    (date(2028, 2, 15), 29),    # leap year
    (date(2026, 4, 15), 30),
    (date(2026, 8, 22), 31),
    (date(2026, 12, 31), 31),
    (date(2100, 2, 15), 28),    # divisible by 100, not 400 -> not a leap year
    (date(2000, 2, 15), 29),    # divisible by 400 -> leap year
])
def test_cycle_length_days(given, expected):
    assert cycle_length_days(given) == expected


# --------------------------------------------------------------------------
# cycle_end — INCLUSIVE last day, not the first of the next month
# --------------------------------------------------------------------------

@pytest.mark.parametrize("given,expected", [
    (date(2026, 8, 22), date(2026, 8, 31)),
    (date(2026, 4, 10), date(2026, 4, 30)),
    (date(2026, 2, 3), date(2026, 2, 28)),
    (date(2028, 2, 3), date(2028, 2, 29)),
])
def test_cycle_end_is_the_inclusive_last_day(given, expected):
    assert cycle_end(given) == expected


def test_cycle_end_does_not_spill_into_the_next_month():
    """
    A bill covers the 1st through the last day of the month. Returning the 1st of
    the following month would overstate every billing period by one day and, at a
    year boundary, by a year.
    """
    assert cycle_end(date(2026, 8, 22)).month == 8
    assert cycle_end(date(2026, 12, 5)) == date(2026, 12, 31)


def test_cycle_end_stays_in_the_same_year_in_december():
    end = cycle_end(date(2026, 12, 31))
    assert end.year == 2026 and end == date(2026, 12, 31)


# --------------------------------------------------------------------------
# The three must agree with each other — they are used together to describe
# one cycle, so a disagreement is a bug even if each looks right alone.
# --------------------------------------------------------------------------

@pytest.mark.parametrize("given", [
    date(2026, 1, 9), date(2026, 2, 9), date(2028, 2, 9), date(2026, 4, 9),
    date(2026, 8, 22), date(2026, 11, 30), date(2026, 12, 1),
])
def test_start_end_and_length_are_mutually_consistent(given):
    start, end, length = cycle_start(given), cycle_end(given), cycle_length_days(given)

    assert end.day == length, "cycle_end must land on the last day the length implies"
    assert start.month == end.month == given.month
    assert start.year == end.year == given.year
    # Inclusive span: 1st..31st is 31 days, so the difference is length - 1.
    assert (end - start).days == length - 1
    assert start <= given <= end


# --------------------------------------------------------------------------
# Timezone: the zone NAME is what Postgres needs for `ts AT TIME ZONE :tz`,
# so that summer time comes from the database's tz data rather than a
# hardcoded offset.
# --------------------------------------------------------------------------

def test_billing_timezone_is_a_named_zone_not_a_fixed_offset():
    assert BILLING_TIMEZONE_NAME == "Africa/Cairo"
    assert str(BILLING_TIMEZONE) == "Africa/Cairo"


def test_cairo_summer_time_offset_is_plus_three():
    """
    August 2026 is under summer time (UTC+3). This is the offset that makes local
    and UTC days disagree, which is the whole reason these helpers are centralised.
    """
    from datetime import datetime
    offset = datetime(2026, 8, 22, 12, 0, tzinfo=BILLING_TIMEZONE).utcoffset()
    assert offset.total_seconds() / 3600 == 3
    winter = datetime(2026, 1, 22, 12, 0, tzinfo=BILLING_TIMEZONE).utcoffset()
    assert winter.total_seconds() / 3600 == 2


def test_defaults_use_today_and_are_self_consistent():
    """Called with no argument, all three must describe the same current cycle."""
    today = today_local()
    assert now_local().date() == today
    assert cycle_start() == cycle_start(today)
    assert cycle_end() == cycle_end(today)
    assert cycle_length_days() == cycle_length_days(today)
    assert cycle_start() <= today <= cycle_end()
