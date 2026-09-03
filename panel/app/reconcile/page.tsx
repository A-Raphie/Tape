"use client";

/* Reconcile: the honesty table. Journal claims vs account ground truth,
   every cycle. */

import { useApi } from "../kit";

type ReconcileRun = { id: number; ts: string; clean: boolean; diffs: { type: string; symbol: string }[] };

export default function Reconcile() {
  const { data: reconcileRes, failed, refresh } = useApi<{ runs: ReconcileRun[] }>("/api/reconcile", 6000);
  const runs = reconcileRes?.runs ?? [];
  const latest = runs[0];
  let streak = 0;
  for (const r of runs) {
    if (r.clean) streak += 1;
    else break;
  }
  const mismatchTotal = runs.filter((r) => !r.clean).length;

  return (
    <div className="page">
      <header className="page-head">
        <h1 className="page-title">Reconcile</h1>
        <p className="page-desc">
          Every cycle the desk compares its own journal against the account's real positions. This table is the
          product's proof: a clean stamp means the agent's story and the broker's books agree.
        </p>
      </header>

      {failed ? (
        <div className="row api-fail">
          <span className="stamp stamp-error">JOURNAL UNREACHABLE</span>
          <span className="caption">showing nothing rather than guessing ·</span>
          <button className="btn btn-ghost api-retry" onClick={refresh}>
            Retry
          </button>
        </div>
      ) : null}
      {latest ? (
        <section className="desk-section">
          <div className="card">
            <div className="row row-head-static">
              <span className="number-lg">{streak}</span>
              <span className="caption">
                consecutive clean passes · {mismatchTotal} mismatch pass(es) in the last {runs.length}, each named and
                repaired below in history
              </span>
            </div>
            <div className="row row-head-static">
              <span className={`stamp ${latest.clean ? "stamp-match" : "stamp-mismatch"}`}>
                {latest.clean ? "MATCH" : "MISMATCH"}
              </span>
              <span className="caption">{latest.ts.slice(5, 16).replace("T", " ")} UTC</span>
              <span className="caption">{latest.diffs.length} diffs on the latest pass</span>
            </div>
            {latest.diffs.map((d, i) => (
              <div key={i} className="row">
                <span className="stamp stamp-error">{d.type}</span>
                <span className="mono">{d.symbol}</span>
              </div>
            ))}
          </div>
        </section>
      ) : (
        <p className="caption empty-note">First reconcile pass lands here within a minute of the desk starting.</p>
      )}

      <section className="desk-section">
        <h2 className="section-title">Recent passes</h2>
        {runs.length === 0 ? (
          <p className="caption empty-note">No passes recorded yet.</p>
        ) : (
          <div className="card">
            {runs.map((r) => (
              <div key={r.id} className="row reconcile-row">
                <span className={`stamp ${r.clean ? "stamp-match" : "stamp-mismatch"}`}>{r.clean ? "MATCH" : "MISMATCH"}</span>
                <span className="caption">{r.ts.slice(5, 16).replace("T", " ")}</span>
                <span className="caption">{r.diffs.length === 0 ? "journal and account agree" : `${r.diffs.length} diff(s)`}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="desk-section">
        <h2 className="section-title">How the check works</h2>
        <p className="caption reconcile-how">
          The journal is the agent's own diary: every proposal, gate, order and fill has a serial number. The account
          is Alpaca's record of what actually happened. Each cycle the desk compares the two: every position on the
          account must have a receipt, and every open receipt must have a position. Drift gets named, stamped, and
          repaired with a lesson.
        </p>
      </section>
    </div>
  );
}
