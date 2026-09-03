"use client";

/* Front door: what Tape is, in under 10 seconds, with real data on the surface. */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Sparkline, StatTile, TapeStrip, useApi } from "./kit";

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

const money = (v: number) => `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const TAGLINE = "The tape doesn't lie. Now the agent can't either.";

export default function FrontDoor() {
  const { data: state, stale, failed, refresh } = useApi<State>("/api/state");
  const { data: equity } = useApi<{ points: { ts: string; equity: number }[] }>("/api/equity", 8000);
  const { data: receiptsRes } = useApi<{ receipts: import("./kit").Receipt[] }>("/api/receipts?limit=14", 4000);
  const { data: lessonsRes } = useApi<{ lessons: { id: number; lesson: string; trade_id: string | null }[] }>(
    "/api/lessons",
    30000
  );
  const pinnedLesson = lessonsRes?.lessons?.[0];

  return (
    <main className="frontdoor">
      <section className="fd-hero">
        <h1 className="fd-title">An autonomous options agent that shows its tape.</h1>
        <p className="fd-sub">
          Every order it places ships a serial-numbered receipt: the analyst's thesis, the risk desk's gate-by-gate
          evaluation, the raw MCP call, the fill. Then a reconcile pass proves the journal matches the account.
        </p>
      </section>

      <section className="fd-stats">
        <StatTile
          label="Account equity"
          value={state?.equity != null ? money(state.equity) : ""}
          loading={!state}
          sub="Alpaca paper account, live snapshot"
        />
        <StatTile
          label="Receipts on the tape"
          value={state ? String(state.receipts) : ""}
          loading={!state}
          sub={state ? `${state.mcp_calls} MCP calls receipted` : undefined}
        />
        <StatTile
          label="Structures"
          value={state ? `${state.open_trades} open · ${state.trades - state.open_trades} closed` : "···"}
          sub="defined-risk credit spreads only"
        />
      </section>

      <section className="card fd-live">
        <div className="micro">
          {failed && !state ? "can't reach the journal" : stale ? "showing the last synced tape" : "live from the desk"}
        </div>
        {failed && !state ? (
          <div>
            <button className="btn btn-primary" onClick={refresh}>
              Retry
            </button>
          </div>
        ) : (
          <TapeStrip receipts={receiptsRes?.receipts ?? []} />
        )}
        <Sparkline points={equity?.points ?? []} />
      </section>

      {pinnedLesson ? (
        <section className="card fd-lesson">
          <div className="micro">what the desk learned, graded against real fills</div>
          <p className="fd-lesson-text">“{pinnedLesson.lesson}”</p>
          <Link href="/journal/" className="caption">
            all lessons in the journal{pinnedLesson.trade_id ? ` · from ${pinnedLesson.trade_id}` : ""}
          </Link>
        </section>
      ) : null}

      <TaglineReveal />

      <section className="fd-benefits">
        <h2 className="section-title">What watching an agent prove itself gets you</h2>
        <ul className="fd-steps">
          <li>
            <span className="micro">01 · watch</span> It reads Alpaca option chains with real Greeks, on a cycle, all session.
          </li>
          <li>
            <span className="micro">02 · gate</span> It proposes, the risk desk disposes: 13 deterministic rules, and a block shows its receipts.
          </li>
          <li>
            <span className="micro">03 · trade</span> It trades only through Alpaca's official MCP server: small, defined-risk credit spreads.
          </li>
          <li>
            <span className="micro">04 · prove</span> Click any fill and the whole chain unfolds: thesis, gates, call, fill, reconcile stamp.
          </li>
        </ul>
        <div className="fd-with">
          <span className="micro">works with</span>
          <span className="fd-with-item">Alpaca Paper Trading API</span>
          <span className="fd-with-item">Alpaca MCP Server</span>
          <span className="fd-with-item">Groq openai/gpt-oss-120b</span>
        </div>
      </section>

      <div className="fd-enter">
        <Link href="/desk/" className="btn btn-primary btn-lg">
          Enter the desk
        </Link>
        <span className="caption">no login, no keys shown: read-only views of the journal</span>
      </div>
    </main>
  );
}

/* Tagline reveal: words activate one at a time as the section scrolls in.
   Honored by prefers-reduced-motion (transitions collapse to instant). */
function TaglineReveal() {
  const ref = useRef<HTMLParagraphElement>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setOn(true);
          io.disconnect();
        }
      },
      { threshold: 0.4 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <section className="fd-reveal" aria-label="core claim">
      <p ref={ref} className={`fd-reveal-text ${on ? "fd-reveal-on" : ""}`}>
        {TAGLINE.split(" ").map((w, i) => (
          <span key={i} style={{ transitionDelay: `${i * 90}ms` }}>
            {w}{" "}
          </span>
        ))}
      </p>
    </section>
  );
}
