import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Receipts",
  description: "Look up any receipt in the Tape journal by serial number: thesis, risk gates, raw broker call, fill.",
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
