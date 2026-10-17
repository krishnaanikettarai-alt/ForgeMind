"""Tool-using maintenance agent for ForgeMind."""

from __future__ import annotations

import json
import logging
from typing import Any

from openai import APIError, APITimeoutError, OpenAI

from .amd_client import get_amd_client, get_amd_model
from .analysis import analyze_readings, threshold_config
from .data import machine_sensor_readings, machine_ids
from .decision import evaluate_options


# Allow one initial tool-calling request and one follow-up if needed.
MAX_TOOL_ROUNDS = 2

SYSTEM_PROMPT = """
You are ForgeMind, an industrial maintenance investigation assistant.

Use the available tools to gather evidence before answering questions about
a machine. For a full investigation, use all three tools:
analyze_machine, compare_maintenance_options, and get_failure_risk.
Request multiple tools in the same turn when appropriate.

Do not invent sensor readings, failure probabilities, costs, supplier
information, or machine conditions.

All machine telemetry and maintenance prices in this demo are synthetic.
Sensor thresholds are application defaults and are not industry-validated.
The maintenance comparison is based on immediate costs only. Failure risk
and waiting-related operational risk are unknown unless supported by
validated evidence.

Never claim that a maintenance action is approved or executed. Human approval
is required for operational action.

Clearly distinguish observed data, calculated values, assumptions, and
unknowns. If a tool reports unavailable data, explain that limitation.

Keep responses concise and readable. Use short headings and bullet points.
Avoid large Markdown tables unless the user explicitly requests them.
Do not repeat the same information in multiple sections.

Return a useful answer for an industrial maintenance operator.

OUTPUT QUALITY RULES
- Return complete, grammatical sentences and properly closed Markdown.
- Never output internal editing artifacts such as ")Skip.", "Skip.", or unfinished fragments.
- Do not invent a maintenance recommendation when the tools return no recommended option.
- You may identify the lowest immediate-cost option, but never describe it as the safest option without validated risk evidence.
- When failure risk is unknown, state that the available evidence is insufficient to determine the safest maintenance action.
- Do not recommend changing monitoring frequency unless supported by a tool result or validated operational guidance.
- Keep numerical values consistent with tool results. Do not silently change precision or units.
- Do not repeat the same information in multiple sections.
- Clearly distinguish observed readings, calculated values, provisional costs, and unknowns.
- Never claim that a maintenance action has been approved or executed.
"""


TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "analyze_machine",
            "description": (
                "Analyze synthetic sensor readings and threshold flags "
                "for the selected machine."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "machine_id": {
                        "type": "string",
                        "description": "The selected machine ID.",
                    }
                },
                "required": ["machine_id"],
                "additionalProperties": False,
            },
            "strict": True,
        },
    },
    {
        "type": "function",
        "function": {
            "name": "compare_maintenance_options",
            "description": (
                "Return the provisional synthetic maintenance cost comparison. "
                "This does not determine operational safety."
            ),
            "parameters": {
                "type": "object",
                "properties": {},
                "required": [],
                "additionalProperties": False,
            },
            "strict": True,
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_failure_risk",
            "description": (
                "Check whether a validated failure-risk estimate is available "
                "for the selected synthetic machine."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "machine_id": {"type": "string"},
                },
                "required": ["machine_id"],
                "additionalProperties": False,
            },
            "strict": True,
        },
    },
]


def _analyze_machine(machine_id: str) -> dict[str, Any]:
    if machine_id not in set(machine_ids()):
        return {
            "error": "Machine not found.",
            "machine_id": machine_id,
        }

    readings = machine_sensor_readings(machine_id)

    return analyze_readings(
        readings[-100:],
        machine_id=machine_id,
        window=10,
        thresholds=threshold_config(),
    )


def _get_failure_risk(machine_id: str) -> dict[str, Any]:
    if machine_id not in set(machine_ids()):
        return {
            "error": "Machine not found.",
            "machine_id": machine_id,
        }

    return {
        "machine_id": machine_id,
        "risk_assessment": "unknown",
        "failure_probability": None,
        "status": "unavailable_for_this_machine",
        "explanation": (
            "A validated failure probability is not available for this "
            "synthetic machine. The historical predictor requires compatible "
            "historical machine identifiers and telemetry."
        ),
    }


