"use client";

/* Tape component kit: the ONLY source of UI primitives.
   Grammar adapted from beautifului.dev MIT primitives (tool chips, expandable
   traces, diff tables) re-expressed on tape tokens. The receipt inspector is
   bespoke (signature move). Zero raw hex outside globals.css. */

import { useEffect, useRef, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_BASE ?? "";

export type Receipt = {
  serial: number;
  ts: string;
  kind: string;
  tool: string | null;
  payload: string;
  ok: number;
  latency_ms: number | null;
};

export type Trade = {
  trade_id: string;
  underlying: string;
  structure: string;
  legs: { symbol: string; side: string }[];
  qty: number;
  credit: number | null;
  max_loss: number;
  thesis: string | null;
  status: string;
  realized_pnl: number | null;
  serial_open: number | null;
  serial_close: number | null;
};

export function useApi<T>(path: string, intervalMs = 4000): { data: T | null; stale: boolean; failed: boolean } {
  const [data, setData] = useState<T | null>(null);
  const [stale, setStale] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(`${API}${path}`, { cache: "no-store" });
        if (!alive) return;
        if (res.ok) {
          setData((await res.json()) as T);
          setStale(false);
          setFailed(false);
        } else {
          setStale(true);
          setFailed(true);
        }
      } catch {
        setStale(true);
        setFailed(true);
      }
    };
    load();
    const id = setInterval(load, intervalMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [path, intervalMs]);
  return { data, stale, failed };
}

export async function fetchReceipt(serial: number): Promise<Receipt | null> {
  try {
    const res = await fetch(`${API}/api/serial/${serial}`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as Receipt;
  } catch {
    return null;
  }
}

/* --- TapeStrip: the agent's decisions, in order, append-only.
     Polls are housekeeping; the tape carries decisions. --- */

const TAPE_KINDS = new Set(["trade_opened", "trade_closed", "close_intent", "entry_proposal", "flatten_all", "halt", "reconcile", "scribe_grade"]);

export function TapeStrip({ receipts, onSerial }: { receipts: Receipt[]; onSerial?: (serial: number, receipt: Receipt | null) => void }) {
  const calls = receipts.filter((r) => TAPE_KINDS.has(r.kind) || (r.kind === "mcp_call" && (r.tool ?? "").includes("order"))).slice(0, 14);
  if (!calls.length) {
    return <div className="micro tape-empty">no desk decisions yet · the tape prints the first trade here</div>;
  }
  return (
    <div className="tape-strip" aria-label="append-only action tape">
      {calls.map((r) => {
        const label = (
          <>
            <span className="serial">#{r.serial}</span> {r.tool ?? r.kind}
            {r.ts ? <span className="tape-latency"> {r.ts.slice(11, 16)} UTC</span> : null}
          </>
        );
        return onSerial ? (
          <button key={r.serial} className="tape-chip tape-chip-btn" onClick={() => onSerial(r.serial, r)}>
            {label}
          </button>
        ) : (
          <span key={r.serial} className={`tape-chip ${r.ok ? "" : "tape-chip-bad"}`}>
            {label}
          </span>
        );
      })}
    </div>
  );
}

/* --- Sparkline: quiet equity curve with an honest caption (the one
       familiarity anchor; never exaggerate amplitude silently) --- */

export function Sparkline({ points, height = 56 }: { points: { ts: string; equity: number }[]; height?: number }) {
  if (points.length < 2) {
    return <div className="micro spark-empty">equity curve starts on the second snapshot</div>;
  }
  const w = 640;
  const vals = points.map((p) => p.equity);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const xy = points.map((p, i) => {
    const x = (i / (points.length - 1)) * (w - 8) + 4;
    const y = height - 6 - ((p.equity - min) / span) * (height - 12);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const delta = vals[vals.length - 1] - vals[0];
  const pct = vals[0] ? (delta / vals[0]) * 100 : 0;
  const up = delta >= 0;
  return (
    <figure className="spark-fig">
      <svg viewBox={`0 0 ${w} ${height}`} className="spark" role="img" aria-label={`equity curve, ${delta >= 0 ? "up" : "down"} ${Math.abs(delta).toFixed(2)} dollars over the window`}>
        <polyline points={xy.join(" ")} fill="none" strokeWidth="1.5" className={up ? "spark-line spark-up" : "spark-line spark-down"} vectorEffect="non-scaling-stroke" />
        <circle cx={xy[xy.length - 1].split(",")[0]} cy={xy[xy.length - 1].split(",")[1]} r="2.5" className={up ? "spark-dot spark-up" : "spark-dot spark-down"} />
      </svg>
      <figcaption className={`micro ${up ? "tone-up" : "tone-down"}`}>
        {up ? "+" : ""}${delta.toFixed(2)} ({pct >= 0 ? "+" : ""}
        {pct.toFixed(2)}%) over the last {points.length} snapshots · axis spans ${min.toFixed(0)} to ${max.toFixed(0)}
      </figcaption>
    </figure>
  );
}

/* --- StatTile --- */

export function StatTile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "up" | "down" | "flat" }) {
  return (
    <div className="card stat-tile">
      <div className="micro">{label}</div>
      <div className={`number-lg stat-value ${tone ? `tone-${tone}` : ""}`}>{value}</div>
      {sub ? <div className="caption">{sub}</div> : null}
    </div>
  );
}

/* --- GateList: every rule with its pass value, blocked or approved --- */

export function gateHuman(g: { gate: string; pass: boolean; value: unknown }): { name: string; detail: string; pass: boolean } {
  const v = g.value;
  let detail = "";
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("max_loss" in o && "cap" in o) detail = `$${Number(o.max_loss).toFixed(0)} risked vs $${Number(o.cap).toFixed(0)} allowed`;
    else if ("aggregate" in o && "cap" in o) detail = `$${Number(o.aggregate).toFixed(0)} open vs $${Number(o.cap).toFixed(0)} allowed`;
    else if ("open" in o && "cap" in o) detail = `${o.open} open vs ${o.cap} allowed`;
    else detail = JSON.stringify(v);
  } else if (typeof v === "number") {
    detail = g.gate === "delta_band" ? `delta ${v.toFixed(2)}` : g.gate === "dte" ? `${v} days` : String(v);
  } else if (typeof v === "string") {
    detail = v;
  }
  return { name: GATE_NAMES[g.gate] ?? g.gate, detail, pass: g.pass };
}

