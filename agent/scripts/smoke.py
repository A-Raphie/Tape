"""Smoke test against a DEV paper account. Requires .env with Alpaca keys.

Usage: .venv/bin/python scripts/smoke.py [--trade]
Prints the real MCP tool list + schemas, account, clock, SPY chain shape,
built candidates. With --trade: opens a 1-lot spread from the best candidate
and reports the order response (per-leg closes are exercised by the desk).
"""

import json
import sys
import time
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))


def _today() -> str:
    return date.today().isoformat()


def _plus_days(n: int) -> str:
    return (date.today() + timedelta(days=n)).isoformat()

from tape import load_env  # noqa: E402
from tape.executor import Executor  # noqa: E402
from tape.journal import Journal  # noqa: E402
from tape.mcp_client import AlpacaMcp  # noqa: E402
from tape.strategy import build_candidates  # noqa: E402


def main() -> None:
    do_trade = "--trade" in sys.argv
    load_env()
    journal = Journal(db_path="./smoke.db")
    mcp = AlpacaMcp(journal)
    mcp.start()
    try:
        print("== TOOLS ==")
        for t in mcp.tools:
            props = ",".join((t.get("inputSchema") or {}).get("properties", {}).keys())
            print(f'{t["name"]}: {props}')
        ex = Executor(mcp)
        print("== ACCOUNT ==")
        print(json.dumps(ex.account(), default=str)[:800])
        print("== CLOCK ==")
        print(json.dumps(ex.clock(), default=str)[:300])
        price = ex.stock_quote("SPY")
        print(f"== SPY REFERENCE PRICE == {price}")
        chain = ex.option_chain(
            "SPY",
            exp_gte=_today(),
            exp_lte=_plus_days(5),
            strike_gte=round(price * 0.88) if price else None,
            strike_lte=round(price * 1.12) if price else None,
        )
        print(f"== CHAIN SPY == {len(chain)} raw records")
        if chain:
            print(json.dumps(chain[0], default=str)[:600])
        if chain and price:
            cands = build_candidates("SPY", price, chain, snapshot_fetch=ex.snapshot)
            print(f"== CANDIDATES == {len(cands)}")
            for c in cands[:3]:
                keys = ("candidate_id", "structure", "dte", "short_delta", "width", "credit", "ctw")
                print(json.dumps({k: c.get(k) for k in keys}))
            if do_trade and cands:
                best = cands[0]
                print(f"== PLACING 1-LOT == {best['candidate_id']}")
                result = ex.place_credit_spread(
                    best["legs"],
                    1,
                    best["credit"],
                    client_order_id=f"tape-smoke-{int(time.time())}",
                    order_type="market",  # lifecycle proof: fill now, manage later
                )
                print(json.dumps(result, default=str)[:600])
                oid = None
                if isinstance(result, dict):
                    oid = result.get("id") or result.get("order_id")
                if oid:
                    status = ex.wait_fill(oid, timeout=60)
                    print(f"== FILL STATUS == {status}")
                    if status != "filled":
                        print("== CANCELLING UNFILLED ==")
                        print(json.dumps(ex.cancel_order(oid), default=str)[:300])
                print("== POSITIONS ==")
                positions = ex.positions()
                print(json.dumps(positions, default=str)[:400])
                if positions:
                    print("== CLOSING LEGS ==")
                    for leg in best["legs"]:
                        out = ex.close_leg(leg["symbol"], 1, from_side=leg["side"])
                        print(json.dumps(out, default=str)[:300])
                    print("== POSITIONS AFTER CLOSE ==")
                    print(json.dumps(ex.positions(), default=str)[:400])
    finally:
        mcp.stop()


if __name__ == "__main__":
    main()
