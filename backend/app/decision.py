"""Deterministic maintenance decision engine.

All prices, stock figures, lead times, and downtime rates are synthetic
demo values. They are not validated industrial estimates.
"""

from dataclasses import asdict, dataclass
from typing import Any


DEMO_DATA = {
    "data_status": "synthetic_demo",
    "part_id": "BR-204",
    "part_unit_cost_inr": 12000.0,
    "stock_quantity": 2,
    "suppliers": [
        {"name": "Supplier A", "unit_cost_inr": 12000.0, "lead_time_days": 1},
        {"name": "Supplier B", "unit_cost_inr": 10500.0, "lead_time_days": 4},
    ],
    "downtime_cost_per_hour_inr": 5000.0,
    "immediate_replacement_hours": 4.0,
    "scheduled_replacement_hours": 3.0,
    "monitoring_hours": 0.5,
    "scheduled_wait_days": 3,
    "monitoring_horizon_days": 7,
}


@dataclass
class Option:
    name: str
    part_cost_inr: float
    downtime_hours: float
    downtime_cost_inr: float
    total_cost_inr: float
    lead_time_days: int
    stock_available: bool
    trade_off: str


def _money(value: float) -> float:
    return round(value, 2)


def evaluate_options(data: dict[str, Any] | None = None) -> dict[str, Any]:
    """Compare demo maintenance options using deterministic cost arithmetic."""
    config = data or DEMO_DATA

    stock = int(config["stock_quantity"])
    downtime_rate = float(config["downtime_cost_per_hour_inr"])
    suppliers = config["suppliers"]

    options: list[Option] = []

    # Immediate replacement: use available stock if a unit is in inventory.
    if stock > 0:
        part_cost = float(config["part_unit_cost_inr"])
        hours = float(config["immediate_replacement_hours"])

        options.append(
            Option(
                name="immediate_replacement",
                part_cost_inr=_money(part_cost),
                downtime_hours=hours,
                downtime_cost_inr=_money(hours * downtime_rate),
                total_cost_inr=_money(part_cost + hours * downtime_rate),
                lead_time_days=0,
                stock_available=True,
                trade_off=(
                    "Fastest intervention; consumes one unit of existing stock."
                ),
            )
        )
    else:
        options.append(
            Option(
                name="immediate_replacement",
                part_cost_inr=0.0,
                downtime_hours=0.0,
                downtime_cost_inr=0.0,
                total_cost_inr=0.0,
                lead_time_days=0,
                stock_available=False,
                trade_off="Unavailable: no replacement part is in stock.",
            )
        )

    # Scheduled replacement: choose the lowest-priced valid supplier.
    valid_suppliers = [
        supplier
        for supplier in suppliers
        if float(supplier["unit_cost_inr"]) >= 0
        and int(supplier["lead_time_days"]) >= 0
    ]

    if valid_suppliers:
        supplier = min(
            valid_suppliers,
            key=lambda item: (
                float(item["unit_cost_inr"]),
                int(item["lead_time_days"]),
            ),
        )

        part_cost = float(supplier["unit_cost_inr"])
        hours = float(config["scheduled_replacement_hours"])
        wait_days = max(
            int(config["scheduled_wait_days"]),
            int(supplier["lead_time_days"]),
        )
        downtime_cost = hours * downtime_rate

        options.append(
            Option(
                name="scheduled_replacement",
                part_cost_inr=_money(part_cost),
                downtime_hours=hours,
                downtime_cost_inr=_money(downtime_cost),
                total_cost_inr=_money(part_cost + downtime_cost),
                lead_time_days=wait_days,
                # Supplier availability is not the same as in-stock inventory.
                stock_available=False,
                trade_off=(
                    f"Uses {supplier['name']}; estimated lead/wait is "
                    f"{wait_days} days. The cost excludes unquantified "
                    "risk while waiting."
                ),
            )
        )
    else:
        options.append(
            Option(
                name="scheduled_replacement",
                part_cost_inr=0.0,
                downtime_hours=0.0,
                downtime_cost_inr=0.0,
                total_cost_inr=0.0,
                lead_time_days=0,
                stock_available=False,
                trade_off="Unavailable: no valid supplier data.",
            )
        )

    # Monitoring estimates immediate monitoring downtime only.
    # Future repair and failure costs are intentionally excluded.
    hours = float(config["monitoring_hours"])

    options.append(
        Option(
            name="continue_monitoring",
            part_cost_inr=0.0,
            downtime_hours=hours,
            downtime_cost_inr=_money(hours * downtime_rate),
            total_cost_inr=_money(hours * downtime_rate),
            lead_time_days=0,
            stock_available=True,
            trade_off=(
                "Lowest immediate cost, but future repair and production loss "
                "are excluded; failure risk is not quantified."
            ),
        )
    )

    # Stock status is descriptive; it must not determine whether a supplier-
    # backed option can be compared. Exclude options explicitly marked unavailable.
    feasible = [
        option
        for option in options
        if option.total_cost_inr >= 0
        and not option.trade_off.startswith("Unavailable:")
    ]

    # Rank by immediate cost only. This does not establish operational safety.
    ranked = sorted(feasible, key=lambda option: option.total_cost_inr)
    lowest_cost_option = ranked[0].name if ranked else None

    return {
        "data_status": config.get("data_status", "synthetic_demo"),
        "part_id": config["part_id"],
        "currency": "INR",
        "decision_status": "provisional",
        "recommendation_basis": "immediate_cost_comparison_only",
        "recommended_option": None,
        "lowest_immediate_cost_option": lowest_cost_option,
        "risk_assessment": "unknown",
        "requires_human_approval": True,
        "decision_explanation": (
            "A cost comparison is available, but the evidence is insufficient "
            "to select the safest maintenance action. Failure probability, "
            "future failure costs, and waiting-related operational risk have "
            "not been validated."
        ),
        "options": [asdict(option) for option in options],
        "assumptions": [
            "All input values are synthetic demonstration values.",
            "Downtime cost equals downtime hours multiplied by the configured hourly rate.",
            "Monitoring excludes future repair and failure costs.",
            "Waiting-related failure risk is not quantified.",
            "The lowest immediate cost is not necessarily the lowest total lifecycle cost.",
            "No operational action is approved automatically.",
        ],
    }
