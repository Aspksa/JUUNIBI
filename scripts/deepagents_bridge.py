"""Opt-in Deep Agents / Cloud.ru experiment for JUUNIBI.

Run in a separate Python environment. Never expose the API key to the web client.
The default Deep Agents filesystem backend is virtual; no shell tool is attached.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path


def load_settings() -> tuple[str, str, str]:
    from dotenv import load_dotenv

    root = Path(__file__).resolve().parents[1]
    load_dotenv(root / ".env", override=False)
    key = os.getenv("CLOUDRU_API_KEY", "").strip()
    model = os.getenv("CLOUDRU_MODEL", "").strip()
    base_url = os.getenv(
        "CLOUDRU_BASE_URL", "https://foundation-models.api.cloud.ru/v1"
    ).strip()
    if not key:
        raise ValueError("CLOUDRU_API_KEY is missing from the server environment")
    if not model:
        raise ValueError("CLOUDRU_MODEL is missing from the server environment")
    if not base_url.startswith("https://"):
        raise ValueError("CLOUDRU_BASE_URL must use https")
    return key, model, base_url


def run(prompt: str) -> str:
    if not prompt.strip():
        raise ValueError("The task prompt must not be empty")
    from deepagents import create_deep_agent
    from langchain_openai import ChatOpenAI

    api_key, model_name, base_url = load_settings()
    llm = ChatOpenAI(
        model=model_name,
        api_key=api_key,
        base_url=base_url,
        temperature=0,
        timeout=60,
        max_retries=2,
    )
    agent = create_deep_agent(
        model=llm,
        system_prompt=(
            "You are JUUNIBI's opt-in research and planning agent. "
            "Work only within the agent's virtual workspace. "
            "Never claim you modified the host filesystem, ran shell commands, "
            "deployed changes, or accessed real services unless verified by a tool."
        ),
    )
    result = agent.invoke(
        {"messages": [{"role": "user", "content": prompt}]},
        config={"recursion_limit": 40},
    )
    messages = result.get("messages", [])
    if not messages:
        raise RuntimeError("Agent returned no messages")
    content = messages[-1].content
    return content if isinstance(content, str) else json.dumps(content, ensure_ascii=False)


def main() -> int:
    parser = argparse.ArgumentParser(description="JUUNIBI Deep Agents trial")
    parser.add_argument("prompt", help="Research/planning task for the agent")
    args = parser.parse_args()
    try:
        answer = run(args.prompt)
    except Exception as exc:
        # Do not print provider exception details: SDK errors can embed sensitive data.
        print(f"Deep Agents failed ({type(exc).__name__}). Check local logs/configuration.", file=sys.stderr)
        return 1
    print(answer)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
