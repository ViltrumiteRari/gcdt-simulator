export const REPLAY_QUALITY = {
  "2026-06-29": {
    level: "RED", label: "STRUCTURE ONLY",
    summary: "Historical SPX/GEX replay only; not execution-grade.",
    missingEssential: ["Native SPY options execution history", "Full option chain quotes/OI", "Cross-market minute context"],
  },
  "2026-06-30": {
    level: "RED", label: "STRUCTURE ONLY",
    summary: "Historical SPX/GEX replay only; not execution-grade.",
    missingEssential: ["Native SPY options execution history", "Full option chain quotes/OI", "Cross-market minute context"],
  },
  "2026-07-01": {
    level: "RED", label: "STRUCTURE ONLY",
    summary: "Historical SPX/GEX replay only; not execution-grade.",
    missingEssential: ["Native SPY options execution history", "Full option chain quotes/OI", "Cross-market minute context"],
  },
  "2026-07-02": {
    level: "RED", label: "STRUCTURE ONLY",
    summary: "Historical SPX/GEX replay only; not execution-grade.",
    missingEssential: ["Native SPY options execution history", "Full option chain quotes/OI", "Cross-market minute context"],
  },
  "2026-07-06": {
    level: "YELLOW", label: "REPLAY READY · CONTEXT LIMITED",
    summary: "Full-day GEX/spot and real option trade OHLCV are present.",
    missingEssential: ["Full-day historical NBBO/IV/OI snapshots", "Cross-market minute context", "Complete full-day order-flow archive"],
  },
  "2026-07-07": {
    level: "YELLOW", label: "REPLAY READY · PARTIAL CONTEXT",
    summary: "Full-day GEX/spot and option trade OHLCV are usable.",
    missingEssential: ["Cross-market context before 14:39", "Full-day historical NBBO/IV/OI snapshots", "Complete full-day order-flow archive"],
  },
  "2026-07-08": {
    level: "YELLOW", label: "REPLAY READY · PARTIAL CONTEXT",
    summary: "Full-day GEX/spot and option trade OHLCV are usable.",
    missingEssential: ["Cross-market context before 15:35", "Full-day historical NBBO/IV/OI snapshots", "Complete full-day order-flow archive"],
  },
  "2026-07-09": {
    level: "YELLOW", label: "REPLAY READY · HIGH CORE COVERAGE",
    summary: "Full-day GEX/spot and real option trade history, with live quotes from midday onward.",
    missingEssential: ["Cross-market context before 12:06", "Full-day historical NBBO/IV/OI snapshots", "Complete full-day order-flow archive"],
  },
  "2026-07-10": {
    level: "YELLOW", label: "REPLAY READY · HIGH CORE COVERAGE",
    summary: "Full-day GEX/spot, restored cross-market context, and real option trade OHLCV from 09:30–15:45.",
    missingEssential: ["Historical NBBO/IV/OI snapshots before 15:46", "Complete full-day consolidated order-flow archive"],
  },
};

export function replayQualityFor(date) {
  return REPLAY_QUALITY[date] || {
    level: "RED", label: "UNVERIFIED",
    summary: "Coverage has not been verified.",
    missingEssential: ["Verified replay coverage manifest"],
  };
}
