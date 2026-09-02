"use client";

/* The desk: the blotter IS the app. Ruled rows, live receipts, the receipt
   inspector, the reconcile honesty table. */

import Link from "next/link";
import { useState } from "react";
import { fetchReceipt, gateHuman, GateList, ReceiptModal, Sparkline, StatTile, TapeStrip, useApi, type Receipt, type Trade } from "../kit";

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

const money = (v: number) => `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function Desk() {
  const { data: state, stale } = useApi<{ equity: number | null; cash: number | null; receipts: number; market_open: boolean; minutes_to_close: number | null; last_action: string | null }>("/api/state");
  const { data: equity } = useApi<{ points: { ts: string; equity: number }[] }>("/api/equity", 8000);
  const { data: receiptsRes } = useApi<{ receipts: Receipt[] }>("/api/receipts?limit=40");
  const { data: tradesRes } = useApi<{ trades: Trade[] }>("/api/trades");
  const { data: gatesRes } = useApi<{ gate_evals: GateEval[] }>("/api/gate_evals");
  const { data: reconcileRes } = useApi<{ runs: ReconcileRun[] }>("/api/reconcile", 8000);
  const { data: lessonsRes } = useApi<{ lessons: Lesson[] }>("/api/lessons", 15000);
  const [openReceipt, setOpenReceipt] = useState<Receipt | null>(null);

  const receipts = receiptsRes?.receipts ?? [];
  const trades = tradesRes?.trades ?? [];
  const openTrades = trades.filter((t) => t.status === "open");
  const closedTrades = trades.filter((t) => t.status === "closed");
  const blocksAll = (gatesRes?.gate_evals ?? []).filter((g) => !g.approved);
  const blocks = blocksAll.slice(0, 3);
  const lastReconcile = reconcileRes?.runs?.[0];

  const openBySerial = (serial: number, direct: Receipt | null = null) => {
    if (direct) {
      setOpenReceipt(direct);
      return;
    }
    const hit = receipts.find((r) => r.serial === serial);
    if (hit) {
      setOpenReceipt(hit);
      return;
    }
    setOpenReceipt({ serial, ts: "", kind: "loading", tool: null, payload: "{}", ok: 1, latency_ms: null });
    fetchReceipt(serial).then((full) =>
      setOpenReceipt(
        full ?? { serial, ts: "", kind: "not_found", tool: null, payload: JSON.stringify({ note: `receipt #${serial} is older than this page's window; it exists in the journal` }), ok: 1, latency_ms: null }
      )
    );
  };

  return (
    <main className="desk">
      <header className="desk-head">
        <div>
          <Link href="/" className="fd-name">
            Tape
          </Link>
          <span className="micro"> · the desk</span>
        </div>
        {stale && state ? (
          <span className="stamp stamp-pending">STALE · last entry {state.last_action?.slice(11, 16)} UTC</span>
        ) : (
          <span className={`stamp ${state?.market_open ? "stamp-match" : "stamp-neutral"}`}>
            {state?.market_open ? `OPEN · ${state.minutes_to_close ?? "?"} min to close` : "MARKET CLOSED"}
          </span>
        )}
      </header>

      <section className="desk-strip">
        <div className="micro">the tape · decisions in order, append-only · click one to open its receipt</div>
        <TapeStrip receipts={receipts} onSerial={openBySerial} />
      </section>

      <section className="desk-stats">
        <StatTile
          label="Equity"
          value={state?.equity != null ? money(state.equity) : "···"}
          sub={state?.cash != null ? `cash ${money(state.cash)}` : undefined}
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
              <button key={t.trade_id} className="row row-btn" onClick={() => openBySerial(t.serial_open ?? 0)}>
                <span className="serial">#{t.serial_open}</span>
                <span className="row-underlying">{t.underlying}</span>
                <span className="row-structure">{t.structure}</span>
                <span className="number-sm">x{t.qty}</span>
                <span className="number-sm">credit {t.credit != null ? money(t.credit) : "···"}</span>
                <span className="caption">max loss {money(t.max_loss)}</span>
                <span className="stamp stamp-pending">OPEN</span>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="desk-section">
        <h2 className="section-title">Risk desk · blocked proposals</h2>
        {blocksAll.length === 0 ? (
          <p className="caption empty-note">No blocked proposals yet. Every block shows its gate-by-gate reasons here; blocks are receipts too.</p>
        ) : (
          <div className="card">
            {blocks.map((g) => (
              <BlockCard key={g.id} gate={g} onSerial={openBySerial} />
            ))}
            {blocksAll.length > blocks.length ? (
              <div className="row">
                <span className="caption">{blocksAll.length - blocks.length} older blocks · every one is a receipt on the tape</span>
              </div>
            ) : null}
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
              <button key={t.trade_id} className="row row-btn" onClick={() => openBySerial(t.serial_close ?? t.serial_open ?? 0)}>
                <span className="serial">#{t.serial_close ?? t.serial_open}</span>
                <span className="row-underlying">{t.underlying}</span>
                <span className="row-structure">{t.structure}</span>
                <span className="number-sm">x{t.qty}</span>
                <span className={`number-sm ${(t.realized_pnl ?? 0) >= 0 ? "tone-up" : "tone-down"}`}>
                  {(t.realized_pnl ?? 0) >= 0 ? "+" : ""}
                  {money(t.realized_pnl ?? 0)}
                </span>
                <span className="caption">thesis on #{t.serial_open}</span>
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
              <span className="caption">{lastReconcile.ts.slice(5, 16).replace("T", " ")} UTC</span>
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

function BlockCard({ gate, onSerial }: { gate: GateEval; onSerial: (serial: number, direct?: Receipt | null) => void }) {
  const [showAll, setShowAll] = useState(false);
  const failing = gate.reasons.filter((r) => !r.pass);
  const shown = showAll ? gate.reasons : failing.length ? failing : gate.reasons.slice(0, 2);
  const p = gate.proposal as { underlying?: string; short_strike?: number; credit?: number; candidate_id?: string };
  return (
    <div className="block-card">
      <div className="row row-head-static">
        <button className="serial block-serial" onClick={() => onSerial(gate.serial ?? 0)}>
          #{gate.serial}
        </button>
        <span className="caption">
          {gate.ts.slice(5, 16).replace("T", " ")} UTC · {p.underlying ?? "?"} {p.short_strike != null ? p.short_strike : ""} credit {p.credit != null ? money(p.credit) : "?"}
        </span>
        <span className="stamp stamp-error">BLOCKED</span>
        <span className="mono caption block-cand">{p.candidate_id ?? ""}</span>
      </div>
      <GateList gates={shown.map(gateHuman)} />
      <div className="row gate-toggle-row">
        <button className="btn btn-ghost gate-toggle" onClick={() => setShowAll(!showAll)}>
          {showAll ? "show failures only" : `show all ${gate.reasons.length} gates`}
        </button>
      </div>
    </div>
  );
}
