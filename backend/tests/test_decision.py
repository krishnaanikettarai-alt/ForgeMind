import pytest

from backend.app.decision import DEMO_DATA, evaluate_options


def test_demo_data_is_labelled_synthetic():
    result = evaluate_options()
    assert result["data_status"] == "synthetic_demo"
    assert result["currency"] == "INR"


def test_downtime_cost_is_calculated_deterministically():
    result = evaluate_options()
    immediate = next(
        item for item in result["options"]
        if item["name"] == "immediate_replacement"
    )
    assert immediate["downtime_cost_inr"] == 4 * 5000
    assert immediate["total_cost_inr"] == 12000 + 4 * 5000



def test_lowest_cost_is_not_presented_as_operational_recommendation():
    result = evaluate_options()

    assert result["decision_status"] == "provisional"
    assert result["recommended_option"] is None
    assert result["lowest_immediate_cost_option"] == "continue_monitoring"
    assert result["risk_assessment"] == "unknown"
    assert result["requires_human_approval"] is True



def test_no_stock_marks_immediate_replacement_unavailable():
    data = {**DEMO_DATA, "stock_quantity": 0}
    result = evaluate_options(data)
    immediate = next(
        item for item in result["options"]
        if item["name"] == "immediate_replacement"
    )
    assert immediate["stock_available"] is False
    assert immediate["total_cost_inr"] == 0.0
    assert result["recommended_option"] != "immediate_replacement"


def test_missing_suppliers_marks_scheduled_option_unavailable():
    data = {**DEMO_DATA, "suppliers": []}
    result = evaluate_options(data)
    scheduled = next(
        item for item in result["options"]
        if item["name"] == "scheduled_replacement"
    )
    assert scheduled["stock_available"] is False


def test_supplier_selection_uses_lowest_price():
    result = evaluate_options()
    scheduled = next(
        item for item in result["options"]
        if item["name"] == "scheduled_replacement"
    )
    assert scheduled["part_cost_inr"] == 10500.0


def test_result_discloses_unquantified_risk():
    result = evaluate_options()
    assert any("not quantified" in item for item in result["assumptions"])


def test_decision_explains_missing_risk_evidence():
    result = evaluate_options()

    assert "insufficient" in result["decision_explanation"]
    assert any(
        "failure risk is not quantified" in option["trade_off"]
        for option in result["options"]
        if option["name"] == "continue_monitoring"
    )
