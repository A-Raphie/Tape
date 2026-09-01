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

export function useApi<T>(path: string, intervalMs = 4000): T | null {
  const [data, setData] = useState<T | null>(null);
  const stale = useRef(false);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(`${API}${path}`, { cache: "no-store" });
        if (!alive) return;
        if (res.ok) {
          setData((await res.json()) as T);
          stale.current = false;
        } else {
          stale.current = true;
        }
      } catch {
        stale.current = true;
      }
    };
    load();
    const id = setInterval(load, intervalMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [path, intervalMs]);
  return data;
}

/* --- TapeStrip: the append-only record of the agent's own actions --- */

export function TapeStrip({ receipts }: { receipts: Receipt[] }) {
  const calls = receipts.filter((r) => r.kind === "mcp_call" || r.kind === "trade_opened" || r.kind === "close_intent").slice(0, 14);
  if (!calls.length) {
    return <div className="micro tape-empty">the tape is armed · first desk cycle prints here</div>;
  }
  return (
    <div className="tape-strip" aria-label="append-only action tape">
      {calls.map((r) => (
        <span key={r.serial} className={`tape-chip ${r.ok ? "" : "tape-chip-bad"}`}>
          <span className="serial">#{r.serial}</span> {r.tool ?? r.kind}
          {r.latency_ms != null ? <span className="tape-latency"> {r.latency_ms}ms</span> : null}
        </span>
      ))}
    </div>
  );
}

/* --- Sparkline: quiet equity curve (the one familiarity anchor) --- */

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
  const up = vals[vals.length - 1] >= vals[0];
  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="spark" role="img" aria-label="equity curve">
      <polyline points={xy.join(" ")} fill="none" strokeWidth="1.5" className={up ? "spark-line spark-up" : "spark-line spark-down"} />
      <circle cx={xy[xy.length - 1].split(",")[0]} cy={xy[xy.length - 1].split(",")[1]} r="2.5" className={up ? "spark-dot spark-up" : "spark-dot spark-down"} />
    </svg>
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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (!receipt) return null;
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(receipt.payload);
  } catch {
    payload = { raw: receipt.payload };
  }
  return (
    <div className="receipt-scrim" onClick={onClose}>
      <article className="card receipt-doc" onClick={(e) => e.stopPropagation()} aria-label={`receipt ${receipt.serial}`}>
        <header className="receipt-head">
          <div>
            <div className="serial receipt-serial">RECEIPT #{receipt.serial}</div>
            <div className="micro">
              {receipt.ts} · {receipt.kind}
              {receipt.tool ? ` · ${receipt.tool}` : ""} · {receipt.ok ? "OK" : "FAILED"}
            </div>
          </div>
          <button className="btn btn-ghost receipt-close" onClick={onClose} aria-label="close receipt">
            close
          </button>
        </header>
        <hr className="divider receipt-tear" />
        <ReceiptBody payload={payload} />
        <footer className="micro receipt-foot">the tape doesn't lie · reconciled against the account on every cycle</footer>
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
