"""Candidate construction: real chain quotes -> defined-risk credit structures.

Pure functions over normalized contracts; the smoke test pins the exact Alpaca
field names (defensive normalization here, corrected once shapes are known).
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any, Callable

WIDTHS = (1, 2, 5)  # per-unit widths worth quoting (SPY-scale)


def normalize_contract(raw: dict) -> dict | None:
    """Best-effort normalization of an option contract/snapshot record."""
    if not isinstance(raw, dict):
        return None
    symbol = raw.get("symbol") or raw.get("contract_symbol") or raw.get("id")
    if not symbol:
        return None
    greeks = raw.get("greeks") or {}
    quote = raw.get("latestQuote") or raw.get("quote") or {}
    bid = _f(quote.get("bid") or raw.get("bid"))
    ask = _f(quote.get("ask") or raw.get("ask"))
    return {
        "symbol": symbol,
        "strike": _f(raw.get("strikePrice") or raw.get("strike")),
        "type": (raw.get("type") or raw.get("option_type") or "").lower(),  # call|put
        "expiration": raw.get("expirationDate") or raw.get("expiration") or raw.get("expired_at"),
        "delta": _f(greeks.get("delta") or raw.get("delta")),
        "iv": _f(raw.get("impliedVolatility") or raw.get("implied_volatility") or greeks.get("iv")),
        "bid": bid,
        "ask": ask,
        "open_interest": _i(raw.get("openInterest") or raw.get("open_interest")),
        "volume": _i(raw.get("volume")),
    }


def _f(v: Any) -> float | None:
    try:
        return float(v) if v is not None else None
    except (TypeError, ValueError):
        return None


def _i(v: Any) -> int | None:
    try:
        return int(v) if v is not None else None
    except (TypeError, ValueError):
        return None


def dte_from(expiration: str | None, today: date | None = None) -> int | None:
    if not expiration:
        return None
    today = today or datetime.now(timezone.utc).date()
    for fmt in ("%Y-%m-%d", "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%dT%H:%M:%S%z"):
        try:
            d = datetime.fromisoformat(expiration.replace("Z", "+00:00")).date() if "T" in expiration else datetime.strptime(expiration, fmt).date()
            return (d - today).days
        except ValueError:
            continue
    return None


def build_candidates(
    underlying: str,
    underlying_price: float,
    contracts: list[dict],
    *,
    max_dte: int = 5,
    top_n: int = 6,
    snapshot_fetch: Callable[[str], dict | None] | None = None,
) -> list[dict]:
    """Build put + call credit spread candidates from normalized contracts."""
    norm = [c for c in (normalize_contract(c) for c in contracts) if c and c["strike"] and c["expiration"]]
    for c in norm:
        c["dte"] = dte_from(c["expiration"])
    norm = [c for c in norm if c["dte"] is not None and 0 <= c["dte"] <= max_dte]

    candidates = []
    for c in ("put", "call"):
        # direction: puts below spot, calls above spot
        pool = [c_ for c_ in norm if c_["type"] == c]
        for short in pool:
            if short["delta"] is None:
                continue
            if c == "put" and not (0.10 <= abs(short["delta"]) <= 0.40 and short["strike"] < underlying_price):
                continue
            if c == "call" and not (0.10 <= abs(short["delta"]) <= 0.40 and short["strike"] > underlying_price):
                continue
            for width in WIDTHS:
                if c == "put":
                    long = next(
                        (l for l in pool if abs(l["strike"] - (short["strike"] - width)) < 1e-6), None
                    )
                else:
                    long = next(
                        (l for l in pool if abs(l["strike"] - (short["strike"] + width)) < 1e-6), None
                    )
                if not long:
                    continue
                short_q, long_q = _quotes(short, snapshot_fetch), _quotes(long, snapshot_fetch)
                if not (short_q and long_q):
                    continue
                credit = (short_q["mid"] - long_q["mid"])
                if credit <= 0.05:
                    continue
                ctw = credit / width  # return per unit of risk
                candidates.append(
                    {
                        "candidate_id": f"{underlying}-{short['expiration'][:10]}-{c[0].upper()}{int(short['strike'])}W{width}",
                        "underlying": underlying,
                        "structure": "bull_put_spread" if c == "put" else "bear_call_spread",
                        "dte": short["dte"],
                        "short_delta": short["delta"],
                        "width": float(width),
                        "credit": round(credit, 2),
                        "ctw": round(ctw, 3),
                        "iv": short["iv"],
                        "expiration": short["expiration"],
                        "short_strike": short["strike"],
                        "short_itm_pct": round(
                            max(0.0, (underlying_price - short["strike"]) / underlying_price * 100)
                            if c == "put"
                            else max(0.0, (short["strike"] - underlying_price) / underlying_price * 100),
                            3,
                        ),
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
                )
    # dedupe: keep best width per short strike, then rank by credit/width
    best: dict[str, dict] = {}
    for cand in candidates:
        key = f"{cand['underlying']}-{cand['expiration']}-{cand['short_strike']}-{cand['structure']}"
        if key not in best or cand["ctw"] > best[key]["ctw"]:
            best[key] = cand
    ranked = sorted(best.values(), key=lambda x: -x["ctw"])
    return ranked[:top_n]


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


def close_marks(leg_snapshots: list[dict]) -> float | None:
    """Cost to close a short-credit structure = mid(short) - mid(long) per unit."""
    if len(leg_snapshots) < 2:
        return None
    shorts = [s for s in leg_snapshots if s.get("role") == "short"]
    longs = [s for s in leg_snapshots if s.get("role") == "long"]
    if not shorts or not longs:
        return None
    def mid(s):
        q = normalize_contract(s.get("raw", s) or {})
        if not q or q["bid"] is None or q["ask"] is None:
            return None
        return (q["bid"] + q["ask"]) / 2
    short_mids = [m for m in (mid(s) for s in shorts) if m is not None]
    long_mids = [m for m in (mid(s) for s in longs) if m is not None]
    if len(short_mids) < len(shorts) or len(long_mids) < len(longs):
        return None
    return round(sum(short_mids) - sum(long_mids), 3)
