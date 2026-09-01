"""Journal-as-receipts: SQLite + append-only JSONL mirror.

The serial number is the product. Anything the agent did that a judge might
want to verify gets a receipt here before it happens anywhere else.
"""

from __future__ import annotations

import json
import os
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path

_SCHEMA = """
CREATE TABLE IF NOT EXISTS receipts(
  serial INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  kind TEXT NOT NULL,
  tool TEXT,
  payload TEXT NOT NULL,
  ok INTEGER NOT NULL,
  latency_ms INTEGER
);
CREATE TABLE IF NOT EXISTS trades(
  trade_id TEXT PRIMARY KEY,
  serial_open INTEGER,
  underlying TEXT NOT NULL,
  structure TEXT NOT NULL,
  legs TEXT NOT NULL,
  qty INTEGER NOT NULL,
  credit REAL,
  max_loss REAL NOT NULL,
  thesis TEXT,
  status TEXT NOT NULL,
  tp_price REAL,
  sl_price REAL,
  opened_at TEXT,
  closed_at TEXT,
  realized_pnl REAL,
  serial_close INTEGER
);
CREATE TABLE IF NOT EXISTS account_snapshots(
  ts TEXT PRIMARY KEY,
  equity REAL,
  cash REAL,
  payload TEXT
);
CREATE TABLE IF NOT EXISTS gate_evals(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  serial INTEGER,
  proposal TEXT NOT NULL,
  approved INTEGER NOT NULL,
  reasons TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reconcile_runs(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  clean INTEGER NOT NULL,
  diffs TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS lessons(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  trade_id TEXT,
  lesson TEXT NOT NULL,
  source TEXT NOT NULL
);
"""


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class Journal:
    """Thread-safe receipt journal. SQLite is the query surface; JSONL is the
    append-only trail that survives even if SQLite is mid-write."""

    def __init__(self, db_path: str | None = None, jsonl_path: str | None = None):
        base = Path(os.environ.get("TAPE_DB", "./tape.db")).resolve()
        self.db_path = str(db_path or base)
        self.jsonl_path = jsonl_path or (base.with_suffix(".jsonl"))
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(self.db_path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.executescript(_SCHEMA)
        self._conn.commit()

    # -- receipts ---------------------------------------------------------

    def receipt(
        self,
        kind: str,
        payload: dict,
        *,
        tool: str | None = None,
        ok: bool = True,
        latency_ms: int | None = None,
    ) -> int:
        """Append a receipt, return its serial. The serial is what the panel
        and the receipts view are built from."""
        row = {
            "ts": utc_now(),
            "kind": kind,
            "tool": tool,
            "payload": json.dumps(payload, default=str)[:20000],
            "ok": 1 if ok else 0,
            "latency_ms": latency_ms,
        }
        with self._lock:
            cur = self._conn.execute(
                "INSERT INTO receipts(ts,kind,tool,payload,ok,latency_ms) VALUES(:ts,:kind,:tool,:payload,:ok,:latency_ms)",
                row,
            )
            self._conn.commit()
            serial = int(cur.lastrowid)
            with open(self.jsonl_path, "a") as fh:
                fh.write(json.dumps({"serial": serial, **row}, default=str) + "\n")
        return serial

    def receipts(self, limit: int = 100, kind: str | None = None) -> list[dict]:
        q = "SELECT * FROM receipts"
        args: list = []
        if kind:
            q += " WHERE kind=?"
            args.append(kind)
        q += " ORDER BY serial DESC LIMIT ?"
        args.append(limit)
        return [dict(r) for r in self._conn.execute(q, args).fetchall()]

    # -- trades -----------------------------------------------------------

    def open_trade(self, trade: dict) -> None:
        cols = ",".join(trade.keys())
        ph = ",".join(f":{k}" for k in trade)
        with self._lock:
            self._conn.execute(f"INSERT INTO trades({cols}) VALUES({ph})", trade)
            self._conn.commit()

    def close_trade(self, trade_id: str, realized_pnl: float, serial_close: int) -> None:
        with self._lock:
            self._conn.execute(
                "UPDATE trades SET status='closed', closed_at=?, realized_pnl=?, serial_close=? WHERE trade_id=?",
                (utc_now(), realized_pnl, serial_close, trade_id),
            )
            self._conn.commit()

    def trades(self, status: str | None = None) -> list[dict]:
        if status:
            rows = self._conn.execute(
                "SELECT * FROM trades WHERE status=? ORDER BY opened_at", (status,)
            ).fetchall()
        else:
            rows = self._conn.execute("SELECT * FROM trades ORDER BY opened_at").fetchall()
        out = []
        for r in rows:
            t = dict(r)
            t["legs"] = json.loads(t["legs"])
            out.append(t)
        return out

    # -- misc -------------------------------------------------------------

    def snapshot_account(self, equity: float, cash: float, payload: dict) -> None:
        with self._lock:
            self._conn.execute(
                "INSERT OR REPLACE INTO account_snapshots(ts,equity,cash,payload) VALUES(?,?,?,?)",
                (utc_now(), equity, cash, json.dumps(payload, default=str)[:20000]),
            )
            self._conn.commit()

    def equity_series(self, limit: int = 500) -> list[dict]:
        rows = self._conn.execute(
            "SELECT ts,equity FROM account_snapshots ORDER BY ts DESC LIMIT ?", (limit,)
        ).fetchall()
        return [{"ts": r["ts"], "equity": r["equity"]} for r in reversed(rows)]

    def gate_eval(self, serial: int, proposal: dict, approved: bool, reasons: list[dict]) -> None:
        with self._lock:
            self._conn.execute(
                "INSERT INTO gate_evals(ts,serial,proposal,approved,reasons) VALUES(?,?,?,?,?)",
                (utc_now(), serial, json.dumps(proposal, default=str), int(approved), json.dumps(reasons, default=str)),
            )
            self._conn.commit()

    def reconcile(self, clean: bool, diffs: list[dict]) -> int:
        return self.receipt(
            "reconcile",
            {"clean": clean, "diffs": diffs},
            ok=clean,
        )

    def lesson(self, trade_id: str | None, lesson: str, source: str) -> None:
        with self._lock:
            self._conn.execute(
                "INSERT INTO lessons(ts,trade_id,lesson,source) VALUES(?,?,?,?)",
                (utc_now(), trade_id, lesson, source),
            )
            self._conn.commit()

    def lessons(self) -> list[dict]:
        return [dict(r) for r in self._conn.execute("SELECT * FROM lessons ORDER BY id DESC").fetchall()]

    def counts(self) -> dict:
        def one(q: str) -> int:
            return int(self._conn.execute(q).fetchone()[0])

        return {
            "receipts": one("SELECT COUNT(*) FROM receipts"),
            "trades": one("SELECT COUNT(*) FROM trades"),
            "open_trades": one("SELECT COUNT(*) FROM trades WHERE status='open'"),
            "mcp_calls": one("SELECT COUNT(*) FROM receipts WHERE kind='mcp_call'"),
            "lessons": one("SELECT COUNT(*) FROM lessons"),
        }
