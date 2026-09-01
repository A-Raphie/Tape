"use client";

/* The desk: the blotter IS the app. Ruled rows, live receipts, the receipt
   inspector, the reconcile honesty table. */

import Link from "next/link";
import { useState } from "react";
import { GateList, ReceiptModal, Sparkline, StatTile, TapeStrip, useApi, type Receipt, type Trade } from "../kit";

type GateEval = {
  id: number;
  ts: string;
  serial: number | null;
  proposal: Record<string, unknown>;
  approved: boolean;
  reasons: { gate: string; pass: boolean; value: unknown }[];
};

type ReconcileRun = { id: number; ts: string; clean: boolean; diffs: { type: string; symbol: string }[] };

type Lesson = { id: number; ts: string; trade_id: string | null; lesson: string; source: string };

export default function Desk() {
  const state = useApi<{ equity: number | null; cash: number | null; receipts: number; market_open: boolean; minutes_to_close: number | null }>("/api/state");
  const equity = useApi<{ points: { ts: string; equity: number }[] }>("/api/equity", 8000);
  const receiptsRes = useApi<{ receipts: Receipt[] }>("/api/receipts?limit=40");
  const tradesRes = useApi<{ trades: Trade[] }>("/api/trades");
  const gatesRes = useApi<{ gate_evals: GateEval[] }>("/api/gate_evals");
  const reconcileRes = useApi<{ runs: ReconcileRun[] }>("/api/reconcile", 8000);
  const lessonsRes = useApi<{ lessons: Lesson[] }>("/api/lessons", 15000);
  const [openReceipt, setOpenReceipt] = useState<Receipt | null>(null);

  const receipts = receiptsRes?.receipts ?? [];
  const trades = tradesRes?.trades ?? [];
  const openTrades = trades.filter((t) => t.status === "open");
  const closedTrades = trades.filter((t) => t.status === "closed");
  const blocks = (gatesRes?.gate_evals ?? []).filter((g) => !g.approved);
  const lastReconcile = reconcileRes?.runs?.[0];

  return (
    <main className="desk">
      <header className="desk-head">
        <div>
          <Link href="/" className="fd-name">
            Tape
          </Link>
          <span className="micro"> · the desk</span>
        </div>
        <span className={`stamp ${state?.market_open ? "stamp-match" : "stamp-neutral"}`}>
          {state?.market_open ? `OPEN · ${state.minutes_to_close ?? "?"} min to close` : "CLOSED"}
        </span>
      </header>

      <section className="desk-strip">
        <div className="micro">the tape · every action, in order, append-only</div>
        <TapeStrip receipts={receipts} />
      </section>

      <section className="desk-stats">
        <StatTile
          label="Equity"
          value={state?.equity != null ? `$${state.equity.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : "···"}
          sub={state?.cash != null ? `cash $${state.cash.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : undefined}
        />
        <div className="card desk-chart">
          <div className="micro">equity, per cycle</div>
          <Sparkline points={equity?.points ?? []} height={72} />
        </div>
        <StatTile label="Receipts" value={state ? String(state.receipts) : "···"} sub="serial-numbered" />
      </section>

      <section className="desk-section">
        <h2 className="section-title">Open structures</h2>
        {openTrades.length === 0 ? (
          <p className="caption empty-note">The desk is armed. When the analyst picks a candidate and the risk desk approves it, the structure lands here with its thesis attached.</p>
        ) : (
          <div className="card">
            {openTrades.map((t) => (
              <button key={t.trade_id} className="row row-btn" onClick={() => openSerial(receipts, t.serial_open, setOpenReceipt)}>
                <span className="serial">#{t.serial_open}</span>
                <span className="row-underlying">{t.underlying}</span>
                <span className="row-structure">{t.structure}</span>
                <span className="number-sm">x{t.qty}</span>
                <span className="number-sm">credit ${t.credit?.toFixed(2)}</span>
                <span className="caption">max loss ${t.max_loss.toFixed(2)}</span>
                <span className="stamp stamp-pending">OPEN</span>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="desk-section">
        <h2 className="section-title">Risk desk · blocked proposals</h2>
        {blocks.length === 0 ? (
          <p className="caption empty-note">No blocked proposals yet. Every block shows its gate-by-gate reasons here; blocks are receipts too.</p>
        ) : (
          <div className="card">
            {blocks.map((g) => (
              <div key={g.id} className="block-card">
                <div className="row row-head-static">
                  <span className="serial">#{g.serial}</span>
                  <span className="caption">{g.ts}</span>
                  <span className="stamp stamp-error">BLOCKED</span>
                  <span className="mono caption">{String((g.proposal as { candidate_id?: string }).candidate_id ?? "")}</span>
                </div>
                <GateList gates={g.reasons} />
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="desk-section">
        <h2 className="section-title">Closed</h2>
        {closedTrades.length === 0 ? (
          <p className="caption empty-note">Nothing closed yet. Exits land here with realized P&L and the receipt chain that proves them.</p>
        ) : (
          <div className="card">
            {closedTrades.map((t) => (
              <button key={t.trade_id} className="row row-btn" onClick={() => openSerial(receipts, t.serial_close ?? t.serial_open, setOpenReceipt)}>
                <span className="serial">#{t.serial_open}</span>
                <span className="row-underlying">{t.underlying}</span>
                <span className="row-structure">{t.structure}</span>
                <span className="number-sm">x{t.qty}</span>
                <span className={`number-sm ${(t.realized_pnl ?? 0) >= 0 ? "tone-up" : "tone-down"}`}>
                  {(t.realized_pnl ?? 0) >= 0 ? "+" : ""}${(t.realized_pnl ?? 0).toFixed(2)}
                </span>
                <span className="stamp stamp-neutral">CLOSED</span>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="desk-section">
        <h2 className="section-title">Reconcile · journal vs account</h2>
        {lastReconcile ? (
          <div className="card">
            <div className="row row-head-static">
              <span className={`stamp ${lastReconcile.clean ? "stamp-match" : "stamp-mismatch"}`}>{lastReconcile.clean ? "MATCH" : "MISMATCH"}</span>
              <span className="caption">{lastReconcile.ts}</span>
              <span className="caption">{lastReconcile.diffs.length} diffs on the latest pass</span>
            </div>
            {lastReconcile.diffs.map((d, i) => (
              <div key={i} className="row">
                <span className="stamp stamp-error">{d.type}</span>
                <span className="mono">{d.symbol}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="caption empty-note">First reconcile pass lands here within a minute of the desk starting.</p>
        )}
      </section>

      <section className="desk-section">
        <h2 className="section-title">Lessons · nightly grading</h2>
        {(lessonsRes?.lessons ?? []).length === 0 ? (
          <p className="caption empty-note">The scribe grades closed trades at the end of each session and writes what would change tomorrow.</p>
        ) : (
          <div className="card">
            {(lessonsRes?.lessons ?? []).map((l) => (
              <div key={l.id} className="row">
                <span className="mono caption">{l.trade_id ?? "desk"}</span>
                <span className="lesson-text">{l.lesson}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <ReceiptModal receipt={openReceipt} onClose={() => setOpenReceipt(null)} />
    </main>
  );
}

function openSerial(receipts: Receipt[], serial: number | null, set: (r: Receipt | null) => void) {
  if (serial == null) return;
  const hit = receipts.find((r) => r.serial === serial) ?? null;
  set(hit);
}
