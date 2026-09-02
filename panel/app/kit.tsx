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

/* --- GateList: every gate with its pass value, blocked or approved --- */

export function GateList({ gates }: { gates: { gate: string; pass: boolean; value: unknown }[] }) {
  return (
    <div className="gate-list">
      {gates.map((g, i) => (
        <div key={i} className="row gate-row">
          <span className={`stamp ${g.pass ? "stamp-match" : "stamp-error"}`}>{g.pass ? "PASS" : "BLOCK"}</span>
          <span className="mono gate-name">{g.gate}</span>
          <span className="caption gate-value">{fmtValue(g.value)}</span>
        </div>
      ))}
    </div>
  );
}

function fmtValue(v: unknown): string {
  if (v == null) return "n/a";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
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
              {receipt.ts} · {receipt.kind}
              {receipt.tool ? ` · ${receipt.tool}` : ""} · {receipt.ok ? "OK" : "FAILED"}
            </div>
          </div>
          <button ref={closeRef} className="btn btn-ghost receipt-close" onClick={onClose} aria-label="close receipt">
            close
          </button>
        </header>
        <hr className="divider receipt-tear" />
        <ReceiptBody payload={payload} />
        <footer className="micro receipt-foot">journal entry · every cycle reconciles the journal against the account on the desk</footer>
      </article>
    </div>
  );
}

function ReceiptBody({ payload }: { payload: Record<string, unknown> }) {
  const entries = Object.entries(payload);
  return (
    <div className="receipt-body">
      {entries.map(([k, v]) => (
        <section key={k} className="receipt-section">
          <div className="micro">{k}</div>
          <pre className="mono receipt-payload">{typeof v === "string" ? v : JSON.stringify(v, null, 2)}</pre>
        </section>
      ))}
    </div>
  );
}
