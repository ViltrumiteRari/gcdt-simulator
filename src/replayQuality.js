export const REPLAY_QUALITY = {
  "2026-06-29": { level: "YELLOW", label: "REPLAY READY \u00b7 STRUCTURE/OPTIONS SYNTHETIC", summary: "1,216 playback ticks; native source cadence 300 seconds; wall and continuity verification passed.", missingEssential: ["Native SPY option execution history"] },
  "2026-06-30": { level: "YELLOW", label: "REPLAY READY \u00b7 STRUCTURE/OPTIONS SYNTHETIC", summary: "1,216 playback ticks; native source cadence 300 seconds; wall and continuity verification passed.", missingEssential: ["Native SPY option execution history"] },
  "2026-07-01": { level: "YELLOW", label: "REPLAY READY \u00b7 STRUCTURE/OPTIONS SYNTHETIC", summary: "1,216 playback ticks; native source cadence 300 seconds; wall and continuity verification passed.", missingEssential: ["Native SPY option execution history"] },
  "2026-07-02": { level: "YELLOW", label: "REPLAY READY \u00b7 STRUCTURE/OPTIONS SYNTHETIC", summary: "1,216 playback ticks; native source cadence 300 seconds; wall and continuity verification passed.", missingEssential: ["Native SPY option execution history"] },
  "2026-07-06": { level: "GREEN", label: "REPLAY READY \u00b7 5-MINUTE NATIVE SOURCE", summary: "406 playback ticks; native source cadence 300 seconds; wall and continuity verification passed.", missingEssential: [] },
  "2026-07-07": { level: "GREEN", label: "REPLAY READY \u00b7 5-MINUTE NATIVE SOURCE", summary: "406 playback ticks; native source cadence 300 seconds; wall and continuity verification passed.", missingEssential: [] },
  "2026-07-08": { level: "GREEN", label: "REPLAY READY \u00b7 5-MINUTE NATIVE SOURCE", summary: "406 playback ticks; native source cadence 300 seconds; wall and continuity verification passed.", missingEssential: [] },
  "2026-07-09": { level: "GREEN", label: "REPLAY READY \u00b7 5-MINUTE NATIVE SOURCE", summary: "406 playback ticks; native source cadence 300 seconds; wall and continuity verification passed.", missingEssential: [] },
  "2026-07-10": { level: "GREEN", label: "REPLAY READY \u00b7 5-MINUTE NATIVE SOURCE", summary: "406 playback ticks; native source cadence 300 seconds; wall and continuity verification passed.", missingEssential: [] },
  "2026-07-13": { level: "YELLOW", label: "REPLAY READY \u00b7 5-MINUTE NATIVE SOURCE", summary: "1,216 playback ticks; native source cadence 300 seconds; wall and continuity verification passed.", missingEssential: ["Native full option-chain history"] },
  "2026-07-14": { level: "YELLOW", label: "REPLAY READY \u00b7 5-MINUTE NATIVE SOURCE", summary: "1,216 playback ticks; native source cadence 300 seconds; wall and continuity verification passed.", missingEssential: ["Native full option-chain history"] },
  "2026-07-15": { level: "GREEN", label: "REPLAY READY \u00b7 20-SECOND NATIVE CORE", summary: "1,216 playback ticks; native source cadence 20 seconds; wall and continuity verification passed.", missingEssential: [] },
  "2026-07-16": { level: "GREEN", label: "REPLAY READY \u00b7 20-SECOND NATIVE CORE", summary: "1,216 playback ticks; native source cadence 20 seconds; wall and continuity verification passed.", missingEssential: [] },
  "2026-07-17": { level: "GREEN", label: "REPLAY READY \u00b7 20-SECOND NATIVE CORE", summary: "1,216 playback ticks; native source cadence 20 seconds; wall and continuity verification passed.", missingEssential: [] },
  "2026-07-20": { level: "GREEN", label: "REPLAY READY \u00b7 20-SECOND NATIVE CORE", summary: "1,216 playback ticks; native source cadence 20 seconds; wall and continuity verification passed.", missingEssential: [] },
  "2026-07-21": { level: "YELLOW", label: "REPLAY READY * RECONSTRUCTED MIDDAY CORE", summary: "Usable 20-second replay, but midday SPY/SPX GEX was mathematically repaired from pre/post chain anchors and OptionStrat flow; chain/context continuity includes gap-filled indexes.", missingEssential: [], asterisk: true, qualityWeight: 0.65, benchmarkEligible: false, reasonCodes: ["MIDDAY_GEX_RECONSTRUCTION","CHAIN_INDEX_GAPFILLED","MARKET_CONTEXT_GAPFILLED"] },
};

export function replayQualityFor(date) {
  return REPLAY_QUALITY[date] || { level: "RED", label: "UNVERIFIED", summary: "Coverage has not been verified.", missingEssential: ["Verified replay coverage manifest"] };
}
