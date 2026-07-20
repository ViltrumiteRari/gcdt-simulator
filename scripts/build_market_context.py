import json
from pathlib import Path

ROOT = Path(r"C:\Users\adahy\Desktop\FirstSignal Sim v1")
REPLAYS = ROOT / "public" / "replays"
RESEARCH = ROOT / "market-context-research"
TRADER = ROOT / "public" / "trader-context"
RESEARCH.mkdir(exist_ok=True)
TRADER.mkdir(exist_ok=True)

def classify(open_, high, low, close):
    change = close - open_
    rng = max(high - low, 0.01)
    loc = (close - low) / rng
    if abs(change) < 0.15 and rng < 1.2: return "compressed/pinned"
    if change > 0.5 and loc > 0.7: return "uptrend/late strength"
    if change < -0.5 and loc < 0.3: return "downtrend/late weakness"
    if loc > 0.7: return "recovery/close near highs"
    if loc < 0.3: return "fade/close near lows"
    return "two-way/rotation"

def main():
    files = sorted(p for p in REPLAYS.glob("2026-*.json"))
    prior = []
    for p in files:
        replay = json.loads(p.read_text(encoding="utf-8"))
        snaps = replay["snapshots"]
        spots = [float(x["spySpot"]) for x in snaps if x.get("spySpot") is not None]
        o, h, l, c = spots[0], max(spots), min(spots), spots[-1]
        label = classify(o, h, l, c)
        result = {
            "date": replay["date"], "status": "INITIAL_PRICE_ACTION_NARRATIVE",
            "observed": {"spy_open": round(o,3), "spy_high": round(h,3), "spy_low": round(l,3), "spy_close": round(c,3), "open_to_close": round(c-o,3), "range": round(h-l,3), "shape": label},
            "premarket_known_by_0930": {"source_status": "EXTERNAL_NEWS_RESEARCH_PENDING", "items": [], "scheduled_events": [], "starting_prior": "neutral_until_source_verified"},
            "intraday_catalysts": {"source_status": "POSTHOC_RESEARCH_PENDING", "items": []},
            "causal_narrative": f"Observed SPY session was {label}. This is a price-action description, not yet a sourced claim about external causation.",
            "alternative_explanations": ["dealer positioning and option hedging", "cross-asset risk repricing", "megacap leadership or breadth", "scheduled or unscheduled headlines"],
            "confidence": {"price_action": 1.0, "external_causation": 0.0},
            "trader_visibility": "NEVER_DIRECTLY_VISIBLE"
        }
        (RESEARCH / f"{replay['date']}.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
        packet = {
            "date": replay["date"], "as_of_et": f"{replay['date']}T09:29:59-04:00",
            "information_boundary": "Only information available by 09:30 ET may appear here.",
            "prior_days_context": prior[-5:],
            "same_day_premarket": result["premarket_known_by_0930"],
            "authority": {"role": "starting_prior_only", "must_not_force_trade": True, "live_market_can_disprove": True, "suggested_open_weight_pct": 20},
            "research_integrity": "No post-09:30 information or end-of-day outcome is included. External news remains pending until source-verified."
        }
        (TRADER / f"{replay['date']}.json").write_text(json.dumps(packet, indent=2), encoding="utf-8")
        prior.append({"date": replay["date"], "shape": label, "open_to_close": round(c-o,3), "range": round(h-l,3), "causal_status": "external_research_pending"})
    (RESEARCH / "README.md").write_text("# Market Context Research\n\nResearch-only, hindsight-safe archive. The trader and simulator must never read this folder. Each day stores observed price action, premarket facts, intraday catalysts, post-close causal narrative, alternatives, and confidence. Populate external claims only with time-bounded sources.\n", encoding="utf-8")
    print(f"built {len(files)} research records and trader-safe packets")

if __name__ == "__main__": main()
