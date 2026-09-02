"use client";

/* App shell: persistent header with live status, primary nav, footer.
   Every route renders inside this; it is the product's chrome. */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useApi } from "./kit";

type State = {
  equity: number | null;
  market_open: boolean;
  minutes_to_close: number | null;
  last_action: string | null;
};

export const NAV = [
  { href: "/desk/", label: "Desk" },
  { href: "/rules/", label: "Rules" },
  { href: "/reconcile/", label: "Reconcile" },
  { href: "/journal/", label: "Journal" },
  { href: "/receipts/", label: "Receipts" },
];

export function TopBar() {
  const pathname = usePathname();
  const { data: state, stale } = useApi<State>("/api/state", 6000);
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link href="/" className="fd-name" aria-label="Tape home">
          Tape
        </Link>
        <nav className="topnav" aria-label="primary">
          {NAV.map((n) => {
            const active = pathname === n.href || (n.href !== "/" && pathname.startsWith(n.href));
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`topnav-link ${active ? "topnav-active" : ""}`}
                aria-current={active ? "page" : undefined}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="topbar-status">
          {stale && state ? (
            <span className="stamp stamp-pending">STALE · {state.last_action?.slice(11, 16)} UTC</span>
          ) : (
            <>
              <span className={`stamp ${state?.market_open ? "stamp-match" : "stamp-neutral"}`}>
                {state?.market_open ? `OPEN · ${state.minutes_to_close ?? "?"}m` : "CLOSED"}
              </span>
              {state?.equity != null ? (
                <span className="number-sm topbar-equity" aria-label="account equity">
                  ${state.equity.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              ) : null}
            </>
          )}
        </div>
      </div>
    </header>
  );
}

export function Footer() {
  const { data: state } = useApi<{ receipts: number; last_action: string | null }>("/api/state", 20000);
  return (
    <footer className="footer">
      <div className="footer-grid">
        <div className="footer-col">
          <div className="fd-name">Tape</div>
          <p className="caption footer-blurb">
            The proof-carrying options desk. An autonomous agent trades options on an Alpaca paper account; every
            action prints a numbered receipt, and a reconcile pass proves the journal matches the account.
          </p>
          <p className="micro footer-tag">The tape doesn't lie. Now the agent can't either.</p>
        </div>
        <div className="footer-col">
          <div className="micro">pages</div>
          <ul className="footer-links">
            {NAV.map((n) => (
              <li key={n.href}>
                <Link href={n.href}>{n.label}</Link>
              </li>
            ))}
          </ul>
        </div>
        <div className="footer-col">
          <div className="micro">works with</div>
          <ul className="footer-links">
            <li>
              <a href="https://alpaca.markets" target="_blank" rel="noreferrer">
                Alpaca paper trading
              </a>
            </li>
            <li>
              <a href="https://github.com/alpacahq/alpaca-mcp-server" target="_blank" rel="noreferrer">
                Alpaca MCP server
              </a>
            </li>
            <li>
              <a
                href="https://lablab.ai/ai-hackathons/alpaca-ai-trading-agents-hackathon"
                target="_blank"
                rel="noreferrer"
              >
                The hackathon
              </a>
            </li>
          </ul>
        </div>
        <div className="footer-col">
          <div className="micro">journal</div>
          <ul className="footer-links">
            <li>
              <a href="https://github.com/A-Raphie/tape" target="_blank" rel="noreferrer">
                Source on GitHub
              </a>
            </li>
            <li>
              <span className="caption">
                {state
                  ? `${state.receipts.toLocaleString()} receipts · synced ${state.last_action?.slice(11, 16)} UTC`
                  : "syncing…"}
              </span>
            </li>
          </ul>
        </div>
      </div>
    </footer>
  );
}
