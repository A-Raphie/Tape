"use client";

/* Front door: what Tape is, in under 10 seconds, with real data on the surface. */

import Link from "next/link";
import { Sparkline, StatTile, TapeStrip, useApi } from "./kit";
import { useState } from "react";

type State = {
  equity: number | null;
  receipts: number;
  mcp_calls: number;
  trades: number;
  open_trades: number;
  last_action: string | null;
  market_open: boolean;
  minutes_to_close: number | null;
};

export default function FrontDoor() {
  const state = useApi<State>("/api/state");
  const equity = useApi<{ points: { ts: string; equity: number }[] }>("/api/equity", 8000);
  const receipts = useApi<{ receipts: import("./kit").Receipt[] }>("/api/receipts?limit=14", 4000);
  const [entered, setEntered] = useState(false);

  return (
    <main className="frontdoor">
      <header className="fd-head">
        <div className="fd-brand">
          <span className="fd-name">Tape</span>
          <span className="fd-tag">the proof-carrying options desk</span>
        </div>
        <span className={`stamp ${state?.market_open ? "stamp-match" : "stamp-neutral"}`}>
          {state?.market_open ? `MARKET OPEN · closes in ${state.minutes_to_close ?? "?"} min` : "MARKET CLOSED"}
        </span>
      </header>

      <section className="fd-hero">
        <h1 className="fd-title">An autonomous options agent that shows its tape.</h1>
        <p className="fd-sub">
          Every order it places ships a serial-numbered receipt: the analyst's thesis, the risk desk's gate-by-gate
          evaluation, the raw MCP call, the fill. Then a reconcile pass proves the journal matches the account.
        </p>
        <p className="fd-claim">
          The tape doesn't lie. Now the agent can't either.
        </p>
      </section>

      <section className="fd-stats">
        <StatTile
          label="Account equity"
          value={state?.equity != null ? `$${state.equity.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : "···"}
          sub="Alpaca paper account, live snapshot"
        />
        <StatTile label="Receipts on the tape" value={state ? String(state.receipts) : "···"} sub={`${state?.mcp_calls ?? 0} MCP calls receipted`} />
        <StatTile
          label="Structures"
          value={state ? `${state.open_trades} open · ${state.trades - state.open_trades} closed` : "···"}
          sub="defined-risk credit spreads only"
        />
      </section>

      <section className="card fd-live">
        <div className="micro">live from the desk</div>
        <TapeStrip receipts={receipts?.receipts ?? []} />
        <Sparkline points={equity?.points ?? []} />
      </section>

      <section className="fd-how">
        <ol className="fd-steps">
          <li>
            <span className="micro">01 · watch</span> It reads the Alpaca option chains with Greeks, every cycle.
          </li>
          <li>
            <span className="micro">02 · gate</span> The analyst proposes; the risk desk approves or blocks, with reasons on the record.
          </li>
          <li>
            <span className="micro">03 · trade</span> It trades only through Alpaca's official MCP server. Small, defined-risk credit spreads.
          </li>
          <li>
            <span className="micro">04 · prove</span> Every fill unfolds into its receipt, and the journal is reconciled against the account.
          </li>
        </ol>
        <div className="fd-with">
          <span className="micro">works with</span>
          <span className="fd-with-item">Alpaca Paper Trading API</span>
          <span className="fd-with-item">Alpaca MCP Server</span>
          <span className="fd-with-item">Groq openai/gpt-oss-120b</span>
        </div>
      </section>

      <div className="fd-enter">
        <Link href="/desk/" className="btn btn-primary btn-lg" onClick={() => setEntered(true)}>
          Enter the desk
        </Link>
        <span className="caption">no login, no keys shown: read-only views of the journal</span>
      </div>
    </main>
  );
}
