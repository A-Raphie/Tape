"""The desk loop: one cycle every poll while the market runs.

Cycle = snapshot -> reconcile -> manage opens -> (scan window) candidates ->
analyst -> gates -> execute. Every step already journals its own receipts.
"""

from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone

from . import risk
from .analyst import Analyst
from .executor import Executor
from .journal import Journal, utc_now
from .strategy import build_candidates, close_marks

UNIVERSE = ["SPY", "QQQ"]
SCAN_EVERY = 15 * 60  # new-candidate scan window
POLL = 60


def _f(v) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


class Desk:
    def __init__(self, journal: Journal, executor: Executor, analyst: Analyst | None):
        self.j = journal
        self.ex = executor
        self.analyst = analyst
        self._last_scan = 0.0
        self._halted = False

    # -- main --------------------------------------------------------------

    def run_forever(self, poll: int = POLL) -> None:
        while True:
            serial = self.j.receipt("cycle", {"at": utc_now()})
            try:
                self.cycle()
            except Exception as exc:  # never die on one bad cycle
                self.j.receipt("cycle_error", {"error": repr(exc)}, ok=False)
            time.sleep(poll)

    def cycle(self) -> None:
        clock = self.ex.clock() or {}
        account = self.ex.account() or {}
        equity = _f(account.get("equity"))
        cash = _f(account.get("cash") or account.get("buying_power"))
        self.j.snapshot_account(equity, cash, {"raw": str(account)[:4000]})
        self.reconcile()

        daily = self._daily_realized()
        if risk.session_halted(daily, equity) and not self._halted:
            self._halted = True
            self.j.receipt("halt", {"daily_realized": daily, "equity": equity}, ok=False)
            self.flatten_all("daily_halt")
        if self._halted:
            return
        if risk.is_flatten_deadline():
            self.flatten_all("flatten_deadline")
            return

        self.manage_open()

        is_open = bool(clock.get("is_open"))
        if is_open and (time.time() - self._last_scan) >= SCAN_EVERY:
            self._last_scan = time.time()
            self.scan_and_trade(equity, clock, daily)

    # -- reconcile ----------------------------------------------------------

    def reconcile(self) -> bool:
        """Journal claims vs account ground truth. This table IS the product."""
        positions = self.ex.positions()
        pos_symbols = {p.get("symbol") or p.get("asset_id") for p in positions}
        pos_symbols = {s for s in pos_symbols if s}
        open_trades = self.j.trades("open")
        journal_symbols = set()
        for t in open_trades:
            for leg in t["legs"]:
                journal_symbols.add(leg["symbol"])
        diffs = []
        for s in sorted(pos_symbols - journal_symbols):
            diffs.append({"type": "position_without_receipt", "symbol": s})
        for s in sorted(journal_symbols - pos_symbols):
            diffs.append({"type": "receipt_without_position", "symbol": s})
        clean = not diffs
        self.j.reconcile(clean, diffs)
        return clean

    # -- trade management ---------------------------------------------------

    def _daily_realized(self) -> float:
        total = 0.0
        for t in self.j.trades("closed"):
            if (t.get("closed_at") or "").startswith(datetime.now(timezone.utc).date().isoformat()):
                total += _f(t.get("realized_pnl"))
        return total

    def manage_open(self) -> None:
        for t in self.j.trades("open"):
            try:
                self._manage_one(t)
            except Exception as exc:
                self.j.receipt("manage_error", {"trade": t["trade_id"], "error": repr(exc)}, ok=False)

    def _manage_one(self, t: dict) -> None:
        snaps = []
        for leg in t["legs"]:
            raw = self.ex.snapshot(leg["symbol"])
            if raw is None:
                continue
            if isinstance(raw, dict):
                snaps.append({"role": "short" if leg["side"] == "sell" else "long", "raw": raw})
        cost = close_marks(snaps) if snaps else None
        if cost is None:
            return
        tp, sl = risk.exits_for(_f(t["credit"]))
        qty = int(t["qty"])
        current = _f(t["credit"]) - cost  # captured so far, per unit
        if cost <= tp:
            self._close(t, reason=f"tp_hit: cost {cost} <= tp {tp}", close_cost=cost)
        elif cost >= sl:
            self._close(t, reason=f"sl_hit: cost {cost} >= sl {sl}", close_cost=cost)

    def _close(self, t: dict, reason: str, close_cost: float) -> None:
        serial = self.j.receipt("close_intent", {"trade": t["trade_id"], "reason": reason})
        for leg in t["legs"]:
            self.ex.close_leg(leg["symbol"], int(t["qty"]), from_side=leg["side"])
            time.sleep(1.0)  # pace per-leg closes
        realized = (_f(t["credit"]) - close_cost) * 100 * int(t["qty"])
        self.j.close_trade(t["trade_id"], round(realized, 2), serial)
        self.j.receipt("trade_closed", {"trade": t["trade_id"], "reason": reason, "realized": realized})

    def flatten_all(self, reason: str) -> None:
        serial = self.j.receipt("flatten_all", {"reason": reason})
        for t in self.j.trades("open"):
            cost = 0.0
            self._close(t, reason=f"flatten:{reason}", close_cost=cost)

    # -- entries ------------------------------------------------------------

    def scan_and_trade(self, equity: float, clock: dict, daily_realized: float) -> None:
        candidates = []
        today = datetime.now(timezone.utc).date()
        exp_lte = (today + timedelta(days=risk.MAX_DTE)).isoformat()
        for sym in UNIVERSE:
            price = self.ex.stock_quote(sym)
            if not price:
                continue
            chain = self.ex.option_chain(
                sym,
                exp_gte=today.isoformat(),
                exp_lte=exp_lte,
                strike_gte=round(price * 0.88),
                strike_lte=round(price * 1.12),
            )
            cands = build_candidates(sym, price, chain, snapshot_fetch=self.ex.snapshot)
            candidates.extend(cands)
        if not candidates:
            self.j.receipt("scan", {"note": "no candidates", "universe": UNIVERSE})
            return

        if self.analyst is None:
            picks = {"picks": [], "rejects": []}
        else:
            try:
                picks = self.analyst.judge(candidates)
            except Exception as exc:  # analyst hiccup never kills the cycle
                self.j.receipt("analyst_error", {"error": repr(exc)}, ok=False)
                picks = {"picks": [], "rejects": []}
        self.j.receipt("scan", {"candidates": len(candidates), "picks": picks})

        by_id = {c["candidate_id"]: c for c in candidates}
        for pick in picks.get("picks", []):
            c = by_id.get(pick["candidate_id"])
            if not c:
                continue
            self._try_enter(c, pick.get("thesis", ""), equity, clock, daily_realized)

    def _try_enter(self, c: dict, thesis: str, equity: float, clock: dict, daily_realized: float) -> None:
        max_loss_unit = max(c["width"] - c["credit"], 0.0)
        if max_loss_unit <= 0:
            return
        qty = max(1, int((risk.PER_TRADE_MAX_LOSS * equity) // (max_loss_unit * 100)))
        proposal = {**c, "qty": qty}
        report = risk.evaluate(
            proposal,
            equity=equity,
            clock=clock,
            open_trades=self.j.trades(),
            daily_realized_pnl=daily_realized,
        )
        serial = self.j.receipt("entry_proposal", {"proposal": proposal, "thesis": thesis})
        self.j.gate_eval(serial, proposal, report.approved, report.gates)
        if not report.approved:
            return
        legs = c["legs"]
        client_id = f"tape-{serial:04d}-{int(time.time())}"
        result = self.ex.place_credit_spread(legs, qty, c["credit"], client_order_id=client_id)
        order_ids = _order_ids(result)
        trade_id = f"T-{serial:04d}"
        self.j.open_trade(
            {
                "trade_id": trade_id,
                "serial_open": serial,
                "underlying": c["underlying"],
                "structure": c["structure"],
                "legs": str(legs).replace("'", '"'),
                "qty": qty,
                "credit": c["credit"],
                "max_loss": round(max_loss_unit * 100 * qty, 2),
                "thesis": thesis,
                "status": "open",
                "tp_price": round(risk.TP_FRACTION * c["credit"], 2),
                "sl_price": round(1.5 * c["credit"], 2),
                "opened_at": utc_now(),
                "closed_at": None,
                "realized_pnl": None,
                "serial_close": None,
            }
        )
        self.j.receipt("trade_opened", {"trade": trade_id, "order_ids": order_ids, "qty": qty})


def _order_ids(result) -> list[str]:
    if isinstance(result, dict):
        oid = result.get("id") or result.get("order_id")
        return [str(oid)] if oid else []
    if isinstance(result, list):
        out = []
        for r in result:
            out.extend(_order_ids(r))
        return out
    return []
