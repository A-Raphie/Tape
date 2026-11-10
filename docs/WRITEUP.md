# Tape: write-up

**Tape** is an autonomous options desk on Alpaca paper (`PA37YPE0PC51`) that prints a serial-numbered receipt for everything it does, then reconciles its own journal against the broker every cycle. Live at [tape.up.railway.app](https://tape-desk.netlify.app) · repo [github.com/A-Raphie/tape](https://github.com/A-Raphie/tape) · account `PA37YPE0PC51`.

## AI logic

Each cycle a Groq analyst (`openai/gpt-oss-120b`) reads the desk's state and the option chain for a fixed universe (QQQ, SPY), and proposes a defined-risk credit spread with its thesis attached. The reasoning is printed verbatim in the trade receipt, including when the trade loses.

The model proposes; it never disposes. It cannot size a trade (position size comes from account equity and spread width in code), cannot weaken or touch the gates, and cannot reach the account except through the executor that submits exactly what the gates approved. Tool outputs arrive wrapped in an untrusted-data envelope and are treated as data.

The loop closes on itself: a nightly scribe grades every closed trade against real fills and writes lessons into the journal that feed later cycles (10 on record, including the ones that hurt: "order was journaled open but never filled: the desk now verifies fills before journaling").

## Risk gates

Thirteen deterministic gates run before any order exists, and every evaluation (pass or block) is a receipt: 33 gate runs on record, 11 approved, 22 blocked, each block showing the exact gate and values that killed it.

The gates: market open · no new risk in the last 30 minutes · max loss 2.5% of NAV per structure · 20% aggregate open-risk cap · 4% daily loss halt-and-flatten · short-leg delta band 0.10-0.40 · max 5 DTE · both legs same expiry · max 2 structures per ticker · short strike pin guard (max 1% ITM) · liquidity floor · credit-not-debit · Friday flatten window. In the book: stop loss at 1.5x credit received, take profit at 50%.

Result on the submission account: 11 closed spreads, +$447.50 realized, every loss shown in red on the front page next to the wins.

## Alpaca infrastructure

The agent speaks to Alpaca through the official MCP server over stdio, and every tool call is journaled: 15,138 calls with full payloads, each wrapped in an untrusted-tool-output envelope. Orders execute as multi-leg market submissions that split into per-leg fills; fills are verified before journaling (a direct lesson from day one). A reconcile pass every cycle compares the journal against `get_all_positions` and the account record: clean stamps on record for every cycle of the submission account, and named repair receipts when the two ever disagree.

That reconcile loop is the product's spine. On day two the first account (`PA3CT53IRO63D`) froze for ~90 minutes, held 0-DTE spreads into expiry, and assignment left it at -$54,152. It was retired and archived as a receipt chain (`agent/archive/`), the failure was written into the journal as lessons, and the fresh book (`PA37YPE0PC51`) now trades with fill verification, position-state repair, and the public reconcile wall you can watch pass every cycle.

The desk publishes itself: FastAPI sidecar + Next.js panel serving the tape, receipts, rules, reconcile wall, and journal at the link above, with the equity tile marking the account live (a Sep 3 expiry assignment left -200 SPY short stock on the book at write time; it is receipted, marked to market, and flattened by the Friday flatten rule).

---

*Paper trading only. Built by [Raphie](https://x.com/a_raphie) for the lablab.ai × Alpaca AI Trading Agents Hackathon.*