export function GateList({ gates }: { gates: { name: string; detail: string; pass: boolean }[] }) {
  return (
    <div className="gate-list">
      {gates.map((g, i) => (
        <div key={i} className="row gate-row">
          <span className={`stamp ${g.pass ? "stamp-match" : "stamp-error"}`}>{g.pass ? "PASS" : "BLOCK"}</span>
          <span className="mono gate-name">{g.name}</span>
          <span className="caption gate-value">{g.detail}</span>
        </div>
      ))}
    </div>
  );
}

/* --- ThesisCard: analyst verdict with thesis or reject reason --- */

export function ThesisCard({ title, body, kind }: { title: string; body: string; kind: "pick" | "reject" }) {
  return (
    <div className="card thesis-card">
      <div className="thesis-head">
        <span className={`stamp ${kind === "pick" ? "stamp-pending" : "stamp-neutral"}`}>{kind === "pick" ? "PICK" : "REJECT"}</span>
        <span className="mono caption">{title}</span>
      </div>
      <p className="thesis-body">{body}</p>
    </div>
  );
}

/* --- ReceiptModal: the signature. A row unfolds into the full evidence
       document: payload sections rendered as a serial-numbered record. --- */

export function ReceiptModal({ receipt, onClose }: { receipt: Receipt | null; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (receipt) {
      window.addEventListener("keydown", onKey);
      closeRef.current?.focus();
    }
    return () => window.removeEventListener("keydown", onKey);
  }, [receipt, onClose]);
  if (!receipt) return null;
  let payload: Record<string, unknown> = {};
  try {
    payload = typeof receipt.payload === "string" ? JSON.parse(receipt.payload) : receipt.payload;
  } catch {
    payload = { raw: String(receipt.payload) };
  }
  const KIND_WORDS: Record<string, string> = {
    entry_proposal: "trade decision",
    trade_opened: "order filled",
    trade_closed: "position closed",
    close_intent: "close decision",
    reconcile: "reconcile pass",
    state_repair: "journal repair",
    order_unfilled: "order cancelled",
    flatten_all: "flatten everything",
    halt: "trading halted",
    llm_judgment: "analyst verdict",
    scribe_grade: "nightly grade",
    mcp_call: "broker call",
    cycle: "desk cycle",
    scan: "market scan",
    loading: "fetching receipt",
    not_found: "older receipt",
  };
  return (
    <div className="receipt-scrim" onClick={onClose}>
      <article
        className="card receipt-doc"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`receipt ${receipt.serial}`}
      >
        <header className="receipt-head">
          <div>
            <div className="serial receipt-serial">RECEIPT #{receipt.serial}</div>
            <div className="micro">
              {humanDate(receipt.ts)} · {KIND_WORDS[receipt.kind] ?? receipt.kind} · {receipt.ok ? "OK" : "FAILED"}
            </div>
          </div>
          <button ref={closeRef} className="btn btn-ghost receipt-close" onClick={onClose} aria-label="close receipt">
            close
          </button>
        </header>
        <hr className="divider receipt-tear" />
        {receipt.kind === "loading" ? (
          <div className="receipt-body">
            <p className="caption receipt-headline">Fetching receipt #{receipt.serial} from the journal…</p>
          </div>
        ) : receipt.kind === "not_found" ? (
          <div className="receipt-body">
            <p className="caption receipt-headline">
              This receipt is older than this page's window. It exists in the journal archive; the tape strip and
              reconcile table always reflect the latest entries.
            </p>
          </div>
        ) : (
          <ReceiptBody payload={payload} serial={receipt.serial} />
        )}
        <footer className="micro receipt-foot">journal entry · every cycle reconciles the journal against the account on the desk</footer>
      </article>
    </div>
  );
}

