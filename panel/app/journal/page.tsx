"use client";

/* Journal: nightly grades, lessons, and the analyst's verdicts. */

import { useApi } from "../kit";

type Lesson = { id: number; ts: string; trade_id: string | null; lesson: string; source: string };
type Receipt = { serial: number; ts: string; kind: string; payload: string; ok: number };

export default function Journal() {
  const { data: lessonsRes, failed, refresh } = useApi<{ lessons: Lesson[] }>("/api/lessons", 15000);
  const { data: receiptsRes } = useApi<{ receipts: Receipt[] }>("/api/receipts?limit=300", 30000);
  const grades = (receiptsRes?.receipts ?? []).filter((r) => r.kind === "scribe_grade");
  const verdicts = (receiptsRes?.receipts ?? []).filter((r) => r.kind === "llm_judgment").slice(0, 6);
  const lessons = lessonsRes?.lessons ?? [];

  return (
    <div className="page">
      {failed ? (
        <div className="row api-fail">
          <span className="stamp stamp-error">JOURNAL UNREACHABLE</span>
          <span className="caption">showing nothing rather than guessing ·</span>
          <button className="btn btn-ghost api-retry" onClick={refresh}>
            Retry
          </button>
        </div>
      ) : null}
      <header className="page-head">
        <h1 className="page-title">Journal</h1>
        <p className="page-desc">
          The desk grades its own closed trades and writes down what would change tomorrow. Lessons stay on the
          record, including the ones that hurt.
        </p>
      </header>

      <section className="desk-section">
        <h2 className="section-title">Lessons</h2>
        {lessons.length === 0 ? (
          <p className="caption empty-note">
            The scribe grades closed trades at the end of each session and writes what would change tomorrow. First
            grading lands after today's close.
          </p>
        ) : (
          <div className="card">
            {lessons.map((l) => (
              <div key={l.id} className="row">
                <span className="mono caption">{l.trade_id ?? "desk"}</span>
                <span className="lesson-text">{l.lesson}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="desk-section">
        <h2 className="section-title">Nightly grades</h2>
        {grades.length === 0 ? (
          <p className="caption empty-note">Each session close, the scribe grades every closed trade. First grading lands after today's close.</p>
        ) : (
          <div className="card">
            {grades.map((g) => {
              let summary = "grade recorded";
              try {
                const p = JSON.parse(g.payload);
                summary = `graded ${p.graded ?? "?"} trades · ${p.lessons ?? "?"} lessons written`;
              } catch {}
              return (
                <div key={g.serial} className="row">
                  <span className="serial">#{g.serial}</span>
                  <span className="caption">{g.ts.slice(5, 16).replace("T", " ")}</span>
                  <span className="lesson-text">{summary}</span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="desk-section">
        <h2 className="section-title">Analyst verdicts</h2>
        {verdicts.length === 0 ? (
          <p className="caption empty-note">The analyst's pick-and-reject verdicts land here as receipts.</p>
        ) : (
          <div className="card">
            {verdicts.map((v) => {
              let thesis = "";
              try {
                const p = JSON.parse(v.payload);
                const out = JSON.parse(p.output ?? "{}");
                thesis = (out.picks ?? []).map((x: { candidate_id: string }) => x.candidate_id).join(", ");
              } catch {
                thesis = "";
              }
              return (
                <div key={v.serial} className="row">
                  <span className="serial">#{v.serial}</span>
                  <span className="caption">{v.ts.slice(5, 16).replace("T", " ")}</span>
                  <span className="lesson-text">{thesis ? `picked: ${thesis}` : "verdict recorded"}</span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
