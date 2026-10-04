#!/usr/bin/env python3
"""
fill-vo.py — Fetch live Tape data, fill vo-template.txt, write vo.txt.

Usage:
    python3 fill-vo.py                  # fetch from tape.up.railway.app
    python3 fill-vo.py --local          # fetch from localhost:8000
    python3 fill-vo.py --offline        # use hardcoded values (no API)
    python3 fill-vo.py --equity 98000 --trades 11 --receipts 13500 ...

Offline/manual flags override the API.
"""
import argparse, json, os, re, sys
from pathlib import Path
from urllib.request import urlopen

DEMO_DIR = Path(__file__).parent
TEMPLATE = DEMO_DIR / "vo-template.txt"
OUTPUT   = DEMO_DIR / "vo.txt"

API_URLS = {
    "remote": "https://tape.up.railway.app/api/state",
    "local":  "http://localhost:8000/api/state",
}

def fetch_state(base_url: str) -> dict:
    try:
        with urlopen(base_url, timeout=10) as r:
            return json.loads(r.read())
    except Exception as e:
        print(f"  warn: API unreachable ({e})", file=sys.stderr)
        return {}

def compute_fill(state: dict, overrides: dict) -> dict:
    """Map API state + CLI overrides into template placeholders."""
    equity  = overrides.get("equity")  or state.get("equity", 98000)
    trades  = overrides.get("trades")  or state.get("trades", 0)
    receipts = overrides.get("receipts") or state.get("receipts", 10000)
    lessons = overrides.get("lessons") or state.get("lessons", 10)

    open_count = overrides.get("open") or state.get("open_trades", 0)
    open_word = "spread" if open_count == 1 else "spreads"

    # today_pnl: derive from equity vs 100K starting
    if "pnl" in overrides:
        pnl_str = overrides["pnl"]
    else:
        pnl_val = 100000 - equity  # positive = loss
        if abs(pnl_val) < 100:
            pnl_str = "Flat over two days"
        elif pnl_val > 0:
            pnl_str = f"Down about {round(pnl_val)} over two days"
        else:
            pnl_str = f"Up about {round(abs(pnl_val))} over two days"

    # blocked: estimate from trades + gate_evals or use known
    blocked = overrides.get("blocked") or 22  # conservative default

    return {
        "{open_count}":   str(open_count),
        "{open_word}":    open_word,
        "{today_pnl}":    pnl_str,
        "{blocked_count}": str(blocked),
        "{lesson_count}": str(lessons),
        "{receipt_count}": f"{receipts:,}",
    }

def fill_template(template_text: str, fills: dict) -> str:
    result = template_text
    for placeholder, value in fills.items():
        result = result.replace(placeholder, value)
    # warn on unfilled placeholders
    leftover = re.findall(r"\{[a-z_]+\}", result)
    if leftover:
        print(f"  warn: unfilled placeholders: {leftover}", file=sys.stderr)
    return result

def main():
    p = argparse.ArgumentParser(description="Fill VO template from live data")
    p.add_argument("--local",    action="store_true", help="Use localhost API")
    p.add_argument("--offline",  action="store_true", help="Skip API, use defaults")
    p.add_argument("--equity",   type=float, help="Account equity override")
    p.add_argument("--trades",   type=int,   help="Total closed trades")
    p.add_argument("--open",     type=int,   help="Currently open trades")
    p.add_argument("--receipts", type=int,   help="Total receipts")
    p.add_argument("--lessons",  type=int,   help="Total lessons")
    p.add_argument("--blocked",  type=int,   help="Blocked proposals count")
    p.add_argument("--pnl",      type=str,   help="P&L string override (e.g. 'down about 2000')")
    p.add_argument("--out",      type=str,   help="Output file (default: vo.txt)")
    args = p.parse_args()

    # 1. fetch state
    if args.offline:
        state = {}
        print("  mode: offline (defaults)")
    else:
        url = API_URLS["local"] if args.local else API_URLS["remote"]
        print(f"  fetching: {url}")
        state = fetch_state(url)
        if state:
            print(f"  equity={state.get('equity')} trades={state.get('trades')} receipts={state.get('receipts')}")
        else:
            print("  using defaults (API unreachable)")

    # 2. compute fills
    overrides = {k: v for k, v in {
        "equity": args.equity, "trades": args.trades, "open": args.open,
        "receipts": args.receipts, "lessons": args.lessons,
        "blocked": args.blocked, "pnl": args.pnl,
    }.items() if v is not None}

    fills = compute_fill(state, overrides)

    # 3. fill template
    template = TEMPLATE.read_text()
    filled = fill_template(template, fills)

    # 4. write output
    out_path = Path(args.out) if args.out else OUTPUT
    out_path.write_text(filled)
    print(f"  wrote: {out_path}")
    print()
    print(filled)

if __name__ == "__main__":
    main()
