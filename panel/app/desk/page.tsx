"use client";

/* The desk: the blotter. Tape strip, live stats, open and closed structures. */

import { useState } from "react";
import { fetchReceipt, ReceiptModal, Sparkline, StatTile, TapeStrip, useApi, type Receipt, type Trade } from "../kit";

const money = (v: number) =>
  `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function Desk() {
  const { data: state } = useApi<{
    equity: number | null;
    cash: number | null;
    receipts: number;
    market_open: boolean;
    minutes_to_close: number | null;
  }>("/api/state");
  const { data: equity } = useApi<{ points: { ts: string; equity: number }[] }>("/api/equity", 8000);
  const { data: receiptsRes } = useApi<{ receipts: Receipt[] }>("/api/receipts?limit=40");
  const { data: tradesRes } = useApi<{ trades: Trade[] }>("/api/trades");
  const [openReceipt, setOpenReceipt] = useState<Receipt | null>(null);

  const receipts = receiptsRes?.receipts ?? [];
  const trades = tradesRes?.trades ?? [];
  const openTrades = trades.filter((t) => t.status === "open");
  const closedTrades = trades.filter((t) => t.status === "closed");

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
        full ?? {
          serial,
          ts: "",
          kind: "not_found",
          tool: null,
          payload: JSON.stringify({ note: `Receipt #${serial} is older than this page's window; it exists in the journal archive.` }),
          ok: 1,
          latency_ms: null,
        }
      )
    );
  };

  return (
    <div className="page">
      <header className="page-head">
        <h1 className="page-title">The desk</h1>
        <p className="page-desc">Live blotter of the agent: what it holds, what it closed, every decision in order.</p>
      </header>

      <section className="desk-strip">
        <div className="micro">the tape · decisions in order, append-only · click one to open its receipt</div>
        <TapeStrip receipts={receipts} onSerial={openBySerial} />
      </section>

      <section className="desk-stats">
        <StatTile
          label="Equity"
          value={state?.equity != null ? money(state.equity) : ""}
          loading={!state}
          sub={state?.cash != null ? `cash ${money(state.cash)}` : undefined}
        />
        <div className="card desk-chart">
          <div className="micro">equity, per cycle</div>
          <Sparkline points={equity?.points ?? []} height={72} />
        </div>
        <StatTile label="Receipts" value={state ? String(state.receipts) : ""}
          loading={!state} sub="serial-numbered" />
      </section>

      <section className="desk-section">
        <h2 className="section-title">Open structures</h2>
        {openTrades.length === 0 ? (
          <p className="caption empty-note">
            The desk is armed. When the analyst picks a candidate and the risk desk approves it, the structure lands
            here with its thesis attached.
          </p>
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
        <h2 className="section-title">Closed</h2>
        {closedTrades.length === 0 ? (
          <p className="caption empty-note">
            Nothing closed yet. Exits land here with realized P&L and the receipt chain that proves them.
          </p>
        ) : (
          <div className="card">
            {closedTrades.map((t) => (
              <button
                key={t.trade_id}
                className="row row-btn"
                onClick={() => openBySerial(t.serial_close ?? t.serial_open ?? 0)}
              >
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

      <ReceiptModal receipt={openReceipt} onClose={() => setOpenReceipt(null)} />
    </div>
  );
}
