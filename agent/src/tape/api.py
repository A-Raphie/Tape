"""FastAPI sidecar: serves the built panel (panel/out) and the journal API.
The panel hydrates ONLY from here; every endpoint is a read over the journal
DB or the live account snapshot the desk persists."""

from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .journal import Journal

PANEL_OUT = Path(__file__).resolve().parents[3] / "panel" / "out"


@lru_cache(maxsize=1)
def journal() -> Journal:
    return Journal()


app = FastAPI(title="Tape desk API", docs_url=None, redoc_url=None)


def _loads(text: str | None) -> object:
    if not text:
        return None
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return text


@app.get("/api/state")
def state():
    j = journal()
    snaps = j.equity_series(limit=1)
    counts = j.counts()
    equity = snaps[-1]["equity"] if snaps else None
    cash = None
    if snaps:
        rows = j.query("SELECT cash FROM account_snapshots ORDER BY ts DESC LIMIT 1")
        cash = rows[0]["cash"] if rows else None
    from .market_hours import clock_now

    clock = clock_now()
    return {
        "equity": equity,
        "cash": cash,
        "market_open": clock["is_open"],
        "minutes_to_close": clock["minutes_to_close"],
        "last_action": (j.receipts(limit=1)[0]["ts"] if counts["receipts"] else None),
        **counts,
    }


@app.get("/api/equity")
def equity(limit: int = 300):
    return {"points": journal().equity_series(limit=limit)}


@app.get("/api/receipts")
def receipts(limit: int = Query(40, le=300)):
    return {"receipts": journal().receipts(limit=limit)}


@app.get("/api/trades")
def trades():
    return {"trades": journal().trades()}


@app.get("/api/gate_evals")
def gate_evals(limit: int = Query(40, le=200)):
    rows = journal().query(
        "SELECT id,ts,serial,proposal,approved,reasons FROM gate_evals ORDER BY id DESC LIMIT ?", (limit,)
    )
    return {
        "gate_evals": [
            {
                "id": r["id"],
                "ts": r["ts"],
                "serial": r["serial"],
                "proposal": _loads(r["proposal"]),
                "approved": bool(r["approved"]),
                "reasons": _loads(r["reasons"]) or [],
            }
            for r in rows
        ]
    }


@app.get("/api/reconcile")
def reconcile(limit: int = Query(20, le=100)):
    rows = journal().query(
        "SELECT serial AS id, ts, payload FROM receipts WHERE kind='reconcile' ORDER BY serial DESC LIMIT ?", (limit,)
    )
    runs = []
    for r in rows:
        payload = _loads(r["payload"]) or {}
        runs.append(
            {
                "id": r["id"],
                "ts": r["ts"],
                "clean": payload.get("clean"),
                "diffs": payload.get("diffs") or [],
            }
        )
    return {"runs": runs}


@app.get("/api/lessons")
def lessons():
    return {"lessons": journal().lessons()}


@app.get("/api/serial/{serial}")
def one_receipt(serial: int):
    row = journal().query("SELECT * FROM receipts WHERE serial=?", (serial,))
    if not row:
        raise HTTPException(404, "no such receipt")
    d = dict(row[0])
    d["payload"] = _loads(d["payload"])
    return d


# static panel last: /out from `next build` (static export)
if PANEL_OUT.exists():
    app.mount("/_next", StaticFiles(directory=PANEL_OUT / "_next"), name="next")
    app.mount("/desk", StaticFiles(directory=PANEL_OUT / "desk", html=True), name="desk")

    @app.get("/")
    def index():
        return FileResponse(PANEL_OUT / "index.html")
