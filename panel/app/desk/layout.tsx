import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Desk",
  description: "Desk surface of Tape, the proof-carrying options desk: live receipts, risk gates, and reconciliation against the Alpaca account.",
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
