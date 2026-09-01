import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tape: the proof-carrying options desk",
  description:
    "An autonomous options agent on Alpaca paper trading. Every order ships a serial-numbered receipt: thesis, risk gates, raw MCP call, fill. The tape doesn't lie.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="app-frame">{children}</div>
      </body>
    </html>
  );
}
