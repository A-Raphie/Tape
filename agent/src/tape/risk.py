"""The risk desk: deterministic gates. The LLM proposes; these gates dispose.

Every evaluation (pass or block) is journaled with per-gate values, because a
blocked trade with visible reasons is as much the product as a filled one.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone

# Limits (fractions of equity unless noted). Sizing is ours, never the LLM's.
PER_TRADE_MAX_LOSS = 0.025  # 2.5% NAV per structure
AGGREGATE_MAX_LOSS = 0.20  # 20% NAV total open risk
DAILY_HALT_LOSS = 0.04  # 4% NAV realized loss in a session -> halt + flatten
TP_FRACTION = 0.50  # take profit at 50% of credit received
_SL_MULTIPLE = 1.5  # stop loss at 1.5x credit received
LAST_ENTRY_MINUTES = 30  # no new risk in the last 30 minutes of a session
ENTRY_SLIPPAGE = 0.03  # credit given up vs mid so limit entries are marketable (paper fills only when marketable)
MAX_DTE = 5
DELTA_BAND = (0.10, 0.40)  # absolute delta of the short leg
MAX_STRUCTURES_PER_UNDERLYING = 2
MAX_SHORT_ITM_PCT = 1.0  # short strike may be at most 1% ITM (pin guard)
FLATTEN_DEADLINE_UTC = (16, 45)  # Friday flatten-all: 16:45 UTC (12:45 ET)
MIN_OPTION_PRICE = 0.05  # ignore quotes wider than a nickel


@dataclass
class GateReport:
    approved: bool = True
    gates: list[dict] = field(default_factory=list)

    def check(self, name: str, passed: bool, value) -> None:
        self.gates.append({"gate": name, "pass": bool(passed), "value": value})
        if not passed:
            self.approved = False


def session_halted(daily_realized_pnl: float, equity: float) -> bool:
    return daily_realized_pnl <= -DAILY_HALT_LOSS * equity


def is_flatten_deadline(now: datetime | None = None) -> bool:
    now = now or datetime.now(timezone.utc)
    return now.weekday() == 4 and (now.hour, now.minute) >= FLATTEN_DEADLINE_UTC


def evaluate(
    proposal: dict,
    *,
    equity: float,
    clock: dict,
    open_trades: list[dict],
    daily_realized_pnl: float,
    now: datetime | None = None,
) -> GateReport:
    """proposal keys: underlying, structure, qty, credit (per unit, positive=
    credit), width (per unit max loss before credit), short_delta, dte,
    leg_quotes [{symbol, bid, ask}] for both legs."""
    now = now or datetime.now(timezone.utc)
    r = GateReport()
    max_loss_unit = max(proposal["width"] - proposal.get("credit", 0.0), 0.0)
    max_loss = max_loss_unit * 100 * proposal["qty"]

    r.check("market_open", clock.get("is_open", False), clock.get("timestamp"))
    minutes_to_close = clock.get("minutes_to_close")
    r.check(
        "not_last_30min",
        minutes_to_close is None or minutes_to_close > LAST_ENTRY_MINUTES,
        {"minutes_to_close": minutes_to_close},
    )
    r.check(
        "per_trade_max_loss",
        max_loss <= PER_TRADE_MAX_LOSS * equity,
        {"max_loss": round(max_loss, 2), "cap": round(PER_TRADE_MAX_LOSS * equity, 2)},
    )
    aggregate = sum(
        (t.get("max_loss") or 0) for t in open_trades if t.get("status") == "open"
    ) + max_loss
    r.check(
        "aggregate_risk",
        aggregate <= AGGREGATE_MAX_LOSS * equity,
        {"aggregate": round(aggregate, 2), "cap": round(AGGREGATE_MAX_LOSS * equity, 2)},
    )
    r.check(
        "daily_halt",
        not session_halted(daily_realized_pnl, equity),
        {"daily_realized_pnl": round(daily_realized_pnl, 2)},
    )
    d = abs(proposal["short_delta"]) if proposal.get("short_delta") is not None else None
    if d is not None:
        r.check("delta_band", DELTA_BAND[0] <= d <= DELTA_BAND[1], round(d, 3))
    else:
        # Free indicative feed may omit Greeks (verified Sep 1): the moneyness
        # gate below carries the selection instead. Logged honestly as n/a.
        r.check("delta_band", True, "n/a: greeks absent, moneyness-selected")
    r.check("dte", 0 <= proposal.get("dte", 99) <= MAX_DTE, proposal.get("dte"))
    from .strategy import parse_occ

    leg_exps = sorted({(parse_occ(l.get("symbol", "")) or {}).get("expiration", "?") for l in proposal.get("legs", [])})
    r.check("same_expiry", len(leg_exps) <= 1, leg_exps or "no legs")
    same = [t for t in open_trades if t["underlying"] == proposal["underlying"] and t["status"] == "open"]
    r.check(
        "per_underlying_limit",
        len(same) < MAX_STRUCTURES_PER_UNDERLYING,
        {"open": len(same), "cap": MAX_STRUCTURES_PER_UNDERLYING},
    )
    r.check(
        "short_not_deep_itm",
        (proposal.get("short_itm_pct") or 0) <= MAX_SHORT_ITM_PCT,
        proposal.get("short_itm_pct"),
    )
    quotes_ok = all(
        q and q.get("bid") and q.get("ask") and (q["ask"] - q["bid"]) <= MIN_OPTION_PRICE * 2
        for q in proposal.get("leg_quotes", [])
    ) and len(proposal.get("leg_quotes", [])) >= 2
    r.check("liquidity", quotes_ok, proposal.get("leg_quotes"))
    r.check(
        "credit_positive",
        proposal.get("credit", 0) > 0,
        proposal.get("credit"),
    )
    r.check("flatten_deadline", not is_flatten_deadline(now), now.isoformat())
    return r


def exits_for(credit: float) -> tuple[float, float]:
    """TP/SL marks for a credit structure, per unit."""
    return (TP_FRACTION * credit, _SL_MULTIPLE * credit)
