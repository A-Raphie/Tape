import type { Metadata, Viewport } from "next";
import "./globals.css";
import { TopBar, Footer } from "./shell";

export const metadata: Metadata = {
  metadataBase: new URL("https://tape.up.railway.app"),
  title: {
    default: "Tape: the proof-carrying options desk",
    template: "%s · Tape",
  },
  description:
    "An autonomous options agent on Alpaca paper trading. Every order ships a serial-numbered receipt: thesis, risk gates, raw MCP call, fill. The tape doesn't lie.",
  openGraph: {
    title: "Tape: the proof-carrying options desk",
    description:
      "Every order the agent places ships a serial-numbered receipt, and a reconcile pass proves the journal matches the account.",
    url: "https://tape.up.railway.app",
    siteName: "Tape",
    images: [{ url: "/og.png", width: 1200, height: 630 }],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Tape: the proof-carrying options desk",
    description: "Every order ships a receipt: thesis, gates, raw call, fill.",
    images: ["/og.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#f7f7f7",
  colorScheme: "light",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <TopBar />
        <main id="main" className="shell-main">
          {children}
        </main>
        <Footer />
      </body>
    </html>
  );
}