function ReceiptBody({ payload, serial }: { payload: Record<string, unknown>; serial: number }) {
  return (
    <div className="receipt-body">
      <Headline payload={payload} />
      {typeof payload.thesis === "string" && payload.thesis ? (
        <section className="receipt-section">
          <div className="micro">the analyst's reasoning</div>
          <p className="receipt-thesis">“{payload.thesis}”</p>
        </section>
      ) : null}
      <LegsSection payload={payload} />
      <GatesSection serial={serial} />
      <RawEvidence payload={payload} />
    </div>
  );
}

/* Decode OCC symbols: SPY260902C00765000 -> SPY 765 call, Sep 2 */
const OCC = /^([A-Z]+)(\d{6})([CP])(\d{8})$/;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function humanSymbol(occ: string): string {
  const m = OCC.exec((occ || "").trim().toUpperCase());
  if (!m) return occ;
  const root = m[1];
  const d = m[2];
  const strike = (parseInt(m[4], 10) / 1000).toString();
  return `${root} ${strike} ${m[3] === "C" ? "call" : "put"}, ${MONTHS[parseInt(d.slice(2, 4), 10) - 1]} ${parseInt(d.slice(4, 6), 10)}`;
}

function humanDate(iso: string): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})/.exec(iso);
  if (!m) return iso;
  return `${MONTHS[parseInt(m[2], 10) - 1]} ${parseInt(m[3], 10)}, ${m[4]} UTC`;
}

function humanTitle(payload: Record<string, unknown>): string {
  const p = payload as {
    proposal?: { underlying?: string; structure?: string; short_strike?: number; width?: number; expiration?: string; qty?: number; credit?: number; legs?: { symbol: string; side: string }[] };
    candidate?: string;
    trade?: string;
    reason?: string;
    clean?: boolean;
    diffs?: unknown[];
    realized?: number;
    kind?: string;
  };
  const prop = p.proposal;
  const structure = prop?.structure ? prop.structure.replace(/_/g, " ") : "";
  const legs = Array.isArray(prop?.legs) ? (prop.legs as { symbol: string; side: string }[]) : [];
  const legStr = legs.length
    ? `sell the ${humanSymbol(legs.find((l) => l.side === "sell")?.symbol ?? "")} and buy the ${humanSymbol(legs.find((l) => l.side === "buy")?.symbol ?? "")}`
    : "";
  switch (payload.kind ?? "") {
    case "entry_proposal":
      return `The desk wanted to ${legStr || "open a position"} · ${prop?.qty ?? "?"} sets at $${prop?.credit ?? "?"} credit each.`;
    case "trade_opened":
      return "The broker accepted the order and it filled. The position is now open on the account.";
    case "trade_closed":
      return `The position was closed${p.reason ? `: ${p.reason}` : ""}.`;
    case "close_intent":
      return `The desk decided to close this position${p.reason ? `: ${p.reason}` : ""}.`;
    case "reconcile":
      return p.clean
        ? "The journal matches the account. No drift found."
        : `The journal and the account disagree on ${Array.isArray(p.diffs) ? p.diffs.length : "?"} item(s), listed below.`;
    case "state_repair":
      return "The journal self-corrected: this trade never actually held a position, so it was retired.";
    case "order_unfilled":
      return "The order was placed but never filled, so it was cancelled. Nothing was traded.";
    case "flatten_all":
      return "The desk closed everything: end-of-session safety rule.";
    case "halt":
      return "Trading halted for the day: the loss limit was hit.";
    default:
      return "";
  }
}

