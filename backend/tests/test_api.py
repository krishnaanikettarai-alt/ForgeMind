from unittest.mock import patch

from fastapi.testclient import TestClient

from app.analysis import ThresholdConfig, analyze_readings
from app.data import SensorReading
from app.main import app


client = TestClient(app)


def test_health() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_machine_listing_uses_synthetic_catalog() -> None:
    response = client.get("/api/machines")
    assert response.status_code == 200
    machines = response.json()["machines"]
    assert len(machines) == 20
    assert machines[0]["machineId"] == "M01"
    assert all(machine["source"] == "synthetic" for machine in machines)


def test_sensor_retrieval_is_bounded() -> None:
    response = client.get("/api/machines/M17/sensors?limit=3")
    assert response.status_code == 200
    payload = response.json()
    assert payload["machineId"] == "M17"
    assert payload["source"] == "synthetic"
    assert len(payload["readings"]) == 3
    assert all(reading["machineId"] == "M17" for reading in payload["readings"])


def test_invalid_machine_id_is_not_joined_to_historical_namespace() -> None:
    response = client.get("/api/machines/17/sensors")
    assert response.status_code == 404
    assert "Synthetic machine not found" in response.json()["detail"]


def test_assistant_contract_and_amd_integration() -> None:
    mock_result = {
        "answer": (
            "The available synthetic sensor data requires investigation. "
            "A validated failure probability is unavailable."
        ),
        "machineId": "M17",
        "model": "DeepSeek-V4-Flash",
        "provider": "AMD Token Factory",
        "tools_used": ["analyze_machine", "get_failure_risk"],
        "status": "completed",
        "data_status": "synthetic_demo",
        "requires_human_approval": True,
    }

    with patch(
        "app.main.run_maintenance_agent",
        return_value=mock_result,
    ) as mock_agent:
        response = client.post(
            "/api/assistant",
            json={
                "message": "Why is this machine at risk?",
                "machineId": "M17",
            },
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["machineId"] == "M17"
    assert payload["provider"] == "AMD Token Factory"
    assert payload["model"] == "DeepSeek-V4-Flash"
    assert payload["status"] == "completed"
    assert payload["data_status"] == "synthetic_demo"
    assert payload["requires_human_approval"] is True
    assert payload["tools_used"] == ["analyze_machine", "get_failure_risk"]
    mock_agent.assert_called_once_with(
        message="Why is this machine at risk?",
        machine_id="M17",
    )


def test_assistant_rejects_malformed_request() -> None:
    response = client.post("/api/assistant", json={"machineId": "M17"})
    assert response.status_code == 422


def test_assistant_rejects_unknown_machine() -> None:
    response = client.post(
        "/api/assistant",
        json={
            "message": "Investigate this machine.",
            "machineId": "M99",
        },
    )
    assert response.status_code == 404


def reading(
    timestamp: str,
    vibration: float,
    temperature: float,
    current: float,
) -> SensorReading:
    return SensorReading("M01", timestamp, vibration, temperature, current)


def test_analysis_normal_data_and_metrics() -> None:
    result = analyze_readings(
        [
            reading("2026-01-01T00:00:00", 1, 10, 2),
            reading("2026-01-01T00:01:00", 2, 12, 4),
            reading("2026-01-01T00:02:00", 3, 14, 6),
        ],
        "M01",
        window=2,
        thresholds=ThresholdConfig(10, 100, 20, "fixture", "unvalidated"),
    )
    vibration = result["analysis"]["derivedMetrics"]["vibration"]
    observed_vibration = result["analysis"]["observedMeasurements"]["vibration"]
    assert observed_vibration["readingsAnalyzed"] == 3
    assert observed_vibration["firstObserved"] == 1
    assert observed_vibration["lastObserved"] == 3
    assert vibration["absoluteChange"] == 2
    assert vibration["percentageChange"] == 200
    assert vibration["recentMovingAverage"] == 2.5
    assert vibration["trendDirection"] == "increasing"
    assert result["analysis"]["thresholdFlags"]["vibration"]["flagged"] is False


def test_analysis_rising_flat_and_insufficient_data() -> None:
    rising = analyze_readings(
        [reading("a", 1, 1, 1), reading("b", 2, 2, 2)],
        "M01",
        window=2,
    )
    flat = analyze_readings(
        [reading("a", 1, 1, 1), reading("b", 1, 1, 1)],
        "M01",
        window=2,
    )
    insufficient = analyze_readings(
        [reading("a", 1, 1, 1)],
        "M01",
        window=2,
    )
    assert (
        rising["analysis"]["derivedMetrics"]["temperature"]["trendDirection"]
        == "increasing"
    )
    assert (
        flat["analysis"]["derivedMetrics"]["temperature"]["trendDirection"]
        == "flat"
    )
    assert (
        insufficient["analysis"]["derivedMetrics"]["temperature"]["trendDirection"]
        == "insufficient_data"
    )
    assert (
        insufficient["analysis"]["derivedMetrics"]["temperature"][
            "recentMovingAverage"
        ]
        is None
    )


def test_analysis_zero_baseline_and_threshold_boundary() -> None:
    result = analyze_readings(
        [reading("a", 0, 79, 1), reading("b", 2, 80, 1)],
        "M01",
        window=2,
        thresholds=ThresholdConfig(2, 80, 1, "fixture", "unvalidated"),
    )
    vibration = result["analysis"]["derivedMetrics"]["vibration"]
    assert vibration["percentageChange"] is None
    assert result["analysis"]["thresholdFlags"]["vibration"]["flagged"] is True
    assert result["analysis"]["thresholdFlags"]["temperature"]["flagged"] is True
    assert result["analysis"]["thresholdFlags"]["current"]["flagged"] is True


def test_analysis_endpoint_and_invalid_machine_id() -> None:
    response = client.get("/api/machines/M01/analysis?limit=3&window=2")
    assert response.status_code == 200
    payload = response.json()
    assert payload["machineId"] == "M01"
    assert payload["source"] == "synthetic"
    assert "observedMeasurements" in payload["analysis"]
    assert "derivedMetrics" in payload["analysis"]
    assert "thresholdFlags" in payload["analysis"]
    assert "limitations" in payload

    invalid = client.get("/api/machines/17/analysis")
    assert invalid.status_code == 404


def test_analysis_endpoint_rejects_invalid_bounds() -> None:
    assert client.get("/api/machines/M01/analysis?limit=0").status_code == 422
    assert client.get("/api/machines/M01/analysis?window=101").status_code == 422


def test_decisions_endpoint_returns_maintenance_options() -> None:
    response = client.get("/api/decisions")
    assert response.status_code == 200

    payload = response.json()
    assert payload["data_status"] == "synthetic_demo"
    assert payload["part_id"] == "BR-204"
    assert payload["currency"] == "INR"

    option_names = {option["name"] for option in payload["options"]}
    assert option_names == {
        "immediate_replacement",
        "scheduled_replacement",
        "continue_monitoring",
    }


def test_decisions_endpoint_discloses_cost_limitations() -> None:
    payload = client.get("/api/decisions").json()

    assert payload["decision_status"] == "provisional"
    assert payload["recommended_option"] is None
    assert payload["lowest_immediate_cost_option"] == "continue_monitoring"
    assert payload["risk_assessment"] == "unknown"
    assert payload["requires_human_approval"] is True
    assert any("not quantified" in item for item in payload["assumptions"])


def test_decisions_endpoint_costs_are_consistent() -> None:
    payload = client.get("/api/decisions").json()

    for option in payload["options"]:
        assert option["total_cost_inr"] == round(
            option["part_cost_inr"] + option["downtime_cost_inr"], 2
        )
