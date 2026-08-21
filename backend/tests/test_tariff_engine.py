import pytest
from app.services.tariff_engine.calculator import (
    calculate_bill, bill_to_kwh, current_bracket, EGYPT_TARIFF_BRACKETS
)

BRACKETS = EGYPT_TARIFF_BRACKETS


def test_zero_consumption_is_zero_bill():
    assert calculate_bill(0, BRACKETS) == 0.0


def test_manual_cross_check_within_first_bracket():
    assert calculate_bill(30, BRACKETS) == pytest.approx(30 * 0.68, abs=0.01)


def test_manual_cross_check_spanning_two_brackets():
    expected = 50 * 0.68 + 25 * 0.95
    assert calculate_bill(75, BRACKETS) == pytest.approx(expected, abs=0.01)


def test_top_bracket_is_not_applied_to_entire_consumption():
    bill = calculate_bill(1200, BRACKETS)
    naive_wrong_bill = 1200 * 2.74
    assert bill < naive_wrong_bill


@pytest.mark.parametrize("kwh", [10, 49, 50, 75, 150, 300, 500, 900, 1500, 3000])
def test_round_trip_consistency(kwh):
    bill = calculate_bill(kwh, BRACKETS)
    recovered_kwh = bill_to_kwh(bill, BRACKETS)
    assert recovered_kwh == pytest.approx(kwh, abs=0.05)


def test_negative_inputs_raise():
    with pytest.raises(ValueError):
        calculate_bill(-5, BRACKETS)
    with pytest.raises(ValueError):
        bill_to_kwh(-5, BRACKETS)


def test_current_bracket_lookup():
    b = current_bracket(120, BRACKETS)
    assert b is not None
    assert b.bracket_order == 3