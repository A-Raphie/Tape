# Tape: 5 posts for the submission (post through the window, tag @lablabai + @AlpacaHQ)

Numbers move live, so if a figure looks stale when you post, check the desk tile first.

---

## Post 1 · launch (pin this one)

Built an autonomous options agent for the @AlpacaHQ hackathon on @lablabai.

It trades 0-5 DTE credit spreads on paper. It also prints a serial-numbered receipt for every single thing it does: thesis, gate runs, raw MCP calls, fills, repairs.

19,000+ receipts. Losses in red, on the front page.

Live: tape.up.railway.app

---

## Post 2 · the receipt

Click any fill on my trading agent and the receipt unfolds:

· what happened, one sentence
· why: the analyst's own reasoning, citing the delta it saw
· the trade in English: sell the lower call, buy the one a dollar higher
· cash collected now · worst case at expiry
· the 13 gates it passed to exist

No dashboard can fake this. Every number comes from the journal.

---

## Post 3 · the freeze

Day 2 of the hackathon, my trading agent froze for ~90 minutes. Nobody was watching.

It held 0-DTE spreads into expiry. Assignment put the account at -$54,152.

I didn't hide it. The journal archived the whole blown account as receipts, I retired the account, and the new book trades with fill verification, position repair, and a reconcile pass every cycle.

The wall of clean reconcile stamps on the live site exists because it failed once, loudly.

---

## Post 4 · the gates

The LLM on my trading agent can propose trades. It cannot size them, cannot weaken a rule, and cannot touch the account except through 13 deterministic gates.

33 gate runs on record. 22 proposals died there, each one showing the exact gate that killed it ("not in the final 30 minutes", "max 2 positions per ticker").

Blocked trades are receipts too. Full record: tape.up.railway.app/rules

---

## Post 5 · honesty as a feature

Right now my hackathon agent's account holds -200 SPY short stock from a Sep 3 expiry assignment. Marked live on the equity tile. Receipted in every position read.

I could have submitted before that printed. I left it in, because the whole product is: the tape doesn't lie, and neither does the agent.

Paper account, $100k start, ~$97k now. Every dollar explained on screen.

---

## Assembly checklist (lablab.ai form)

- [ ] Repo: github.com/A-Raphie/tape
- [ ] Demo application platform + App URL: tape.up.railway.app
- [ ] Alpaca paper trading account ID: PA37YPE0PC51  (required for judging)
- [ ] Video: demo-take/tape-demo-v6.mp4 (repo blob: github.com/A-Raphie/tape/blob/main/demo-take/tape-demo-v6.mp4)
- [ ] Slide presentation: demo-take/tape-deck.pdf
- [ ] One-page write-up: github.com/A-Raphie/tape/blob/main/docs/WRITEUP.md
- [ ] Cover image: demo-take/tape-cover.png (1200x630)
- [ ] Short + long description + tech tags (Alpaca, MCP, Groq, Next.js)
- [ ] Up to 5 post links (above, once posted)
- [ ] DEADLINE 15:00 UTC · target 14:30 UTC
