"""NVIDIA NIM client for ForgeMind's hosted assistant."""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI

# Load the repository-root .env without printing secrets.
ROOT_DIR = Path(__file__).resolve().parents[2]
load_dotenv(ROOT_DIR / ".env", override=False)

NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1"
DEFAULT_NVIDIA_MODEL = "nvidia/llama-3.3-nemotron-super-49b-v1"


@lru_cache(maxsize=1)
def get_nvidia_client() -> OpenAI:
    """Create and cache the OpenAI-compatible NVIDIA NIM client."""
    api_key = os.getenv("NVIDIA_API_KEY")

    if not api_key or not api_key.strip():
        raise RuntimeError(
            "NVIDIA API key is missing. Configure NVIDIA_API_KEY in the "
            "repository-root .env file."
        )

    return OpenAI(
        base_url=os.getenv("FORGEMIND_NVIDIA_BASE_URL", NVIDIA_BASE_URL),
        api_key=api_key.strip(),
        timeout=90.0,
        max_retries=1,
    )


def get_nvidia_model() -> str:
    """Return the configured NVIDIA NIM model ID."""
    return os.getenv("FORGEMIND_NVIDIA_MODEL", DEFAULT_NVIDIA_MODEL)
