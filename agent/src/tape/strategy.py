"""Candidate construction from real chain snapshots.

Shapes verified live against the official MCP server (Sep 1): chain entries are
{symbol: OCC, latestQuote: {bp, ap}, greeks?, impliedVolatility?}. Strike, type,
and expiration are encoded in the OCC symbol and parsed here.
"""

from __future__ import annotations

import re
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable

WIDTHS = (1, 2, 5)
OTM_OFFSETS = (0.005, 0.01, 0.015, 0.02, 0.03)  # short-leg distance from spot

_OCC = re.compile(r"^(?P<root>[A-Z]+)(?P<date>\d{6})(?P<cp>[CP])(?P<strike>\d{8})$")


def parse_occ(symbol: str) -> dict | None:
    m = _OCC.match((symbol or "").strip().upper())
    if not m:
        return None
    exp = datetime.strptime(m.group("date"), "%y%m%d").date()
    return {
        "expiration": exp.isoformat(),
        "type": "call" if m.group("cp") == "C" else "put",
        "strike": int(m.group("strike")) / 1000.0,
    }


def normalize_contract(raw: dict) -> dict | None:
    """Snapshot-shaped record -> flat contract. Returns None when the OCC
    symbol is unparseable (no strike/type/expiration anywhere else)."""
    if not isinstance(raw, dict):
        return None
    symbol = raw.get("symbol")
    occ = parse_occ(symbol)
    if not occ:
        return None
    quote = raw.get("latestQuote") or raw.get("quote") or {}
    greeks = raw.get("greeks") or {}
    return {
        "symbol": symbol,
        "strike": occ["strike"],
        "type": occ["type"],
        "expiration": occ["expiration"],
        "delta": _f(greeks.get("delta")),
        "iv": _f(raw.get("impliedVolatility") or greeks.get("iv")),
        "bid": _f(quote.get("bp")),
        "ask": _f(quote.get("ap")),
    }


def _f(v: Any) -> float | None:
    try:
        return float(v) if v is not None else None
    except (TypeError, ValueError):
        return None


def dte_from(expiration: str | None, today: date | None = None) -> int | None:
    if not expiration:
        return None
    today = today or datetime.now(timezone.utc).date()
    try:
        d = date.fromisoformat(expiration)
    except ValueError:
        return None
    return (d - today).days


def _nearest(pool: list[dict], target: float) -> dict | None:
    return min(pool, key=lambda c: abs(c["strike"] - target), default=None)


def _quotes(contract: dict, snapshot_fetch: Callable[[str], dict | None] | None) -> dict | None:
    if contract["bid"] is not None and contract["ask"] is not None and contract["ask"] >= contract["bid"] > 0:
        bid, ask = contract["bid"], contract["ask"]
    elif snapshot_fetch:
        snap = normalize_contract(snapshot_fetch(contract["symbol"]) or {})
        if not snap or snap["bid"] is None or snap["ask"] is None:
            return None
        bid, ask = snap["bid"], snap["ask"]
    else:
        return None
    return {"bid": bid, "ask": ask, "mid": round((bid + ask) / 2, 3)}


def build_candidates(
    underlying: str,
    underlying_price: float,
    contracts: list[dict],
    *,
    max_dte: int = 5,
    top_n: int = 6,
    snapshot_fetch: Callable[[str], dict | None] | None = None,
) -> list[dict]:
    """Short legs at fixed OTM offsets (Greeks may be absent on the free feed:
    moneyness is the primary selector, delta the check when present)."""
    norm = [c for c in (normalize_contract(c) for c in contracts) if c]
    for c in norm:
        c["dte"] = dte_from(c["expiration"])
    norm = [c for c in norm if c["dte"] is not None and 0 <= c["dte"] <= max_dte]

    candidates: list[dict] = []
    for kind in ("put", "call"):
        pool_all = [c for c in norm if c["type"] == kind]
        expiries = sorted({c["expiration"] for c in pool_all})
        for expiry in expiries:
            pool = [c for c in pool_all if c["expiration"] == expiry]  # same-expiry legs only
            for off in OTM_OFFSETS:
                target = underlying_price * ((1 - off) if kind == "put" else (1 + off))
                short = _nearest(pool, target)
                if not short or short["delta"] is not None and not (0.10 <= abs(short["delta"]) <= 0.40):
                    continue
                if abs(short["strike"] - target) / underlying_price > 0.01:  # within 1% of target
                    continue
                for width in WIDTHS:
                    long_target = short["strike"] - width if kind == "put" else short["strike"] + width
                    long = _nearest([p for p in pool if p is not short], long_target)
                    if not long or abs(long["strike"] - long_target) > 1e-6:
                        continue
                    short_q, long_q = _quotes(short, snapshot_fetch), _quotes(long, snapshot_fetch)
                    if not (short_q and long_q):
                        continue
                    credit = round(short_q["mid"] - long_q["mid"], 2)
                    if credit <= 0.05:
                        continue
                    candidates.append(
                        _candidate(underlying, kind, short, long, width, credit, short_q, long_q, underlying_price)
                    )
    best: dict[str, dict] = {}
    for cand in candidates:
        key = f"{cand['expiration']}-{cand['short_strike']}-{cand['structure']}"
        if key not in best or cand["ctw"] > best[key]["ctw"]:
            best[key] = cand
    return sorted(best.values(), key=lambda x: -x["ctw"])[:top_n]


def _candidate(underlying, kind, short, long, width, credit, short_q, long_q, spot) -> dict:
    structure = "bull_put_spread" if kind == "put" else "bear_call_spread"
    itm_pct = (
        max(0.0, (spot - short["strike"]) / spot * 100)
        if kind == "put"
        else max(0.0, (short["strike"] - spot) / spot * 100)
    )
    return {
        "candidate_id": f"{underlying}-{short['expiration']}-{kind[0].upper()}{short['strike']:g}W{width}",
        "underlying": underlying,
        "structure": structure,
        "dte": short["dte"],
        "short_delta": short["delta"],
        "width": float(width),
        "credit": credit,
        "ctw": round(credit / width, 3),
        "iv": short["iv"],
        "expiration": short["expiration"],
        "short_strike": short["strike"],
        "short_itm_pct": round(itm_pct, 3),
        "legs": [
            {
                "symbol": short["symbol"],
                "side": "sell",
                "position_intent": "sell_to_open",
                "ratio_qty": 1,
                "bid": short_q["bid"],
                "ask": short_q["ask"],
            },
            {
                "symbol": long["symbol"],
                "side": "buy",
                "position_intent": "buy_to_open",
                "ratio_qty": 1,
                "bid": long_q["bid"],
                "ask": long_q["ask"],
            },
        ],
        "leg_quotes": [
            {"symbol": short["symbol"], "bid": short_q["bid"], "ask": short_q["ask"]},
            {"symbol": long["symbol"], "bid": long_q["bid"], "ask": long_q["ask"]},
        ],
    }


def close_marks(leg_snapshots: list[dict]) -> float | None:
    """Cost to close a short credit structure: mid(short) - mid(long) per unit."""
    if len(leg_snapshots) < 2:
        return None

    def mid(entry: dict) -> float | None:
        q = normalize_contract(entry.get("raw", entry) or {})
        if not q or q["bid"] is None or q["ask"] is None:
            return None
        return (q["bid"] + q["ask"]) / 2

    shorts = [mid(s) for s in leg_snapshots if s.get("role") == "short"]
    longs = [mid(s) for s in leg_snapshots if s.get("role") == "long"]
    if not all(shorts) or not all(longs):
        return None
    return round(sum(shorts) - sum(longs), 3)
