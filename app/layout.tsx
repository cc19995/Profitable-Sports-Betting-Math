import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Football +EV Desk",
  description: "NFL and NCAA football handicapping desk: calibrated P vs market S, juice, Kelly, parlays.",
};

const NAV = [
  ["Board", "/"],
  ["Ratings", "/ratings"],
  ["Lab", "/lab"],
  ["Parlay", "/parlay"],
  ["Calibration", "/calibration"],
  ["Math", "/math"],
] as const;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="min-h-screen">
          <header className="border-b border-[var(--line)] px-5 py-3 flex items-end justify-between gap-6">
            <div>
              <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--mute)]">Profitable Sports Betting Math</div>
              <div className="text-xl font-semibold tracking-tight">Football +EV Desk</div>
            </div>
            <nav className="flex flex-wrap gap-4 text-sm">
              {NAV.map(([label, href]) => (
                <Link key={href} href={href} className="text-[var(--mute)] hover:text-[var(--accent)]">
                  {label}
                </Link>
              ))}
            </nav>
          </header>
          <main className="px-5 py-5">{children}</main>
          <footer className="px-5 pb-8 text-xs text-[var(--mute)] leading-relaxed max-w-4xl">
            This is a handicapping model, not betting advice. It estimates a calibrated probability P and
            compares it to the sportsbook implied probability S. Profit requires P &gt; S after juice, a
            bankroll that survives variance, and honest calibration. If you have a gambling problem, call
            1-800-GAMBLER.
          </footer>
        </div>
      </body>
    </html>
  );
}
