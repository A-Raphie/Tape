# Tape · design.md

## Design brief: Tape
- **Consensus default (banned):** dark-navy "AI trading terminal": near-black bg, neon green/red candles, glassmorphic bento stat cards, gradient hero, an AI chat panel streaming generic reasoning, decorative infinite ticker marquee, emoji icons, confidence-score radial gauge, "Powered by" footer. None of these ship, except the anchor below.
- **Axes pushed (3, each justified by the concept):**
  1. **Layout paradigm → ledger/blotter-first.** The app IS the record the agent produces: full-width ruled rows, tables as primary object, receipts as documents. A proof-carrying desk earns a document layout the way a graph product earns graph-as-canvas.
  2. **Color strategy → light-first + sponsor gold.** Alpaca's verified brand (mined from their 419KB stylesheet): gold #fcd72b (125 hits; family #e8c003, #fde780, wash #feefaa), light ground #f7f7f7 (87), ink ladder #010101/#101010/#181818, greys #333/#626262/#929292/#b3b3b3/#dcdcdc/#e4e4e4, crisp radii (8px primary, 4px secondary). We wear their gold on their light ground while ~80% of entries ship dark navy: different from the crowd AND verifiably on-sponsor. P&L pairs are desaturated green/rust, never neon, never color-alone.
  3. **Motion → live receipt stream, stillness everywhere else.** Receipts land as real events when the agent acts (scarce by nature: minutes apart, not seconds); everything else is completely still (Linear restraint doctrine: in a hall of animated dashboards the still page reads as confidence). No marquees, no auto-carousels, no pulsing glows.
- **Axes kept conventional (familiarity wins where work happens):** typography (calm grotesk for UI, characterful mono for serials/numbers/prices: data-honest, not exotic), density on inner screens (readable tables, generous-but-not-airy), elevation (hairlines + one consistent soft shadow for raised documents).
- **Sponsor synthesis:** structure is ours, color is theirs: gold reserved for the brand-critical marks (serial numbers, the tape strip highlights, key numerals, active states) so attention stays zero-sum; ink-on-light carries everything else. Fonts: system grotesk + mono (their BROmega/Formular noted, not copied).
- **Signature move: the unfolding receipt.** Any fill (or any gate block) is a row in the blotter; opening it morphs the row into the full evidence document: analyst thesis → risk-gate evaluation (each gate with its pass value) → raw MCP call (actual JSON) → fill/confirm → reconcile stamp vs account ground truth. Mechanism test: it does not decorate, it IS the product working. 5-minute test: unreproducible without the real receipt pipeline (serials, gate values, MCP logs, reconciliation). Demo test: it is the money moment of the video. Interaction bar: expands from the row that opened it (spatial consistency), interruptible, no loops. Secondary signature: the append-only tape strip (top of every screen) showing the agent's OWN actions as they happen: the tape made literal, never an infinite marquee.
- **Avoid-list:** everything in the consensus block; warm-cream paper + green-led accents (claimcheck's territory), dark + gold (purser's territory), glassmorphism, gradient text, neon P&L colors, chat-panel-as-proof, emoji icons, fake tickers, confidence gauges.
- **Familiarity anchor (the ONE consensus element kept):** a conventional equity/P&L line chart, hairline and quiet, at the top of the desk. Judges expect to see the curve; hiding it would cost more trust than divergence buys.
- **Chains to:** semantic-tokens → ui-craft (per-screen sequence, front-door rule) → ui-ux-audit.

## Screens (ui-craft build order; each gets fold-draw + audits)
1. `/` Front door: what Tape is in ≤10s with REAL data (live account equity, receipt count, last action), plain-verb steps (it watches, it gates, it trades, it proves), what-it-works-with strip (Alpaca paper account · Alpaca MCP server · Groq), enter-app path.
2. `/desk` The blotter: tape strip (append-only), equity anchor chart, open positions with live Greeks + gate status, today's P&L, halt state if tripped.
3. `/receipt/[serial]` The unfolding receipt (signature).
4. `/reconcile` Honesty table: journal vs account ground truth, per-line MATCH/MISMATCH stamps, live.
5. `/journal` Thesis cards + nightly lesson receipts.

## Empty/offline states (audited, not afterthoughts)
- No trades yet: "The desk is armed. First cycle opens the tape." with market-open countdown.
- Market closed: last session's full blotter, marked CLOSED, next open time.
- Agent halted: halt reason front and center, flatten receipts linked.
- Offline: last persisted state + stale timestamp, never spinner-only.

## Data contract (panel hydrates ONLY from the agent's persisted state, never session mocks)
SQLite (agent-written) surfaced by FastAPI sidecar: `account` snapshot (equity series), `receipts` (serial, ts, kind, tool, payload, ok), `trades` (structure, legs, thesis, status, pnl), `gate_evals` (proposal, approved, reasons), `reconcile_runs` (journal state vs account state, diffs), `lessons`. Panel polls like purser's 4s loop; sparkline is the purser pattern rebuilt on tape tokens.

## Copy rules
No em/en dashes anywhere (grep gate). Plain verbs, no jargon-first copy (explain-to-a-friend lesson). Receipts carry physical weight: serials in mono microcopy, timestamps UTC, perforation detail.
