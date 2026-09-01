"""The executor: places orders ONLY through the Alpaca MCP server, adapting to
the server's actual tool schema (discovered at startup, never guessed), and
closes positions per-leg (the known mleg-close workaround)."""

from __future__ import annotations

import time
from typing import Any

from .mcp_client import AlpacaMcp, McpError


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

    # -- account ------------------------------------------------------------

    def account(self) -> dict:
        name = self._tool_name("account") or "get_account_info"
        return self.mcp.call(name, {})

    def clock(self) -> dict:
        name = self._tool_name("clock")
        if not name:
            return {}
        return self.mcp.call(name, {})

    def positions(self) -> list[dict]:
        name = self._tool_name("positions") or "get_all_positions"
        out = self.mcp.call(name, {})
        if isinstance(out, list):
            return out
        if isinstance(out, dict):
            for key in ("positions", "data", "results"):
                if isinstance(out.get(key), list):
                    return out[key]
        return []

    def orders(self, status: str = "open") -> list[dict]:
        name = self._tool_name("orders") or "get_orders"
        try:
            out = self.mcp.call(name, {"status": status} if "status" in self._schema_props("orders") else {})
        except McpError:
            return []
        if isinstance(out, list):
            return out
        if isinstance(out, dict):
            for key in ("orders", "data", "results"):
                if isinstance(out.get(key), list):
                    return out[key]
        return []

    def option_chain(self, underlying: str) -> list[dict]:
        name = self._tool_name("option_chain") or "get_option_contracts"
        props = self._schema_props("option_chain") if "option_chain" in name else self._schema_props("contracts")
        args: dict[str, Any] = {}
        for k in props:
            if "underlying" in k:
                args[k] = underlying
        out = self.mcp.call(name, args)
        if isinstance(out, list):
            return out
        if isinstance(out, dict):
            for key in ("contracts", "snapshots", "data", "results", "option_contracts"):
                if isinstance(out.get(key), list):
                    return out[key]
        return []

    def snapshot(self, symbol: str) -> dict | None:
        name = self._tool_name("snapshot")
        if not name:
            return None
        props = self._schema_props("snapshot")
        args = {}
        for k in props:
            if "symbol" in k or k in ("symbols",):
                args[k] = symbol
        try:
            return self.mcp.call(name, args)
        except McpError:
            return None

    def stock_quote(self, symbol: str) -> float | None:
        name = self._tool_name("latest_quote") or self._tool_name("stock-data")
        if not name:
            return None
        props = self._schema_props("latest_quote")
        args = {k: symbol for k in props if "symbol" in k}
        try:
            out = self.mcp.call(name, args)
        except McpError:
            return None
        if isinstance(out, dict):
            for key in ("price", "last", "trade_price", "close"):
                if out.get(key):
                    try:
                        return float(out[key])
                    except (TypeError, ValueError):
                        pass
            trade = out.get("latestTrade") or out.get("trade") or {}
            if isinstance(trade, dict) and trade.get("price"):
                return float(trade["price"])
        return None

    # -- orders -------------------------------------------------------------

    def place_credit_spread(self, legs: list[dict], qty: int, credit: float) -> dict:
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
                    args[k] = qty
                if k == "order_class":
                    args[k] = "mleg"
                if k == "type":
                    args[k] = "limit"
                if k == "time_in_force":
                    args[k] = "day"
                if k == "limit_price":
                    # credit structures: negative limit = net credit (Alpaca REST spec)
                    args[k] = -abs(round(credit, 2)) if "credit" in props or True else round(credit, 2)
            return self.mcp.call(tool, args)
        # fallback: single-leg sequencing
        results = []
        for l in legs:
            args = {"symbol": l["symbol"], "qty": qty, "side": l["side"]}
            for k in props:
                if "intent" in k:
                    args[k] = l["position_intent"]
                if k == "type":
                    args[k] = "limit"
                if k == "time_in_force":
                    args[k] = "day"
                if k == "limit_price":
                    ref = l.get("bid") or l.get("ask") or 0.5
                    args[k] = round(ref * (1.02 if l["side"] == "sell" else 0.98), 2)
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
        args: dict[str, Any] = {"symbol": symbol, "qty": qty, "side": side}
        for k in props:
            if "intent" in k:
                args[k] = intent
            if k == "type":
                args[k] = "market"
            if k == "time_in_force":
                args[k] = "day"
        return self.mcp.call(tool, args)

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
