"""The analyst: ranks gated candidates and writes the plain-English thesis.

The LLM never sizes. It picks from candidates that already exist (structure,
width, credit are computed from real quotes) and must cite the numbers it used.
Output shape is enforced by schema here, gates in risk.py, receipts everywhere.
"""

from __future__ import annotations

from .llm import Llm

SYSTEM = """You are the analyst of a defined-risk options desk running on an Alpaca paper account.
You are given candidate credit spreads built from real chain quotes. Your job:
1. Pick AT MOST the top {max_picks} candidates worth trading today.
2. For each pick write a thesis of 2-3 plain sentences a smart friend could follow.
   Cite the actual numbers given to you (delta, credit, width, DTE, IV).
3. Explicitly reject the rest with one-line reasons.

Rules you must obey in your picks:
- Never propose changing size, strikes, or width: pick or reject the candidate as given.
- Prefer short legs near the delta band's middle when two candidates are similar.
- If nothing is compelling, pick nothing and say so.

Respond ONLY as JSON:
{{"picks":[{{"candidate_id":"...","thesis":"..."}}],"rejects":[{{"candidate_id":"...","reason":"..."}}]}}
"""


class Analyst:
    def __init__(self, llm: Llm):
        self.llm = llm

    def judge(self, candidates: list[dict], max_picks: int = 2) -> dict:
        if not candidates:
            return {"picks": [], "rejects": []}
        lines = []
        for c in candidates:
            lines.append(
                "candidate_id={candidate_id} underlying={underlying} structure={structure} "
                "dte={dte} short_delta={short_delta} width={width} credit={credit} "
                "credit_to_width={ctw} iv_short={iv} exp={expiration}".format(**{**_defaults(), **c})
            )
        user = (
            "Market context: US equity options, paper account, event risk this week.\n"
            "Candidates (credit per unit, width per unit):\n" + "\n".join(lines) +
            "\n\nPick at most {}.".format(max_picks)
        )
        out = self.llm.complete_json(SYSTEM.format(max_picks=max_picks), user)
        valid_ids = {c["candidate_id"] for c in candidates}
        picks = [p for p in out.get("picks", []) if p.get("candidate_id") in valid_ids]
        rejects = [r for r in out.get("rejects", []) if r.get("candidate_id") in valid_ids]
        return {"picks": picks[:max_picks], "rejects": rejects}


def _defaults() -> dict:
    return {"iv": None, "short_delta": None, "expiration": "?"}
