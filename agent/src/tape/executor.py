"""The executor: places orders ONLY through the Alpaca MCP server, adapting to
the server's actual tool schema (discovered at startup, never guessed), and
closes positions per-leg (the known mleg-close workaround)."""

from __future__ import annotations

import time
from typing import Any

from .mcp_client import AlpacaMcp, McpError
from .risk import ENTRY_SLIPPAGE


class Executor:
    def __init__(self, mcp: AlpacaMcp):
        self.mcp = mcp

    # -- schema discovery ---------------------------------------------------

    def _tool(self, name_part: str) -> dict | None:
        for t in self.mcp.tools:
            if name_part in t.get("name", ""):
                return t
        return None

    def _tool_name(self, name_part: str) -> str | None:
        t = self._tool(name_part)
        return t["name"] if t else None

    def _schema_props(self, name_part: str) -> set[str]:
        t = self._tool(name_part)
        if not t:
            return set()
        return set((t.get("inputSchema") or {}).get("properties", {}).keys())

    # -- account + clock ------------------------------------------------------

    def account(self) -> dict:
        name = self._tool_name("get_account_info") or "account"
        return self.mcp.call(name, {})

    def clock(self) -> dict:
        """No clock tool on the server (verified Sep 1): derive US regular
        hours locally. Sep run = EDT = UTC-4, so 13:30-20:00 UTC, Mon-Fri."""
        from .market_hours import clock_now

        return clock_now()

    def positions(self) -> list[dict]:
        """get_all_positions proved unreliable on this server (returns empty
        while get_open_position shows holdings, Sep 1/2): retry, then fall
        back to netting today's fill activities, then per-symbol checks."""
        import time as _time

        for attempt in range(3):
            out = self.mcp.call("get_all_positions", {})
            rows = out if isinstance(out, list) else []
            if isinstance(out, dict):
                for key in ("positions", "data", "results"):
                    if isinstance(out.get(key), list):
                        rows = out[key]
            if rows:
                return rows
            _time.sleep(1.5)
        return self._positions_from_activities()

    def _positions_from_activities(self) -> list[dict]:
        """Net FILL activities per symbol into pseudo-positions. A symbol with
        zero net qty is genuinely flat; nonzero nets are real holdings."""
        try:
            acts = self.mcp.call("get_account_activities", {"page_size": 200})
        except McpError:
            return []
        items = acts if isinstance(acts, list) else (acts.get("result") or acts.get("activities") or [])
        net: dict[str, float] = {}
        for a in items:
            if a.get("activity_type") != "FILL":
                continue
            sym = a.get("symbol")
            qty = float(a.get("qty") or 0)
            side = a.get("side") or ""
            signed = -qty if side in ("sell", "sell_short") else qty
            net[sym] = round(net.get(sym, 0.0) + signed, 6)
        out = []
        for sym, qty in net.items():
            if abs(qty) < 1e-9:
                continue
            out.append({"symbol": sym, "qty": str(abs(int(qty))), "side": "short" if qty < 0 else "long", "source": "activities_net"})
        return out

    def holding(self, symbol: str) -> bool:
        """Authoritative per-symbol check (get_open_position)."""
        try:
            self.mcp.call("get_open_position", {"symbol_or_asset_id": symbol})
            return True
        except McpError:
            return False

    def orders(self, status: str = "open") -> list[dict]:
        props = self._schema_props("get_orders")
        args = {"status": status} if "status" in props else {}
        try:
            out = self.mcp.call("get_orders", args)
        except McpError:
            return []
        if isinstance(out, list):
            return out
        if isinstance(out, dict):
            for key in ("orders", "data", "results"):
                if isinstance(out.get(key), list):
                    return out[key]
        return []

    # -- market data (shapes verified live Sep 1) -----------------------------

    def stock_quote(self, symbol: str) -> float | None:
        out = self.mcp.call("get_stock_latest_quote", {"symbols": symbol})
        quotes = out.get("quotes", {}) if isinstance(out, dict) else {}
        q = quotes.get(symbol) or {}
        bid, ask = q.get("bp"), q.get("ap")
        if bid and ask:
            return round((float(bid) + float(ask)) / 2, 2)
        return None

    def option_chain(
        self,
        underlying: str,
        *,
        exp_gte: str | None = None,
        exp_lte: str | None = None,
        opt_type: str | None = None,
        strike_gte: float | None = None,
        strike_lte: float | None = None,
        limit: int = 500,
    ) -> list[dict]:
        """Returns a list of {symbol, latestQuote, greeks?, impliedVolatility?}
        dicts; contract metadata is encoded in the OCC symbol and parsed in
        strategy.parse_occ."""
        args: dict[str, Any] = {"underlying_symbol": underlying, "limit": limit}
        if exp_gte:
            args["expiration_date_gte"] = exp_gte
        if exp_lte:
            args["expiration_date_lte"] = exp_lte
        if opt_type:
            args["type"] = opt_type
        if strike_gte:
            args["strike_price_gte"] = strike_gte
        if strike_lte:
            args["strike_price_lte"] = strike_lte
        out = self.mcp.call("get_option_chain", args)
        snaps = out.get("snapshots", {}) if isinstance(out, dict) else {}
        if isinstance(snaps, dict):
            return [{"symbol": sym, **(payload or {})} for sym, payload in snaps.items()]
        if isinstance(snaps, list):
            return snaps
        return []

    def snapshot(self, symbol: str) -> dict | None:
        out = self.mcp.call("get_option_snapshot", {"symbols": symbol})
        snaps = out.get("snapshots", {}) if isinstance(out, dict) else {}
        payload = snaps.get(symbol) if isinstance(snaps, dict) else None
        return {"symbol": symbol, **(payload or {})} if payload else None

    # -- orders -------------------------------------------------------------

    def place_credit_spread(
        self,
        legs: list[dict],
        qty: int,
        credit: float,
        client_order_id: str | None = None,
        order_type: str = "limit",
    ) -> dict:
        """legs: [{symbol, side: buy|sell, position_intent, ratio_qty}]. Uses
        mleg if the tool schema supports it; otherwise two single-leg orders
        sequenced on fill (never simultaneous)."""
        tool = self._tool_name("place_option_order")
        if not tool:
            raise McpError("no option order tool found on MCP server")
        props = self._schema_props("place_option_order")
        args: dict[str, Any] = {}
        if "legs" in props:
            args["legs"] = [
                {
                    "symbol": l["symbol"],
                    "side": l["side"],
                    "position_intent": l["position_intent"],
                    "ratio_qty": str(l.get("ratio_qty", 1)),
                }
                for l in legs
            ]
            for k in props:
                if k == "qty" or "quantity" in k:
                    args[k] = str(qty)
                if k == "order_class":
                    args[k] = "mleg"
                if k == "type":
                    args[k] = order_type
                if k == "time_in_force":
                    args[k] = "day"
                if k == "limit_price" and order_type == "limit":
                    # marketable credit: mid minus slippage (paper fills only
                    # when marketable); negative limit = net credit; strings only
                    args[k] = str(-abs(round(credit - ENTRY_SLIPPAGE, 2)))
            if client_order_id and "client_order_id" in props:
                args["client_order_id"] = client_order_id
            return self.mcp.call(tool, args)
        # fallback: single-leg sequencing
        results = []
        for l in legs:
            args = {"symbol": l["symbol"], "qty": str(qty), "side": l["side"]}
            for k in props:
                if "intent" in k:
                    args[k] = l["position_intent"]
                if k == "type":
                    args[k] = "limit"
                if k == "time_in_force":
                    args[k] = "day"
                if k == "limit_price":
                    ref = l.get("bid") or l.get("ask") or 0.5
                    args[k] = str(round(ref * (1.02 if l["side"] == "sell" else 0.98), 2))
            results.append(self.mcp.call(tool, args))
            time.sleep(1.0)  # pace: avoid rapid-opposing-order rejections
        return results

    def close_leg(self, symbol: str, qty: int, from_side: str) -> dict:
        """Close one leg: sell_to_close what we bought, buy_to_close what we sold."""
        tool = self._tool_name("place_option_order")
        if not tool:
            raise McpError("no option order tool found on MCP server")
        props = self._schema_props("place_option_order")
        intent = "sell_to_close" if from_side == "buy" else "buy_to_close"
        side = "sell" if from_side == "buy" else "buy"
        args: dict[str, Any] = {"symbol": symbol, "qty": str(qty), "side": side}
        for k in props:
            if "intent" in k:
                args[k] = intent
            if k == "type":
                args[k] = "market"
            if k == "time_in_force":
                args[k] = "day"
        return self.mcp.call(tool, args)

    def cancel_order(self, order_id: str) -> dict:
        return self.mcp.call("cancel_order_by_id", {"order_id": order_id})

    def wait_fill(self, order_id: str, timeout: float = 90.0) -> str:
        """State-driven fill wait: poll the order by id until terminal."""
        name = self._tool_name("order")  # get_order_by_id-ish
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                if name:
                    out = self.mcp.call(name, {"order_id": order_id} if "order_id" in self._schema_props("order") else {"id": order_id})
                    status = out.get("status") if isinstance(out, dict) else None
                    if status in ("filled", "canceled", "expired", "rejected"):
                        return status
                else:
                    for o in self.orders(status="open"):
                        if o.get("id") == order_id:
                            break
                    else:
                        return "filled_or_gone"
            except McpError:
                pass
            time.sleep(3.0)
        return "timeout"
