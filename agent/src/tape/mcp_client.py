"""stdio JSON-RPC client for the official Alpaca MCP server (uvx alpaca-mcp-server).

Every tool call becomes a journal receipt BEFORE the call is attempted (intent)
and is updated with the outcome after. Nothing touches the account without a
serial number attached.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import threading
import time
from typing import Any

from .journal import Journal

PROTOCOL_VERSION = "2024-11-05"


class McpError(RuntimeError):
    pass


class AlpacaMcp:
    """One long-lived subprocess; requests are strictly serialized (MCP stdio
    allows one in-flight request; we keep a lock around call+read)."""

    def __init__(self, journal: Journal, command: list[str] | None = None):
        self.journal = journal
        # The container bakes alpaca-mcp-server via pip (fast cold boots);
        # locally we fall back to uvx. TAPE_MCP_COMMAND overrides both.
        override = os.environ.get("TAPE_MCP_COMMAND")
        if override:
            self.command = override.split()
        elif shutil.which("alpaca-mcp-server"):
            self.command = ["alpaca-mcp-server"]
        else:
            self.command = ["uvx", "alpaca-mcp-server"]
        self._proc: subprocess.Popen | None = None
        self._id = 0
        self._lock = threading.Lock()
        self._reader_lock = threading.Lock()
        self.tools: list[dict] = []

    # -- lifecycle --------------------------------------------------------

    def start(self) -> None:
        """Cold starts re-download the server via uvx (fresh containers have
        no cache): retry the whole spawn+handshake, generously timed."""
        last: Exception | None = None
        for attempt in range(3):
            try:
                self._start_once(timeout=240.0 if attempt == 0 else 90.0)
                return
            except (McpError, OSError) as exc:
                last = exc
                self.stop()
                time.sleep(3.0)
        raise McpError(f"MCP server failed to start after 3 attempts: {last}")

    def _start_once(self, timeout: float) -> None:
        env = dict(os.environ)
        env.setdefault("ALPACA_PAPER_TRADE", "true")  # paper only, ever
        env.setdefault("ALPACA_TOOLSETS", "account,trading,options-data,stock-data")
        self._proc = subprocess.Popen(
            self.command,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
            env=env,
        )
        self._send(
            {
                "jsonrpc": "2.0",
                "id": self._next_id(),
                "method": "initialize",
                "params": {
                    "protocolVersion": PROTOCOL_VERSION,
                    "capabilities": {},
                    "clientInfo": {"name": "tape-agent", "version": "0.1.0"},
                },
            }
        )
        self._read_response(timeout=timeout)
        self._send({"jsonrpc": "2.0", "method": "notifications/initialized"})
        self.tools = self.list_tools()

    def stop(self) -> None:
        if self._proc:
            try:
                self._proc.terminate()
                self._proc.wait(timeout=5)
            except Exception:
                self._proc.kill()
            self._proc = None

    def __enter__(self) -> "AlpacaMcp":
        self.start()
        return self

    def __exit__(self, *exc) -> None:
        self.stop()

    # -- transport --------------------------------------------------------

    def _next_id(self) -> int:
        self._id += 1
        return self._id

    def _send(self, msg: dict) -> None:
        assert self._proc and self._proc.stdin
        self._proc.stdin.write(json.dumps(msg) + "\n")
        self._proc.stdin.flush()

    def _read_response(self, want_id: int | None = None, timeout: float = 60.0) -> dict:
        assert self._proc and self._proc.stdout
        deadline = time.time() + timeout
        while time.time() < deadline:
            line = self._proc.stdout.readline()
            if not line:
                raise McpError("MCP server closed stdout")
            line = line.strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
            except json.JSONDecodeError:
                continue  # server banners/noise on stdout
            if "id" not in msg:  # notification from server
                continue
            if want_id is None or msg["id"] == want_id:
                return msg
        raise McpError(f"MCP timeout after {timeout}s (want_id={want_id})")

    # -- API --------------------------------------------------------------

    def list_tools(self) -> list[dict]:
        with self._lock:
            rid = self._next_id()
            self._send({"jsonrpc": "2.0", "id": rid, "method": "tools/list"})
            resp = self._read_response(rid)
            self.tools = resp.get("result", {}).get("tools", [])
            return self.tools

    def call(self, tool: str, arguments: dict[str, Any] | None = None, timeout: float = 60.0) -> Any:
        """Call a tool, journal the receipt (intent + outcome), return the
        parsed content. Raises McpError on tool-level errors."""
        arguments = arguments or {}
        started = time.time()
        with self._lock:
            rid = self._next_id()
            self._send(
                {
                    "jsonrpc": "2.0",
                    "id": rid,
                    "method": "tools/call",
                    "params": {"name": tool, "arguments": arguments},
                }
            )
            try:
                resp = self._read_response(rid, timeout=timeout)
            except McpError as exc:
                self.journal.receipt(
                    "mcp_call",
                    {"tool": tool, "arguments": arguments, "error": str(exc)},
                    tool=tool,
                    ok=False,
                )
                raise
            latency = int((time.time() - started) * 1000)
            if "error" in resp:
                self.journal.receipt(
                    "mcp_call",
                    {"tool": tool, "arguments": arguments, "error": resp["error"]},
                    tool=tool,
                    ok=False,
                    latency_ms=latency,
                )
                raise McpError(f"{tool}: {resp['error']}")
            result = resp.get("result", {})
            ok = not result.get("isError", False)
            self.journal.receipt(
                "mcp_call",
                {
                    "tool": tool,
                    "arguments": arguments,
                    "result": _trim(_content_text(result)),
                },
                tool=tool,
                ok=ok,
                latency_ms=latency,
            )
            if not ok:
                raise McpError(f"{tool} tool error: {_content_text(result)[:500]}")
            return _unwrap_envelope(_parse_content(result))
        # unreachable


def _unwrap_envelope(value: Any) -> Any:
    """The official server wraps payloads two ways (verified Sep 1):
    {_alpaca_mcp_security, data} on reads, and {result: X[, next_page_token]}
    on list/mutation endpoints. Return the inner payload; keep wrappers out of
    downstream parsers. get_all_positions additionally proved unreliable
    (empty while get_open_position shows positions) — reconcile uses both."""
    if isinstance(value, dict):
        if "_alpaca_mcp_security" in value and "data" in value:
            return value["data"]
        if "result" in value and len(value) <= 2:
            return value["result"]
    return value


def _content_text(result: dict) -> str:
    parts = []
    for item in result.get("content", []):
        if item.get("type") == "text":
            parts.append(item.get("text", ""))
    return "\n".join(parts)


def _trim(text: str, limit: int = 8000) -> str:
    return text if len(text) <= limit else text[:limit] + f"... [{len(text)} chars total]"


def _parse_content(result: dict) -> Any:
    """MCP text content is usually JSON; fall back to raw text."""
    text = _content_text(result)
    stripped = text.strip()
    if not stripped:
        return None
    try:
        return json.loads(stripped)
    except json.JSONDecodeError:
        return text
