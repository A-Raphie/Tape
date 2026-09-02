"use client";

/* Receipts: paste a serial, open its receipt. The whole archive is lookup-able. */

import Link from "next/link";
import { useState } from "react";
import { ReceiptModal, type Receipt } from "../kit";

export default function Receipts() {
  const [value, setValue] = useState("");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "missing">("idle");
  const [queried, setQueried] = useState<number | null>(null);

  const lookup = () => {
    const n = parseInt(value.trim(), 10);
    if (!Number.isFinite(n) || n <= 0) {
      setStatus("missing");
      setQueried(n || null);
      return;
    }
    setStatus("loading");
    setQueried(n);
    fetch(`https://tape.up.railway.app/api/serial/${n}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) {
          setReceipt(data as Receipt);
          setStatus("idle");
        } else {
          setReceipt(null);
          setStatus("missing");
        }
      })
      .catch(() => setStatus("missing"));
  };

  return (
    <div className="page">
      <header className="page-head">
        <h1 className="page-title">Receipts</h1>
        <p className="page-desc">
          Every action the desk has ever taken has a serial number. Paste one and read its full receipt: thesis,
          rules, order, outcome.
        </p>
      </header>

      <section className="desk-section">
        <form
          className="lookup-row"
          onSubmit={(e) => {
            e.preventDefault();
            lookup();
          }}
        >
          <input
            className="input lookup-input"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            inputMode="numeric"
            placeholder="e.g. 445"
            aria-label="receipt serial number"
          />
          <button type="submit" className="btn btn-primary">
            Open receipt
          </button>
        </form>
        {status === "loading" ? <p className="caption">Fetching receipt #{queried}…</p> : null}
        {status === "missing" ? (
          <p className="caption empty-note">
            Receipt #{queried ?? "?"} isn't in the journal under that serial. Serials are the small gold numbers on
            every row and chip.
          </p>
        ) : null}
        <p className="caption">
          Fresh from today's tape: <Link href="/desk/" className="lookup-link">the desk blotter</Link> lists the newest
          serials · source of record: the journal on{" "}
          <a href="https://github.com/A-Raphie/tape" target="_blank" rel="noreferrer" className="lookup-link">
            GitHub
          </a>
        </p>
      </section>

      <ReceiptModal receipt={receipt} onClose={() => setReceipt(null)} />
    </div>
  );
}