def _dispatch_tool(
    name: str,
    arguments: dict[str, Any],
    selected_machine_id: str,
) -> dict[str, Any]:
    if name == "analyze_machine":
        if arguments.get("machine_id") != selected_machine_id:
            return {
                "error": "Tools may only access the selected machine."
            }

        return _analyze_machine(selected_machine_id)

    if name == "compare_maintenance_options":
        return evaluate_options()

    if name == "get_failure_risk":
        if arguments.get("machine_id") != selected_machine_id:
            return {
                "error": "Tools may only access the selected machine."
            }

        return _get_failure_risk(selected_machine_id)

    return {"error": "Unknown tool."}


def _response_payload(
    answer: str,
    machine_id: str,
    model: str,
    tools_used: list[str],
) -> dict[str, Any]:
    return {
        "answer": answer,
        "machineId": machine_id,
        "model": model,
        "provider": "AMD Token Factory",
        "tools_used": tools_used,
        "status": "completed",
        "data_status": "synthetic_demo",
        "requires_human_approval": True,
    }


def run_maintenance_agent(
    message: str,
    machine_id: str,
) -> dict[str, Any]:
    if machine_id not in set(machine_ids()):
        raise ValueError(f"Unknown synthetic machine: {machine_id}")

    client: OpenAI = get_amd_client()
    model = get_amd_model()

    messages: list[dict[str, Any]] = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {
            "role": "user",
            "content": (
                f"Selected machine: {machine_id}\n"
                f"Operator question: {message}"
            ),
        },
    ]

    tools_used: list[str] = []

    try:
        for _ in range(MAX_TOOL_ROUNDS):
            response = client.chat.completions.create(
                model=model,
                messages=messages,
                tools=TOOLS,
                tool_choice="auto",
                parallel_tool_calls=True,
                temperature=0,
                max_tokens=900,
            )

            if not response.choices:
                raise RuntimeError("AMD returned an empty response.")

            assistant_message = response.choices[0].message

            if not assistant_message.tool_calls:
                answer = assistant_message.content or (
                    "The model returned no explanation. Please retry."
                )

                return _response_payload(
                    answer=answer,
                    machine_id=machine_id,
                    model=response.model or model,
                    tools_used=tools_used,
                )

            messages.append(
                assistant_message.model_dump(exclude_none=True)
            )

            for tool_call in assistant_message.tool_calls:
                tool_name = tool_call.function.name

                try:
                    arguments = json.loads(
                        tool_call.function.arguments
                    )

                    if not isinstance(arguments, dict):
                        raise ValueError(
                            "Tool arguments must be an object."
                        )

                    result = _dispatch_tool(
                        tool_name,
                        arguments,
                        machine_id,
                    )

                    if tool_name not in tools_used:
                        tools_used.append(tool_name)

                except (ValueError, TypeError, json.JSONDecodeError):
                    result = {"error": "Invalid tool arguments."}

                except Exception:
                    logging.exception(
                        "ForgeMind tool execution failed: %s",
                        tool_name,
                    )
                    result = {
                        "error": (
                            "The requested tool failed. "
                            "Its result is unavailable."
                        )
                    }

                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": tool_call.id,
                        "content": json.dumps(result, default=str),
                    }
                )

        # Final answer without additional tool calls.
        final_response = client.chat.completions.create(
            model=model,
            messages=messages,
            temperature=0,
            max_tokens=900,
        )

        if not final_response.choices:
            raise RuntimeError("AMD returned an empty final response.")

        answer = final_response.choices[0].message.content or (
            "The investigation could not produce a final explanation. "
            "Please retry."
        )

        return _response_payload(
            answer=answer,
            machine_id=machine_id,
            model=final_response.model or model,
            tools_used=tools_used,
        )

    except APITimeoutError as exc:
        logging.exception("AMD Token Factory request timed out.")
        raise RuntimeError(
            "AMD inference timed out. The provider may be busy; please retry."
        ) from exc

    except APIError as exc:
        status_code = getattr(exc, "status_code", None)

        logging.exception(
            "AMD Token Factory API error. Type: %s; HTTP status: %s",
            type(exc).__name__,
            status_code,
        )

        raise RuntimeError(
            f"AMD inference failed ({type(exc).__name__}, "
            f"HTTP status: {status_code}). Check the backend terminal."
        ) from exc
