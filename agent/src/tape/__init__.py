"""Tape: a proof-carrying options desk on Alpaca paper trading.

Every consequential action (MCP call, gate evaluation, LLM judgment, reconcile
run) lands in the journal as a numbered receipt. The account is ground truth;
the journal is the claim; reconciliation is the product.
"""

__version__ = "0.1.0"

import os
from pathlib import Path


def load_env(path: str | None = None) -> None:
    """Minimal .env loader: KEY=VALUE lines, no interpolation."""
    p = Path(path or (Path(__file__).resolve().parents[2] / ".env"))
    if not p.exists():
        return
    for line in p.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip())
