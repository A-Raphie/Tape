"""Groq/OpenAI-compatible JSON client (claimcheck-proven recipe).

8K TPM on the free tier is the real constraint: small prompts, json_object
mode, 429 backoff parsed from the body, hard cap on retries.
"""

from __future__ import annotations

import json
import os
import re
import time

import httpx

from .journal import Journal


class LlmError(RuntimeError):
    pass


class Llm:
    def __init__(self, journal: Journal | None = None):
        self.base = os.environ.get("TAPE_LLM_BASE", "https://api.groq.com/openai/v1").rstrip("/")
        self.key = os.environ.get("GROQ_API_KEY", "")
        self.model = os.environ.get("TAPE_MODEL", "openai/gpt-oss-120b")
        self.journal = journal
        self._client = httpx.Client(timeout=60.0)

    def complete_json(self, system: str, user: str, max_tokens: int = 1500) -> dict:
        if not self.key:
            raise LlmError("GROQ_API_KEY not set")
        body = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "response_format": {"type": "json_object"},
            "temperature": 0.2,
            "max_tokens": max_tokens,
        }
        headers = {"Authorization": f"Bearer {self.key}"}
        started = time.time()
        last_err = ""
        for attempt in range(6):
            try:
                resp = self._client.post(f"{self.base}/chat/completions", json=body, headers=headers)
            except httpx.HTTPError as exc:
                last_err = f"network: {exc}"
                time.sleep(min(2**attempt, 20))
                continue
            if resp.status_code == 429:
                wait = _retry_seconds(resp.text) or min(2**attempt * 2, 30)
                last_err = f"429: wait {wait}s"
                time.sleep(wait)
                continue
            if resp.status_code >= 500:
                last_err = f"{resp.status_code}"
                time.sleep(min(2**attempt, 10))
                continue
            if resp.status_code != 200:
                raise LlmError(f"{resp.status_code}: {resp.text[:300]}")
            text = resp.json()["choices"][0]["message"]["content"]
            if self.journal:
                self.journal.receipt(
                    "llm_judgment",
                    {"model": self.model, "system": system[:2000], "user": user[:6000], "output": text[:6000]},
                    latency_ms=int((time.time() - started) * 1000),
                )
            try:
                return json.loads(text)
            except json.JSONDecodeError:
                repaired = _outermost_json(text)
                if repaired is None:
                    raise LlmError(f"non-JSON output: {text[:200]}")
                return repaired
        raise LlmError(f"retries exhausted ({last_err})")


_RETRY_RE = re.compile(r"(?:try again in|retry in)\s*([0-9.]+)\s*(s|sec|seconds|ms)", re.I)


def _retry_seconds(body: str) -> float | None:
    m = _RETRY_RE.search(body or "")
    if not m:
        return None
    value = float(m.group(1))
    return value / 1000.0 if m.group(2).lower() == "ms" else value


def _outermost_json(text: str) -> dict | None:
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end <= start:
        return None
    try:
        parsed = json.loads(text[start : end + 1])
        return parsed if isinstance(parsed, dict) else None
    except json.JSONDecodeError:
        return None
