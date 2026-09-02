"use client";

/* Rules: the risk desk's feed. Every blocked proposal with reasons, and the
   full gate glossary in plain English. */

import { useState } from "react";
import { fetchReceipt, gateHuman, GateList, ReceiptModal, useApi, type Receipt } from "../kit";

type GateEval = {
  id: number;
  ts: string;
  serial: number | null;
  proposal: Record<string, unknown>;
  approved: boolean;
  reasons: { gate: string; pass: boolean; value: unknown }[];
};

const GLOSSARY: { gate: string; name: string; plain: string }[] = [
  { gate: "market_open", name: "Market is open", plain: "New trades only during US regular hours." },
  { gate: "not_last_30min", name: "Not in the final 30 minutes", plain: "No new risk right before the close." },
  { gate: "per_trade_max_loss", name: "Max loss per trade", plain: "A single structure can never risk more than 2.5% of the account." },
  { gate: "aggregate_risk", name: "Total open risk", plain: "All open positions together stay under 20% of the account." },
  { gate: "daily_halt", name: "Daily loss halt", plain: "Lose 4% in one session and the desk closes everything and stops." },
  { gate: "delta_band", name: "Delta band", plain: "The short leg sits between 0.10 and 0.40 delta: far enough to be safe, close enough to collect." },
  { gate: "dte", name: "Days to expiry", plain: "Nothing longer than 5 days out." },
  { gate: "same_expiry", name: "Same expiry", plain: "Both legs of a spread must expire on the same day." },
  { gate: "per_underlying_limit", name: "Per-ticker limit", plain: "At most 2 structures on the same ticker at once." },
  { gate: "short_not_deep_itm", name: "Short strike guard", plain: "The sold strike may not be deep in the money." },
  { gate: "liquidity", name: "Liquidity", plain: "Quotes must be tight: the spread has to be cheap to enter and exit." },
  { gate: "credit_positive", name: "Net credit", plain: "The desk only sells structures that pay it to open." },
  { gate: "flatten_deadline", name: "Friday flatten", plain: "Everything closes before the Friday session ends." },
];

export default function Rules() {
  const { data: gatesRes } = useApi<{ gate_evals: GateEval[] }>("/api/gate_evals");
  const [openReceipt, setOpenReceipt] = useState<Receipt | null>(null);
  const evals = gatesRes?.gate_evals ?? [];
  const blocksAll = evals.filter((g) => !g.approved);
  const approved = evals.filter((g) => g.approved);
  const blocks = blocksAll.slice(0, 6);

  const openBySerial = (serial: number) => {
    setOpenReceipt({ serial, ts: "", kind: "loading", tool: null, payload: "{}", ok: 1, latency_ms: null });
    fetchReceipt(serial).then((full) =>
      setOpenReceipt(
        full ?? {
          serial,
          ts: "",
          kind: "not_found",
          tool: null,
          payload: JSON.stringify({ note: `Receipt #${serial} is older than the recent window.` }),
          ok: 1,
          latency_ms: null,
        }
      )
    );
  };

  return (
    <div className="page">
      <header className="page-head">
        <h1 className="page-title">Rules</h1>
        <p className="page-desc">
          The analyst proposes; these deterministic gates dispose. Every evaluation, pass or block, is a receipt.
        </p>
      </header>

      <section className="rules-counters">
        <div className="card rule-counter">
          <span className="number-lg">{evals.length}</span>
          <span className="micro">evaluations</span>
        </div>
        <div className="card rule-counter">
          <span className="number-lg tone-up">{approved.length}</span>
          <span className="micro">approved</span>
        </div>
        <div className="card rule-counter">
          <span className="number-lg tone-down">{blocksAll.length}</span>
          <span className="micro">blocked</span>
        </div>
      </section>

      <section className="desk-section">
        <h2 className="section-title">Blocked proposals</h2>
        {blocksAll.length === 0 ? (
          <p className="caption empty-note">
            No blocked proposals yet. Every block shows its gate-by-gate reasons here; blocks are receipts too.
          </p>
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
        <h2 className="section-title">The rulebook</h2>
        <p className="caption">
          These gates run in code before any order is placed. The model can pick a trade; it can never weaken a rule.
        </p>
        <div className="card">
          {GLOSSARY.map((g) => (
            <div key={g.gate} className="row glossary-row">
              <span className="mono gate-name">{g.name}</span>
              <span className="caption">{g.plain}</span>
            </div>
          ))}
        </div>
      </section>

      <ReceiptModal receipt={openReceipt} onClose={() => setOpenReceipt(null)} />
    </div>
  );
}

function BlockCard({ gate, onSerial }: { gate: GateEval; onSerial: (serial: number) => void }) {
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
          {gate.ts.slice(5, 16).replace("T", " ")} UTC · {p.underlying ?? "?"} {p.short_strike != null ? p.short_strike : ""} credit{" "}
          {p.credit != null ? `$${p.credit.toFixed(2)}` : "?"}
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
