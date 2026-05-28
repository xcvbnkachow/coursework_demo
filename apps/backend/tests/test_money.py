from decimal import Decimal

from app.services import to_money


def test_to_money_rounds_half_up():
    assert to_money(Decimal("10.005")) == Decimal("10.01")

