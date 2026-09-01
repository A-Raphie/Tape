# AGENTS.md · Tape

Hackathon build: autonomous options desk on Alpaca PAPER trading, deadline Fri Sep 4 2026 15:00 UTC. Context lives in `design.md`, `ORCHESTRATOR.md`, and the git log; this file is behavior only.

## Project facts
- `agent/` Python (venv at `agent/.venv`, stdlib + httpx). Run: `agent/.venv/bin/python scripts/smoke.py [--trade]` (probe, needs `.env` keys), `scripts/run_desk.py` (the loop).
- `panel/` Next.js 15 static export (`npm run dev` / `npm run build`). Token system in `panel/app/globals.css`.
- The journal (`agent/src/tape/journal.py`, SQLite + JSONL) is the product: receipts with serial numbers. The panel hydrates ONLY from it, never from session state or fixtures.

## Decision defaults
- Default to the least-surprising reversible change; note the choice and move on. Stop only for the list under "Never without a human".
- Alpaca MCP tool names and argument schemas are DISCOVERED at runtime (`tools/list`), never guessed from memory. When adding an MCP call, extend `executor.py`'s schema-adaptive helpers instead of hardcoding.
- Field names from Alpaca responses are normalized defensively in `strategy.normalize_contract`; when the smoke test reveals the real shape, correct the normalizer rather than scattering `.get()` chains.
- Blocked on something external (keys, deploy access)? Build the next thing that does not need it and log the blocker in ORCHESTRATOR.md.
- Fresh code only: this repo must not contain files copied from claimcheck/purser/hansei (event DQ rule). Borrow patterns, write new files.

## Hard constraints
- PAPER ONLY. `ALPACA_PAPER_TRADE=true` must stay set; never source live-trading keys, never construct a live base URL. If any code path could reach live trading, stop and flag.
- Orders are placed ONLY through `tape.executor` via the MCP client. Never shell out to curl/SDK for order placement.
- Risk gates in `tape/risk.py` are never loosened to let a trade pass. If a gate blocks everything, report the numbers; do not edit the gate.
- The LLM never sizes positions or touches orders: it picks candidates and writes theses only.

## Wrongness detection
- Never claim done without evidence: `python3 -m compileall -q agent/src agent/scripts` clean AND `npm run build` green in `panel/` (or the specific test you ran, with output).
- After fixing a defect, re-verify the original failing behavior, not just that nothing new broke.
- Numbers shown in the panel must come from the journal DB. If you cannot point at the query that produced a number, it is a mock: delete it.

## Craft gates
- Zero raw hex/rgb outside `panel/app/globals.css` (`:root` block). Any hit in components = not done.
- No em dashes, en dashes, or double hyphens in any user-visible string, README, or docs. Use `·` for pairs, `:` for headings. Grep before commit.
- Copies follow design.md: light ground, sponsor gold as highlight (never text-on-light), three text tiers, tabular numerals in every numeric column.

## Never without a human
- Any real-money action or live-trading key.
- Publishing: pushing the public repo, deploying, posting socially, submitting to the hackathon.
- Sharing, committing, or logging any secret value (.env contents, keys).
- Deleting or rewriting the journal DB / JSONL trail (it is the audit record).
- Force-push or history rewrite on main.
