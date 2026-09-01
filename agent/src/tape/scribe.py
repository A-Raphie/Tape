"""The scribe: nightly grading (closed trades -> lessons) and build-in-public
post drafts, all as receipts. Post drafts are drafts only; a human posts."""

from __future__ import annotations

from .analyst import Analyst
from .journal import Journal, utc_now

GRADE_SYSTEM = """You grade closed trades for a defined-risk options desk.
For each trade you get: structure, thesis, credit, realized pnl, exit reason.
Write ONE lesson per trade that would actually change tomorrow's behavior
(what to repeat, avoid, or watch). Plain sentences, no jargon walls.
Respond ONLY as JSON: {"lessons":[{"trade_id":"...","lesson":"..."}]}
If nothing closed, respond {"lessons":[]}."""


class Scribe:
    def __init__(self, journal: Journal, analyst: Analyst):
        self.j = journal
        self.llm = analyst.llm

    def grade_day(self) -> list[dict]:
        closed = [t for t in self.j.trades("closed") if not t.get("graded")]
        if not closed:
            return []
        rows = [
            {
                "trade_id": t["trade_id"],
                "structure": t["structure"],
                "underlying": t["underlying"],
                "thesis": t.get("thesis") or "",
                "credit": t.get("credit"),
                "realized_pnl": t.get("realized_pnl"),
            }
            for t in closed
        ]
        out = self.llm.complete_json(
            GRADE_SYSTEM,
            "Closed trades today:\n" + "\n".join(str(r) for r in rows),
            max_tokens=1200,
        )
        lessons = out.get("lessons", [])[:8]
        for l in lessons:
            self.j.lesson(l.get("trade_id"), l.get("lesson", ""), source="nightly_grade")
        self.j.receipt("scribe_grade", {"graded": len(rows), "lessons": len(lessons)})
        return lessons

    def post_draft(self, day_note: str = "") -> str:
        counts = self.j.counts()
        closed = self.j.trades("closed")
        wins = [t for t in closed if (t.get("realized_pnl") or 0) > 0]
        losses = [t for t in closed if (t.get("realized_pnl") or 0) <= 0]
        open_trades = self.j.trades("open")
        lines = [
            "Tape build log.",
            f"Receipts on the tape: {counts['receipts']} (MCP calls: {counts['mcp_calls']}).",
            f"Trades: {len(closed)} closed ({len(wins)} wins, {len(losses)} losses), {len(open_trades)} open.",
        ]
        if closed:
            best = max(closed, key=lambda t: t.get("realized_pnl") or 0)
            lines.append(
                f"Best: {best['structure']} on {best['underlying']}, receipt #{best['serial_open']}."
            )
        if day_note:
            lines.append(day_note)
        lines.append("The tape doesn't lie. Now the agent can't either.")
        lines.append("@lablabai @AlpacaHQ")
        draft = "\n".join(lines)
        self.j.receipt("scribe_post_draft", {"draft": draft})
        return draft
