
"""AMD Token Factory client for ForgeMind."""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI

# Load the repository-root .env without printing secrets.
ROOT_DIR = Path(__file__).resolve().parents[2]
load_dotenv(ROOT_DIR / ".env", override=False)

AMD_BASE_URL = "https://developer.amd.com.cn/radeon/api/v1"


@lru_cache(maxsize=1)
def get_amd_client() -> OpenAI:
    """Create and cache the AMD Token Factory client."""
    api_key = os.getenv("RADEON_API_KEY") or os.getenv("AMD_API_KEY")

    if not api_key or not api_key.strip():
        raise RuntimeError(
            "AMD API key is missing. Configure RADEON_API_KEY in the "
            "repository-root .env file."
        )

    return OpenAI(
        base_url=AMD_BASE_URL,
        api_key=api_key.strip(),
        timeout=90.0,
        max_retries=1,
    )


def get_amd_model() -> str:
    """Return the configured model name."""
    return os.getenv("FORGEMIND_AMD_MODEL", "DeepSeek-V4-Flash")