function Headline({ payload }: { payload: Record<string, unknown> }) {
  const title = humanTitle(payload);
  if (!title) return null;
  return (
    <section className="receipt-section">
      <div className="micro">what happened</div>
      <p className="receipt-headline">{title}</p>
    </section>
  );
}

function LegsSection({ payload }: { payload: Record<string, unknown> }) {
  const prop = (payload.proposal ?? payload) as {
    legs?: { symbol: string; side: string; bid?: number; ask?: number }[];
    qty?: number;
    credit?: number;
    width?: number;
    max_loss?: number;
    underlying?: string;
    short_strike?: number;
    expiration?: string;
    candidate_id?: string;
    short_delta?: number;
  };
  const legs = Array.isArray(prop.legs) ? prop.legs : [];
  if (!legs.length) return null;
  const qty = prop.qty ?? 1;
  return (
    <section className="receipt-section">
      <div className="micro">the trade</div>
      <table className="leg-table">
        <thead>
          <tr>
            <th>action</th>
            <th>contract</th>
            <th>quote at the time</th>
          </tr>
        </thead>
        <tbody>
          {legs.map((l) => (
            <tr key={l.symbol}>
              <td>{l.side === "sell" ? "SELL" : "BUY"}</td>
              <td className="mono">{humanSymbol(l.symbol)}</td>
              <td className="mono">{l.bid != null && l.ask != null ? `${l.bid.toFixed(2)} to ${l.ask.toFixed(2)}` : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="leg-facts">
        {prop.credit != null ? (
          <div>
            <dt>cash collected now</dt>
            <dd className="number-sm">${(prop.credit * qty * 100).toFixed(2)} credit</dd>
          </div>
        ) : null}
        {prop.width != null ? (
          <div>
            <dt>worst case at expiry</dt>
            <dd className="number-sm">${((prop.width - (prop.credit ?? 0)) * qty * 100).toFixed(2)} loss</dd>
          </div>
        ) : null}
        {prop.short_delta != null ? (
          <div>
            <dt>distance from the money</dt>
            <dd className="number-sm">delta {Math.abs(prop.short_delta).toFixed(2)}</dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}

const GATE_NAMES: Record<string, string> = {
  market_open: "Market is open",
  not_last_30min: "Not in the final 30 minutes",
  per_trade_max_loss: "Size cap: max loss per trade (2.5% of account)",
  aggregate_risk: "Total open risk cap (20% of account)",
  daily_halt: "Daily loss limit (4%) not hit",
  delta_band: "Short leg in the 0.10-0.40 delta band",
  dte: "Expires within 5 days",
  same_expiry: "Both legs share the same expiry",
  per_underlying_limit: "Max 2 positions per ticker",
  short_not_deep_itm: "Short strike not too close to the price",
  liquidity: "Spread is liquid enough to trade",
  credit_positive: "The trade collects cash, not pays it",
  flatten_deadline: "Outside the Friday flatten window",
};

function GatesSection({ serial }: { serial: number }) {
  const [gates, setGates] = useState<{ gate: string; pass: boolean; value: unknown }[] | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`${API}/api/gate_evals?limit=200`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d) return;
        const hit = (d.gate_evals ?? []).find((g: { serial: number | null }) => g.serial === serial);
        setGates(hit ? hit.reasons : []);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [serial]);
  if (gates === null || gates.length === 0) return null;
  return (
    <section className="receipt-section">
      <div className="micro">the rules it had to pass</div>
      <GateList gates={gates.map(gateHuman)} />
    </section>
  );
}

function RawEvidence({ payload }: { payload: Record<string, unknown> }) {
  const { kind: _k, thesis: _t, ...rest } = payload;
  const hasRest = Object.keys(rest).length > 0;
  return (
    <details className="receipt-raw">
      <summary className="micro">raw evidence (exact journal record)</summary>
      <pre className="mono receipt-payload">{JSON.stringify(hasRest ? rest : payload, null, 2)}</pre>
    </details>
  );
}
