import { useState, useEffect, useRef, useCallback } from "react";

// ── CONFIG ─────────────────────────────────────────────────────────────────
const STARTING_BALANCE = 1000;
const BASE_TICK_MS = 4000;
const SESSION_END_H = 16;
const SESSION_END_M = 0;
const TOTAL_TICKS = 390;
const TRADER_API = "https://firstsignal-os.vercel.app/api/trader";
const GDRIVE_FOLDER_ID = "1WflnDrN_fNp3szQ51totm87EeS7-bojs";

const T = {
  bg: "#07090c", surface: "#0e1117", surface2: "#141920",
  border: "#1a2030", accent: "#00d4a8", accentDim: "#00d4a818",
  red: "#ff4060", redDim: "#ff406018", yellow: "#f0c040",
  yellowDim: "#f0c04018", text: "#dde4f0", muted: "#4a5568", dim: "#1e2530",
};

// ── MARKET ENGINE ──────────────────────────────────────────────────────────
function createEngine() {
  const ANCHOR = {
    spot: 740.51, gammaFlip: 740.0, callWall: 750.0,
    putWall: 700.0, fep: 738.71, accelerator: 6.77,
    netGex: -777000000, pcr: 1.31, iv: 15.32,
  };
  const drivers = {
    trend: (Math.random() - 0.48) * 0.55,
    volMult: 0.7 + Math.random() * 0.9,
    macroTick: Math.floor(30 + Math.random() * 220),
    macroDir: Math.random() > 0.5 ? 1 : -1,
    macroPct: 0.25 + Math.random() * 0.55,
    macroRecovery: Math.random() > 0.4,
    qeBuyTick: Math.floor(140 + Math.random() * 70),
    dayType: ["discovery", "harvest", "chop", "trend"][Math.floor(Math.random() * 4)],
  };
  let s = {
    spot: ANCHOR.spot, gammaFlip: ANCHOR.gammaFlip,
    callWall: ANCHOR.callWall, putWall: ANCHOR.putWall,
    fep: ANCHOR.fep, accelerator: ANCHOR.accelerator,
    netGex: ANCHOR.netGex, itsSpy: 5.2, itsComposite: 5.6,
    ndf: 0.2, dealerPct: 35, iv: ANCHOR.iv, pcr: ANCHOR.pcr,
    tick: 0, h: 9, m: 30,
  };

  function tick() {
    const t = s.tick;
    const prog = t / TOTAL_TICKS;
    let dSpot = drivers.trend * 0.07;
    const toFlip = s.gammaFlip - s.spot;
    dSpot += toFlip * (s.netGex < 0 ? 0.0025 : 0.005);
    if (s.spot > s.callWall - 2.5) dSpot -= 0.15;
    if (s.spot < s.putWall + 2.5) dSpot += 0.15;
    if (drivers.dayType === "trend") dSpot += drivers.trend * 0.08;
    if (drivers.dayType === "chop") dSpot *= 0.4;
    if (drivers.dayType === "harvest" && prog > 0.25 && prog < 0.75) dSpot *= 0.3;
    if (t === drivers.macroTick) dSpot += drivers.macroDir * drivers.macroPct * 0.8;
    if (t > drivers.macroTick && t < drivers.macroTick + 20) {
      const fade = 1 - (t - drivers.macroTick) / 20;
      dSpot += (drivers.macroRecovery ? -drivers.macroDir : drivers.macroDir) * 0.04 * fade;
    }
    if (t >= drivers.qeBuyTick && t < drivers.qeBuyTick + 10) dSpot += 0.07;
    if (t >= drivers.qeBuyTick + 10 && t < drivers.qeBuyTick + 22) dSpot -= 0.05;
    if (prog > 0.78) dSpot *= 0.55;
    dSpot += (Math.random() - 0.5) * 0.32 * drivers.volMult;
    const newSpot = Math.max(s.putWall + 4, Math.min(s.callWall - 0.5, s.spot + dSpot));
    const newFep = s.fep * 0.87 + (newSpot - (Math.random() - 0.45) * 1.6) * 0.13;
    const accelTarget = 2.5 + Math.abs(dSpot) * 16 * drivers.volMult;
    const macroBoost = (t >= drivers.macroTick && t < drivers.macroTick + 6) ? 3.5 : 0;
    const newAccel = Math.max(1, Math.min(12, s.accelerator * 0.8 + accelTarget * 0.2 + macroBoost + (Math.random() - 0.5) * 0.5));
    const newGex = Math.min(600000000, s.netGex * 0.998 + (Math.random() - 0.5) * 4000000);
    const mom = (newSpot - s.spot) / s.spot * 1000;
    const newItsSpy = Math.max(1, Math.min(12, s.itsSpy * 0.72 + (5.5 + mom * 9) * 0.28 + (Math.random() - 0.5) * 0.45));
    const newItsComp = Math.max(1, Math.min(12, s.itsComposite * 0.84 + newItsSpy * (0.87 + Math.random() * 0.2) * 0.16 + (Math.random() - 0.5) * 0.28));
    const newNdf = s.ndf * 0.68 + (mom * 0.55 + (Math.random() - 0.5) * 0.35) * 0.32;
    const dealerT = 22 + (1 - Math.abs(newGex) / 1800000000) * 48;
    const newDealer = Math.max(8, Math.min(78, s.dealerPct * 0.83 + dealerT * 0.17 + (Math.random() - 0.5) * 2.5));
    const newPcr = Math.max(0.55, Math.min(2.3, s.pcr * 0.94 + (1.18 + (Math.random() - 0.5) * 0.18) * 0.06));
    const newIv = Math.max(7, Math.min(38, s.iv * 0.91 + (11 + Math.abs(dSpot) * 22) * 0.09));
    let { h, m } = s; m += 1;
    if (m >= 60) { m = 0; h += 1; }
    s = { ...s, spot: newSpot, fep: newFep, accelerator: newAccel, netGex: newGex, itsSpy: newItsSpy, itsComposite: newItsComp, ndf: newNdf, dealerPct: newDealer, pcr: newPcr, iv: newIv, tick: t + 1, h, m };
    return { ...s };
  }
  function getDrivers() { return { ...drivers }; }
  function peek() { return { ...s }; }
  return { tick, getDrivers, peek };
}

// ── BSM PRICING ────────────────────────────────────────────────────────────
function ncdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp(-x * x / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.7814779 + t * (-1.8212560 + t * 1.3302744))));
  return x > 0 ? 1 - p : p;
}
function priceOpt(spot, strike, iv, minsLeft, isCall) {
  if (minsLeft <= 0) return Math.max(0.01, isCall ? Math.max(0, spot - strike) : Math.max(0, strike - spot));
  const TT = minsLeft / (252 * 390), sig = iv / 100, sq = Math.sqrt(TT);
  const d1 = (Math.log(spot / strike) + 0.5 * sig * sig * TT) / (sig * sq);
  const d2 = d1 - sig * sq;
  const p = isCall ? spot * ncdf(d1) - strike * ncdf(d2) : strike * ncdf(-d2) - spot * ncdf(-d1);
  return Math.max(0.01, Math.round(p * 100) / 100);
}

// ── AI TRADER ──────────────────────────────────────────────────────────────
async function callAI(mkt, pos, bal, log, history) {
  const tStr = `${mkt.h}:${String(mkt.m).padStart(2, "0")} ET`;
  const mLeft = (SESSION_END_H * 60 + SESSION_END_M) - (mkt.h * 60 + mkt.m);
  const theta = mLeft < 90;
  const div = mkt.itsSpy - mkt.itsComposite;
  const recentH = history.slice(-5).map(c =>
    `${c.t} SPY:${c.spot.toFixed(2)} DIV:${(c.itsSpy - c.itsComp).toFixed(2)} ACCEL:${c.accel.toFixed(1)} FEP-GAP:${(c.spot - c.fep).toFixed(2)}`
  ).join("\n");
  const posStr = pos ? `OPEN: ${pos.strike}${pos.isCall ? "C" : "P"} entry $${pos.entry.toFixed(2)} now $${pos.current.toFixed(2)} (${((pos.current / pos.entry - 1) * 100).toFixed(0)}%)` : "NO POSITION";

  const prompt = `GCDT SPY 0DTE trader. ONE decision.

${tStr} | ${mLeft}min left | THETA:${theta ? "YES-NO NEW" : "no"}
BAL:$${bal.toFixed(0)} | ${posStr}

SPY:$${mkt.spot.toFixed(2)} | Flip:$${mkt.gammaFlip.toFixed(2)}(${mkt.spot > mkt.gammaFlip ? "ABOVE" : "BELOW"}) | GEX:${(mkt.netGex / 1e6).toFixed(0)}M(${mkt.netGex < 0 ? "AMPLIFY" : "PIN"})
FEP:$${mkt.fep.toFixed(2)} gap:${(mkt.spot - mkt.fep).toFixed(2)} | CallWall:$${mkt.callWall.toFixed(2)} | PutWall:$${mkt.putWall.toFixed(2)}
ITS-SPY:${mkt.itsSpy.toFixed(2)} COMPOSITE:${mkt.itsComposite.toFixed(2)} DIV:${div.toFixed(2)}(${div > 0.4 ? "SPY-LEAD=false" : div < -0.4 ? "COMP-LEAD=conviction" : "converged"})
ACCEL:${mkt.accelerator.toFixed(2)} | NDF:${mkt.ndf.toFixed(3)} | DEALER:${mkt.dealerPct.toFixed(0)}%

RECENT:
${recentH}

RULES: entry $0.15-$0.25 only | composite leads=enter | SPY leads at resistance=exit | exit when accel peaks+rolls or FEP catches spot | no new entries <90min | one position at a time

Respond ONLY valid JSON no markdown:
{"decision":"WAIT|BUY_CALL|BUY_PUT|SELL|HOLD","strike":null,"reasoning":"one sentence","mindset":"what you are watching","confidence":7}`;

  const resp = await fetch(TRADER_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  if (!resp.ok) throw new Error(`Proxy ${resp.status}`);
  const data = await resp.json();
  if (data.decision) return data;
  throw new Error("Bad response shape");
}

// ── HELPERS ────────────────────────────────────────────────────────────────
const fmt = {
  bal: v => v >= 1e6 ? `$${(v / 1e6).toFixed(3)}M` : v >= 1000 ? `$${(v / 1000).toFixed(1)}K` : `$${v.toFixed(0)}`,
  pct: v => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`,
  time: (h, m) => `${h}:${String(m).padStart(2, "0")}`,
  gex: v => `${(v / 1e6).toFixed(0)}M`,
  sessionName: (n, type, pct) => `SIM-${String(n).padStart(2, "0")} · ${type} · ${pct >= 0 ? "+" : ""}${pct.toFixed(0)}%`,
};

// ── SCROLLABLE PRICE CHART ─────────────────────────────────────────────────
function PriceChart({ candles, currentTime, gammaFlip, callWall, putWall, position }) {
  const containerRef = useRef(null);
  const [scrollX, setScrollX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState(0);
  const [scrollStart, setScrollStart] = useState(0);
  const [hoveredIdx, setHoveredIdx] = useState(null);

  const W = 340, H = 140;
  const BAR_W = 6, BAR_GAP = 2;
  const STEP = BAR_W + BAR_GAP;
  const PADDING = { top: 8, bottom: 24, left: 8, right: 8 };

  const totalWidth = Math.max(W, candles.length * STEP + PADDING.left + PADDING.right);
  const maxScroll = Math.max(0, totalWidth - W);

  // Auto-scroll to end when new candles arrive
  useEffect(() => {
    if (!isDragging) {
      setScrollX(maxScroll);
    }
  }, [candles.length, maxScroll, isDragging]);

  const spots = candles.map(c => c.spot);
  const allLevels = [gammaFlip, callWall, putWall, ...spots];
  const minP = Math.min(...allLevels) - 0.5;
  const maxP = Math.max(...allLevels) + 0.5;
  const range = maxP - minP || 1;

  const toY = v => PADDING.top + ((maxP - v) / range) * (H - PADDING.top - PADDING.bottom);
  const toX = i => PADDING.left + i * STEP - scrollX;

  // Touch/mouse handlers
  const onPointerDown = (e) => {
    setIsDragging(true);
    setDragStart(e.clientX || e.touches?.[0]?.clientX || 0);
    setScrollStart(scrollX);
    e.preventDefault();
  };
  const onPointerMove = (e) => {
    if (!isDragging) return;
    const clientX = e.clientX || e.touches?.[0]?.clientX || 0;
    const dx = dragStart - clientX;
    setScrollX(Math.max(0, Math.min(maxScroll, scrollStart + dx)));
    // Find hovered candle
    const relX = clientX - (containerRef.current?.getBoundingClientRect().left || 0) + scrollX;
    const idx = Math.floor((relX - PADDING.left) / STEP);
    setHoveredIdx(idx >= 0 && idx < candles.length ? idx : null);
  };
  const onPointerUp = () => setIsDragging(false);

  // Visible range for time labels
  const firstVisible = Math.max(0, Math.floor(scrollX / STEP));
  const lastVisible = Math.min(candles.length - 1, Math.ceil((scrollX + W) / STEP));

  // Time label indices — show every 30 candles
  const timeLabelIndices = candles.reduce((acc, c, i) => {
    if (i % 30 === 0 || i === candles.length - 1) acc.push(i);
    return acc;
  }, []);

  const hoveredCandle = hoveredIdx !== null ? candles[hoveredIdx] : null;

  return (
    <div style={{ position: "relative", touchAction: "none" }}>
      {/* Time header bar */}
      <div style={{
        background: T.surface2, borderBottom: `1px solid ${T.border}`,
        padding: "4px 8px", display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <span style={{ fontSize: 9, color: T.muted, letterSpacing: "0.1em" }}>PRICE CHART</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: T.accent, fontFamily: "monospace" }}>
          {currentTime}
        </span>
        <span style={{ fontSize: 9, color: T.muted }}>
          {hoveredCandle ? `${hoveredCandle.t} · $${hoveredCandle.spot.toFixed(2)}` : "drag to scroll"}
        </span>
      </div>

      {/* Chart SVG */}
      <div
        ref={containerRef}
        style={{ overflow: "hidden", cursor: isDragging ? "grabbing" : "grab", userSelect: "none" }}
        onMouseDown={onPointerDown}
        onMouseMove={onPointerMove}
        onMouseUp={onPointerUp}
        onMouseLeave={onPointerUp}
        onTouchStart={onPointerDown}
        onTouchMove={onPointerMove}
        onTouchEnd={onPointerUp}
      >
        <svg width={W} height={H} style={{ display: "block" }}>
          {/* Background */}
          <rect width={W} height={H} fill={T.surface} />

          {/* GEX level lines */}
          {[
            { v: callWall, color: T.accent, label: "CW" },
            { v: gammaFlip, color: T.yellow, label: "FLIP" },
            { v: putWall, color: T.red, label: "PW" },
          ].map(({ v, color, label }) => {
            const y = toY(v);
            if (y < PADDING.top || y > H - PADDING.bottom) return null;
            const x = toX(firstVisible);
            return (
              <g key={label}>
                <line x1={0} y1={y} x2={W} y2={y} stroke={color} strokeWidth={0.5} strokeDasharray="3,3" opacity={0.5} />
                <text x={W - 4} y={y - 2} fill={color} fontSize={7} textAnchor="end" opacity={0.8}>{label}</text>
              </g>
            );
          })}

          {/* Price line */}
          {candles.length > 1 && (() => {
            const pts = candles.map((c, i) => {
              const x = toX(i) + BAR_W / 2;
              const y = toY(c.spot);
              return `${x},${y}`;
            }).join(" ");
            return <polyline points={pts} fill="none" stroke={T.text} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />;
          })()}

          {/* FEP line */}
          {candles.length > 1 && (() => {
            const pts = candles.map((c, i) => {
              const x = toX(i) + BAR_W / 2;
              const y = toY(c.fep);
              return `${x},${y}`;
            }).join(" ");
            return <polyline points={pts} fill="none" stroke={T.muted} strokeWidth={0.8} strokeDasharray="2,2" opacity={0.5} />;
          })()}

          {/* Trade markers */}
          {position && (() => {
            const entryIdx = candles.findIndex(c => c.t === position.entryTime);
            if (entryIdx < 0) return null;
            const x = toX(entryIdx) + BAR_W / 2;
            const y = toY(candles[entryIdx].spot);
            return (
              <g>
                <circle cx={x} cy={y} r={4} fill={position.isCall ? T.accent : T.red} opacity={0.9} />
                <line x1={x} y1={y} x2={x} y2={H - PADDING.bottom} stroke={position.isCall ? T.accent : T.red} strokeWidth={0.5} strokeDasharray="2,2" opacity={0.4} />
              </g>
            );
          })()}

          {/* Hover crosshair */}
          {hoveredCandle && hoveredIdx !== null && (() => {
            const x = toX(hoveredIdx) + BAR_W / 2;
            const y = toY(hoveredCandle.spot);
            if (x < 0 || x > W) return null;
            return (
              <g>
                <line x1={x} y1={PADDING.top} x2={x} y2={H - PADDING.bottom} stroke={T.muted} strokeWidth={0.5} opacity={0.5} />
                <line x1={0} y1={y} x2={W} y2={y} stroke={T.muted} strokeWidth={0.5} opacity={0.5} />
                <circle cx={x} cy={y} r={3} fill={T.text} />
              </g>
            );
          })()}

          {/* Current price dot */}
          {candles.length > 0 && (() => {
            const last = candles[candles.length - 1];
            const x = toX(candles.length - 1) + BAR_W / 2;
            const y = toY(last.spot);
            if (x < 0 || x > W) return null;
            return <circle cx={x} cy={y} r={3} fill={T.accent} />;
          })()}

          {/* Time labels */}
          {timeLabelIndices.map(i => {
            const x = toX(i) + BAR_W / 2;
            if (x < 20 || x > W - 20) return null;
            return (
              <text key={i} x={x} y={H - 6} fill={T.muted} fontSize={7} textAnchor="middle">
                {candles[i].t}
              </text>
            );
          })}

          {/* Price axis labels */}
          {[minP + range * 0.25, minP + range * 0.5, minP + range * 0.75].map((v, i) => (
            <text key={i} x={4} y={toY(v)} fill={T.dim} fontSize={7} dominantBaseline="middle">
              ${v.toFixed(0)}
            </text>
          ))}
        </svg>
      </div>

      {/* Scrollbar indicator */}
      {maxScroll > 0 && (
        <div style={{ height: 2, background: T.dim, margin: "0 8px" }}>
          <div style={{
            height: "100%",
            width: `${(W / totalWidth) * 100}%`,
            marginLeft: `${(scrollX / totalWidth) * 100}%`,
            background: T.muted,
            borderRadius: 1,
            transition: isDragging ? "none" : "margin-left 0.1s",
          }} />
        </div>
      )}
    </div>
  );
}

// ── MINI SPARK ─────────────────────────────────────────────────────────────
function Spark({ data, color, h = 28, w = 80 }) {
  if (!data || data.length < 2) return null;
  const mn = Math.min(...data), mx = Math.max(...data), rng = mx - mn || 1;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - mn) / rng) * (h - 4) - 2}`).join(" ");
  return <svg width={w} height={h} style={{ display: "block" }}><polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" /></svg>;
}

// ── STORAGE ────────────────────────────────────────────────────────────────
const STORAGE_KEY = "gcdt_sessions_v2";
function loadSessions() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); } catch { return []; } }
function saveSessions(s) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { } }

// ── APP ────────────────────────────────────────────────────────────────────
export default function App() {
  const [screen, setScreen] = useState("home");
  const [running, setRunning] = useState(false);
  const [mkt, setMkt] = useState(null);
  const [pos, setPos] = useState(null);
  const [bal, setBal] = useState(STARTING_BALANCE);
  const [tradeLog, setTradeLog] = useState([]);
  const [mindsetLog, setMindsetLog] = useState([]);
  const [candleHist, setCandleHist] = useState([]);
  const [itsSpyHist, setItsSpyHist] = useState([]);
  const [itsCompHist, setItsCompHist] = useState([]);
  const [accelHist, setAccelHist] = useState([]);
  const [thinking, setThinking] = useState(false);
  const [done, setDone] = useState(false);
  const [speedMult, setSpeedMult] = useState(1);
  const [aiFreq, setAiFreq] = useState(8);
  const [sessions, setSessions] = useState(loadSessions);
  const [reviewSession, setReviewSession] = useState(null);
  const [savedToDrive, setSavedToDrive] = useState(false);
  const [savingToDrive, setSavingToDrive] = useState(false);
  const [sessionCount, setSessionCount] = useState(() => loadSessions().length + 1);
  const [dayType, setDayType] = useState("—");
  const [skipping, setSkipping] = useState(false);

  const engRef = useRef(null);
  const balRef = useRef(STARTING_BALANCE);
  const posRef = useRef(null);
  const logRef = useRef([]);
  const candleRef = useRef([]);
  const tickRef = useRef(0);
  const thinkingRef = useRef(false);
  const intervalRef = useRef(null);
  const mindsetRef = useRef([]);

  const addMindset = useCallback((entry) => {
    mindsetRef.current = [...mindsetRef.current.slice(-60), entry];
    setMindsetLog([...mindsetRef.current]);
  }, []);

  const doTick = useCallback((eng) => {
    const m = eng.tick();
    tickRef.current += 1;
    const mLeft = (SESSION_END_H * 60 + SESSION_END_M) - (m.h * 60 + m.m);

    if (posRef.current) {
      const np = priceOpt(m.spot, posRef.current.strike, m.iv, mLeft, posRef.current.isCall);
      posRef.current = { ...posRef.current, current: np };
      setPos({ ...posRef.current });
    }

    if (m.h >= SESSION_END_H) {
      if (posRef.current) {
        const p = posRef.current;
        const ret = (p.current / p.entry - 1) * 100;
        balRef.current = balRef.current * (1 + ret / 100);
        logRef.current = [...logRef.current, { t: "16:00", action: `AUTO-CLOSE ${p.strike}${p.isCall ? "C" : "P"}`, result: fmt.pct(ret), pnl: ret }];
        setTradeLog([...logRef.current]);
        posRef.current = null; setPos(null);
      }
      setBal(balRef.current);
      setDone(true); setRunning(false);
      clearInterval(intervalRef.current);
      return;
    }

    setMkt(m); setBal(balRef.current);

    const c = { t: fmt.time(m.h, m.m), spot: m.spot, itsSpy: m.itsSpy, itsComp: m.itsComposite, accel: m.accelerator, fep: m.fep, ndf: m.ndf };
    candleRef.current = [...candleRef.current.slice(-200), c];
    setCandleHist([...candleRef.current]);
    setItsSpyHist(p => [...p.slice(-80), m.itsSpy]);
    setItsCompHist(p => [...p.slice(-80), m.itsComposite]);
    setAccelHist(p => [...p.slice(-80), m.accelerator]);

    if (tickRef.current % aiFreq === 0 && !thinkingRef.current) {
      thinkingRef.current = true;
      setThinking(true);
      callAI(m, posRef.current, balRef.current, logRef.current, candleRef.current)
        .then(dec => {
          const tStr = fmt.time(m.h, m.m);
          const mLeftNow = (SESSION_END_H * 60 + SESSION_END_M) - (m.h * 60 + m.m);
          addMindset({ t: tStr, mindset: dec.mindset || "—", reasoning: dec.reasoning || "—", decision: dec.decision, confidence: dec.confidence || 0 });

          if (dec.decision === "SELL" && posRef.current) {
            const p = posRef.current;
            const ret = (p.current / p.entry - 1) * 100;
            balRef.current = balRef.current * (1 + ret / 100);
            setBal(balRef.current);
            logRef.current = [...logRef.current, { t: tStr, action: `SELL ${p.strike}${p.isCall ? "C" : "P"} @$${p.current.toFixed(2)}`, result: fmt.pct(ret), pnl: ret }];
            setTradeLog([...logRef.current]);
            posRef.current = null; setPos(null);
          } else if ((dec.decision === "BUY_CALL" || dec.decision === "BUY_PUT") && !posRef.current && mLeftNow >= 90 && dec.strike) {
            const isCall = dec.decision === "BUY_CALL";
            const cp = priceOpt(m.spot, dec.strike, m.iv, mLeftNow, isCall);
            if (cp >= 0.13 && cp <= 0.28) {
              posRef.current = { strike: dec.strike, isCall, entry: cp, current: cp, entryTime: tStr, entrySpot: m.spot };
              setPos({ ...posRef.current });
              logRef.current = [...logRef.current, { t: tStr, action: `${isCall ? "BUY CALL" : "BUY PUT"} ${dec.strike}${isCall ? "C" : "P"} @$${cp.toFixed(2)}`, result: null }];
              setTradeLog([...logRef.current]);
            } else {
              addMindset({ t: tStr, mindset: `Contract $${cp.toFixed(2)} outside $0.15–$0.25 — skip`, reasoning: dec.reasoning || "", decision: "SKIP", confidence: 0 });
            }
          }
        })
        .catch(e => addMindset({ t: fmt.time(m.h, m.m), mindset: "API error — waiting", reasoning: e.message, decision: "WAIT", confidence: 0 }))
        .finally(() => { thinkingRef.current = false; setThinking(false); });
    }
  }, [aiFreq, addMindset]);

  useEffect(() => {
    if (!running || !engRef.current) return;
    const ms = Math.max(200, BASE_TICK_MS / speedMult);
    intervalRef.current = setInterval(() => doTick(engRef.current), ms);
    return () => clearInterval(intervalRef.current);
  }, [running, speedMult, doTick]);

  const startSession = useCallback(() => {
    engRef.current = createEngine();
    const drivers = engRef.current.getDrivers();
    const initial = engRef.current.peek();
    setDayType(drivers.dayType);
    setMkt(initial);
    setBal(STARTING_BALANCE); balRef.current = STARTING_BALANCE;
    setPos(null); posRef.current = null;
    setTradeLog([]); logRef.current = [];
    setMindsetLog([]); mindsetRef.current = [];
    setCandleHist([]); candleRef.current = [];
    setItsSpyHist([initial.itsSpy]);
    setItsCompHist([initial.itsComposite]);
    setAccelHist([initial.accelerator]);
    tickRef.current = 0; thinkingRef.current = false;
    setDone(false); setSavedToDrive(false); setSkipping(false);
    setRunning(true); setScreen("trading");
  }, []);

  const skipToEnd = useCallback(() => {
    if (!engRef.current) return;
    clearInterval(intervalRef.current);
    setSkipping(true); setRunning(false);
    const eng = engRef.current;
    let m = eng.peek();
    while (!(m.h >= SESSION_END_H)) {
      m = eng.tick(); tickRef.current += 1;
      const mLeft = (SESSION_END_H * 60 + SESSION_END_M) - (m.h * 60 + m.m);
      if (posRef.current) {
        const np = priceOpt(m.spot, posRef.current.strike, m.iv, mLeft, posRef.current.isCall);
        posRef.current = { ...posRef.current, current: np };
      }
    }
    if (posRef.current) {
      const p = posRef.current;
      const ret = (p.current / p.entry - 1) * 100;
      balRef.current = balRef.current * (1 + ret / 100);
      logRef.current = [...logRef.current, { t: "16:00", action: `AUTO-CLOSE ${p.strike}${p.isCall ? "C" : "P"}`, result: fmt.pct(ret), pnl: ret }];
      setTradeLog([...logRef.current]);
      posRef.current = null; setPos(null);
    }
    setMkt(m); setBal(balRef.current);
    setDone(true); setSkipping(false);
  }, []);

  const saveSession = useCallback(() => {
    const ret = ((balRef.current - STARTING_BALANCE) / STARTING_BALANCE) * 100;
    const closed = logRef.current.filter(l => l.pnl !== undefined);
    const wins = closed.filter(l => (l.pnl || 0) >= 0);
    const session = {
      id: Date.now(),
      name: fmt.sessionName(sessionCount, dayType, ret),
      date: new Date().toLocaleDateString(),
      balance: balRef.current, returnPct: ret,
      trades: logRef.current, mindset: mindsetRef.current,
      winRate: closed.length > 0 ? `${wins.length}/${closed.length}` : "—", dayType,
    };
    const updated = [session, ...sessions];
    setSessions(updated); saveSessions(updated);
    setSessionCount(n => n + 1);
    return session;
  }, [sessions, sessionCount, dayType]);

  const saveToDrive = useCallback(async () => {
    setSavingToDrive(true);
    const session = saveSession();
    const ret = ((session.balance - STARTING_BALANCE) / STARTING_BALANCE) * 100;
    const closed = session.trades.filter(l => l.pnl !== undefined);
    const wins = closed.filter(l => (l.pnl || 0) >= 0);
    const content = `FIRSTSIGNAL OS v3 — GCDT SIMULATION\n${session.name}\nDate: ${session.date} | Day: ${session.dayType}\nStart: $${STARTING_BALANCE} | Final: ${fmt.bal(session.balance)} | Return: ${fmt.pct(ret)} | W/L: ${session.winRate}\n\nTRADE LOG\n${session.trades.map(t => `${t.t} | ${t.action} | ${t.result || "open"}`).join("\n") || "No trades"}\n\nAI MINDSET (last 15)\n${session.mindset.slice(-15).map(m => `${m.t} [${m.decision} ${m.confidence}/10]\n👁 ${m.mindset}\n→ ${m.reasoning}`).join("\n\n")}\n\nSCORECARD\nClosed: ${closed.length} | Wins: ${wins.length} | Losses: ${closed.length - wins.length}`;
    try {
      await fetch(TRADER_API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: `Save this session data to Google Drive folder ${GDRIVE_FOLDER_ID}:\n${content}\n\nRespond: {"saved": true}` }) });
    } catch { }
    setSavedToDrive(true); setSavingToDrive(false);
  }, [saveSession]);

  const pnlPct = ((bal - STARTING_BALANCE) / STARTING_BALANCE) * 100;
  const div = mkt ? mkt.itsSpy - mkt.itsComposite : 0;
  const divColor = div > 0.5 ? T.red : div < -0.5 ? T.accent : T.yellow;
  const posPnl = pos ? (pos.current / pos.entry - 1) * 100 : 0;
  const mLeft = mkt ? (SESSION_END_H * 60 + SESSION_END_M) - (mkt.h * 60 + mkt.m) : 390;
  const thetaCrush = mLeft < 90;
  const currentTimeStr = mkt ? fmt.time(mkt.h, mkt.m) + " ET" : "";

  // ── HOME ──────────────────────────────────────────────────────────────────
  if (screen === "home") return (
    <div style={{ background: T.bg, minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, fontFamily: "monospace" }}>
      <div style={{ fontSize: 9, color: T.muted, letterSpacing: "0.2em", marginBottom: 8 }}>FIRSTSIGNAL OS v3</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: T.accent, marginBottom: 4 }}>GCDT</div>
      <div style={{ fontSize: 10, color: T.muted, marginBottom: 32, textAlign: "center" }}>GEX Composite Divergence Trading<br />AI-isolated · Haiku model · $1K start</div>
      <button onClick={startSession} style={{ width: "100%", maxWidth: 280, padding: "14px 0", background: T.accent, color: T.bg, border: "none", borderRadius: 6, fontFamily: "monospace", fontSize: 13, fontWeight: 700, cursor: "pointer", marginBottom: 12, letterSpacing: "0.1em" }}>
        BEGIN SESSION
      </button>
      <button onClick={() => setScreen("sessions")} style={{ width: "100%", maxWidth: 280, padding: "12px 0", background: "transparent", color: T.muted, border: `1px solid ${T.border}`, borderRadius: 6, fontFamily: "monospace", fontSize: 11, cursor: "pointer" }}>
        SESSION LIBRARY ({sessions.length})
      </button>
      {sessions.length > 0 && (
        <div style={{ marginTop: 24, width: "100%", maxWidth: 280, padding: "10px 12px", background: T.surface, borderRadius: 6, border: `1px solid ${T.border}` }}>
          <div style={{ fontSize: 9, color: T.muted, marginBottom: 4 }}>LAST SESSION</div>
          <div style={{ fontSize: 10, color: T.text }}>{sessions[0].name}</div>
          <div style={{ fontSize: 9, color: T.muted, marginTop: 2 }}>{sessions[0].date} · {sessions[0].winRate}</div>
        </div>
      )}
    </div>
  );

  // ── SESSIONS ──────────────────────────────────────────────────────────────
  if (screen === "sessions") return (
    <div style={{ background: T.bg, minHeight: "100vh", fontFamily: "monospace", color: T.text }}>
      <div style={{ background: T.surface, borderBottom: `1px solid ${T.border}`, padding: "12px 16px", display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={() => setScreen("home")} style={{ background: "none", border: "none", color: T.muted, cursor: "pointer", fontSize: 16 }}>←</button>
        <span style={{ fontSize: 12, fontWeight: 700, color: T.accent }}>SESSION LIBRARY</span>
      </div>
      <div style={{ padding: 16 }}>
        {sessions.length === 0 && <div style={{ color: T.muted, fontSize: 11, textAlign: "center", marginTop: 60 }}>No sessions yet.</div>}
        {sessions.map(s => (
          <div key={s.id} onClick={() => { setReviewSession(s); setScreen("review"); }}
            style={{ padding: "12px 14px", background: T.surface, borderRadius: 6, border: `1px solid ${T.border}`, marginBottom: 10, cursor: "pointer" }}>
            <div style={{ fontSize: 11, color: T.text, marginBottom: 3 }}>{s.name}</div>
            <div style={{ display: "flex", gap: 12 }}>
              <span style={{ fontSize: 9, color: T.muted }}>{s.date}</span>
              <span style={{ fontSize: 9, color: s.returnPct >= 0 ? T.accent : T.red }}>{fmt.pct(s.returnPct)}</span>
              <span style={{ fontSize: 9, color: T.muted }}>W/L {s.winRate}</span>
              <span style={{ fontSize: 9, color: T.muted }}>{s.dayType}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  // ── REVIEW ────────────────────────────────────────────────────────────────
  if (screen === "review" && reviewSession) {
    const s = reviewSession;
    return (
      <div style={{ background: T.bg, minHeight: "100vh", fontFamily: "monospace", color: T.text }}>
        <div style={{ background: T.surface, borderBottom: `1px solid ${T.border}`, padding: "12px 16px", display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={() => setScreen("sessions")} style={{ background: "none", border: "none", color: T.muted, cursor: "pointer", fontSize: 16 }}>←</button>
          <span style={{ fontSize: 11, color: T.accent, fontWeight: 700 }}>{s.name}</span>
        </div>
        <div style={{ padding: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
            {[["FINAL", fmt.bal(s.balance)], ["RETURN", fmt.pct(s.returnPct)], ["WIN RATE", s.winRate], ["DAY TYPE", s.dayType]].map(([label, val]) => (
              <div key={label} style={{ padding: "10px 12px", background: T.surface, borderRadius: 6, border: `1px solid ${T.border}` }}>
                <div style={{ fontSize: 9, color: T.muted, marginBottom: 3 }}>{label}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>{val}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 10, color: T.muted, marginBottom: 8 }}>TRADES</div>
          {s.trades.map((t, i) => (
            <div key={i} style={{ padding: "8px 12px", background: T.surface, borderRadius: 4, border: `1px solid ${(t.pnl || 0) >= 0 ? T.accent + "40" : T.red + "40"}`, marginBottom: 6 }}>
              <div style={{ fontSize: 10, color: T.text }}>{t.action}</div>
              <div style={{ fontSize: 9, color: (t.pnl || 0) >= 0 ? T.accent : T.red }}>{t.t} {t.result}</div>
            </div>
          ))}
          <div style={{ fontSize: 10, color: T.muted, marginTop: 16, marginBottom: 8 }}>AI MINDSET (last 8)</div>
          {s.mindset.slice(-8).reverse().map((m, i) => (
            <div key={i} style={{ padding: "8px 12px", background: T.surface2, borderRadius: 4, marginBottom: 6, borderLeft: `2px solid ${m.decision?.includes("BUY") ? T.yellow : m.decision === "SELL" ? T.accent : T.border}` }}>
              <div style={{ fontSize: 9, color: T.muted, marginBottom: 2 }}>{m.t} · {m.decision} [{m.confidence}/10]</div>
              <div style={{ fontSize: 10, color: T.text, marginBottom: 2 }}>👁 {m.mindset}</div>
              <div style={{ fontSize: 9, color: T.muted }}>{m.reasoning}</div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── TRADING ───────────────────────────────────────────────────────────────
  return (
    <div style={{ background: T.bg, minHeight: "100vh", fontFamily: "monospace", color: T.text, display: "flex", flexDirection: "column" }}>

      {/* HEADER */}
      <div style={{ background: T.surface, borderBottom: `1px solid ${T.border}`, padding: "8px 14px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: running ? T.accent : done ? T.muted : T.yellow, boxShadow: running ? `0 0 6px ${T.accent}` : "none" }} />
            <span style={{ fontSize: 10, fontWeight: 700, color: T.accent, letterSpacing: "0.08em" }}>GCDT · FS OS v3</span>
            {thinking && <span style={{ fontSize: 9, color: T.yellow }}>◈</span>}
            {skipping && <span style={{ fontSize: 9, color: T.yellow }}>⟳</span>}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {running && (
              <>
                <button onClick={skipToEnd} style={{ padding: "4px 8px", background: T.yellowDim, color: T.yellow, border: `1px solid ${T.yellow}40`, borderRadius: 3, fontFamily: "monospace", fontSize: 9, cursor: "pointer" }}>END</button>
                <button onClick={() => { setRunning(false); clearInterval(intervalRef.current); }} style={{ padding: "4px 8px", background: T.redDim, color: T.red, border: `1px solid ${T.red}40`, borderRadius: 3, fontFamily: "monospace", fontSize: 9, cursor: "pointer" }}>PAUSE</button>
              </>
            )}
            {!running && !done && mkt && (
              <button onClick={() => setRunning(true)} style={{ padding: "4px 10px", background: T.accentDim, color: T.accent, border: `1px solid ${T.accent}40`, borderRadius: 3, fontFamily: "monospace", fontSize: 9, cursor: "pointer" }}>RESUME</button>
            )}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: T.muted }}>{currentTimeStr}</span>
          {thetaCrush && <span style={{ fontSize: 9, color: T.red }}>THETA CRUSH</span>}
          <span style={{ fontSize: 14, fontWeight: 700, color: bal >= STARTING_BALANCE ? T.accent : T.red }}>{fmt.bal(bal)}</span>
          <span style={{ fontSize: 10, color: pnlPct >= 0 ? T.accent : T.red }}>{fmt.pct(pnlPct)}</span>
        </div>
      </div>

      {/* OPEN POSITION */}
      {pos && (
        <div style={{ margin: "8px 14px 0", padding: "8px 12px", background: posPnl >= 0 ? T.accentDim : T.redDim, border: `1px solid ${posPnl >= 0 ? T.accent : T.red}40`, borderRadius: 6, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 9, color: T.muted }}>OPEN · {pos.entryTime}</div>
            <div style={{ fontSize: 13, fontWeight: 700 }}>{pos.strike}{pos.isCall ? "C" : "P"} · entry ${pos.entry.toFixed(2)}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: posPnl >= 0 ? T.accent : T.red }}>${pos.current.toFixed(2)}</div>
            <div style={{ fontSize: 10, color: posPnl >= 0 ? T.accent : T.red }}>{fmt.pct(posPnl)}</div>
          </div>
        </div>
      )}

      {/* SCROLLABLE */}
      <div style={{ flex: 1, overflowY: "auto", paddingBottom: 20 }}>

        {/* PRICE CHART */}
        {mkt && (
          <div style={{ background: T.surface, borderRadius: 8, border: `1px solid ${T.border}`, margin: "10px 14px", overflow: "hidden" }}>
            <PriceChart
              candles={candleHist}
              currentTime={currentTimeStr}
              gammaFlip={mkt.gammaFlip}
              callWall={mkt.callWall}
              putWall={mkt.putWall}
              position={pos}
            />
            {/* Current spot + key levels row */}
            <div style={{ padding: "8px 12px", borderTop: `1px solid ${T.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 20, fontWeight: 700, color: T.text }}>${mkt.spot.toFixed(2)}</div>
                <div style={{ fontSize: 9, color: mkt.spot > mkt.gammaFlip ? T.accent : T.red }}>
                  {mkt.spot > mkt.gammaFlip ? "▲ ABOVE FLIP" : "▼ BELOW FLIP"}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: mkt.netGex < 0 ? T.red : T.accent }}>{fmt.gex(mkt.netGex)}</div>
                <div style={{ fontSize: 8, color: mkt.netGex < 0 ? T.red : T.accent }}>{mkt.netGex < 0 ? "AMPLIFY" : "PINNING"}</div>
              </div>
            </div>
          </div>
        )}

        {/* COMPOSITE DIVERGENCE */}
        {mkt && (
          <div style={{ background: T.surface, borderRadius: 8, border: `1px solid ${T.border}`, margin: "0 14px 10px", padding: 12 }}>
            <div style={{ fontSize: 9, color: T.muted, letterSpacing: "0.1em", marginBottom: 8 }}>COMPOSITE DIVERGENCE</div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div>
                <div style={{ fontSize: 22, fontWeight: 700, color: divColor }}>{div >= 0 ? "+" : ""}{div.toFixed(2)}</div>
                <div style={{ fontSize: 8, color: T.muted }}>
                  {Math.abs(div) < 0.3 ? "CONVERGED" : div > 0.5 ? "SPY LEADING — false signal" : "COMP LEADING — conviction"}
                </div>
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <div>
                  <div style={{ fontSize: 8, color: T.muted, marginBottom: 2 }}>SPY</div>
                  <Spark data={itsSpyHist} color={T.text} h={28} w={55} />
                  <div style={{ fontSize: 10, color: T.text, textAlign: "right" }}>{mkt.itsSpy.toFixed(2)}</div>
                </div>
                <div>
                  <div style={{ fontSize: 8, color: T.accent, marginBottom: 2 }}>COMP</div>
                  <Spark data={itsCompHist} color={T.accent} h={28} w={55} />
                  <div style={{ fontSize: 10, color: T.accent, textAlign: "right" }}>{mkt.itsComposite.toFixed(2)}</div>
                </div>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              <div>
                <div style={{ fontSize: 8, color: T.muted }}>ACCEL</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: T.yellow }}>{mkt.accelerator.toFixed(2)}</div>
                <Spark data={accelHist} color={T.yellow} h={18} w={70} />
              </div>
              <div>
                <div style={{ fontSize: 8, color: T.muted }}>NDF</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: mkt.ndf > 0.1 ? T.accent : mkt.ndf < -0.1 ? T.red : T.muted }}>{mkt.ndf >= 0 ? "+" : ""}{mkt.ndf.toFixed(3)}</div>
                <div style={{ fontSize: 8, color: T.muted, marginTop: 4 }}>DEALER</div>
                <div style={{ fontSize: 11, color: T.muted }}>{mkt.dealerPct.toFixed(0)}%</div>
              </div>
              <div>
                <div style={{ fontSize: 8, color: T.muted }}>FEP GAP</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: Math.abs(mkt.spot - mkt.fep) > 1.5 ? T.yellow : T.muted }}>
                  {(mkt.spot - mkt.fep) >= 0 ? "+" : ""}{(mkt.spot - mkt.fep).toFixed(2)}
                </div>
                <div style={{ fontSize: 8, color: T.muted, marginTop: 4 }}>IV</div>
                <div style={{ fontSize: 11, color: T.muted }}>{mkt.iv.toFixed(1)}%</div>
              </div>
            </div>
          </div>
        )}

        {/* AI MINDSET LOG */}
        <div style={{ background: T.surface, borderRadius: 8, border: `1px solid ${T.border}`, margin: "0 14px 10px", padding: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <div style={{ fontSize: 9, color: T.muted, letterSpacing: "0.1em" }}>AI MINDSET LOG</div>
            {thinking && <div style={{ fontSize: 9, color: T.yellow }}>◈ deciding...</div>}
          </div>
          {mindsetLog.length === 0 && <div style={{ fontSize: 10, color: T.dim, textAlign: "center", padding: "12px 0" }}>Waiting for first decision...</div>}
          {[...mindsetLog].reverse().slice(0, 6).map((entry, i) => (
            <div key={i} style={{
              marginBottom: 8, padding: "8px 10px", borderRadius: 4, background: T.surface2,
              borderLeft: `2px solid ${entry.decision?.includes("BUY") ? T.yellow : entry.decision === "SELL" ? T.accent : T.border}`,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                <span style={{ fontSize: 8, color: T.muted }}>{entry.t}</span>
                <span style={{ fontSize: 8, color: T.muted }}>{entry.decision} [{entry.confidence}/10]</span>
              </div>
              <div style={{ fontSize: 10, color: T.yellow, marginBottom: 2 }}>👁 {entry.mindset}</div>
              <div style={{ fontSize: 9, color: T.muted }}>{entry.reasoning}</div>
            </div>
          ))}
        </div>

        {/* TRADE LOG */}
        {tradeLog.length > 0 && (
          <div style={{ background: T.surface, borderRadius: 8, border: `1px solid ${T.border}`, margin: "0 14px 10px", padding: 12 }}>
            <div style={{ fontSize: 9, color: T.muted, letterSpacing: "0.1em", marginBottom: 8 }}>TRADE LOG</div>
            {tradeLog.map((t, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, paddingBottom: 6, borderBottom: i < tradeLog.length - 1 ? `1px solid ${T.dim}` : "none" }}>
                <div>
                  <div style={{ fontSize: 10, color: T.text }}>{t.action}</div>
                  <div style={{ fontSize: 8, color: T.muted }}>{t.t}</div>
                </div>
                {t.result && <div style={{ fontSize: 11, fontWeight: 700, color: (t.pnl || 0) >= 0 ? T.accent : T.red }}>{t.result}</div>}
              </div>
            ))}
          </div>
        )}

        {/* CONTROLS */}
        <div style={{ background: T.surface, borderRadius: 8, border: `1px solid ${T.border}`, margin: "0 14px 10px", padding: 12 }}>
          <div style={{ fontSize: 9, color: T.muted, marginBottom: 6 }}>SPEED · {speedMult}x</div>
          <input type="range" min="0.5" max="10" step="0.5" value={speedMult} onChange={e => setSpeedMult(Number(e.target.value))} style={{ width: "100%", accentColor: T.accent, marginBottom: 10 }} />
          <div style={{ fontSize: 9, color: T.muted, marginBottom: 6 }}>AI EVERY</div>
          <div style={{ display: "flex", gap: 6 }}>
            {[5, 8, 12, 20].map(n => (
              <button key={n} onClick={() => setAiFreq(n)} style={{ flex: 1, padding: "5px 0", background: aiFreq === n ? T.accent : "transparent", color: aiFreq === n ? T.bg : T.muted, border: `1px solid ${aiFreq === n ? T.accent : T.border}`, borderRadius: 3, fontFamily: "monospace", fontSize: 9, cursor: "pointer" }}>
                {n}t
              </button>
            ))}
          </div>
        </div>

        {/* SESSION DONE */}
        {done && (
          <div style={{ background: pnlPct >= 0 ? T.accentDim : T.redDim, borderRadius: 8, border: `1px solid ${pnlPct >= 0 ? T.accent : T.red}40`, margin: "0 14px 10px", padding: 16, textAlign: "center" }}>
            <div style={{ fontSize: 10, color: T.muted, marginBottom: 4 }}>SESSION COMPLETE · {dayType.toUpperCase()}</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: pnlPct >= 0 ? T.accent : T.red }}>{fmt.bal(bal)}</div>
            <div style={{ fontSize: 14, color: pnlPct >= 0 ? T.accent : T.red, marginBottom: 16 }}>{fmt.pct(pnlPct)}</div>
            <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
              <button onClick={saveToDrive} disabled={savingToDrive || savedToDrive} style={{ padding: "8px 14px", background: savedToDrive ? T.accentDim : T.accent, color: savedToDrive ? T.accent : T.bg, border: savedToDrive ? `1px solid ${T.accent}` : "none", borderRadius: 4, fontFamily: "monospace", fontSize: 10, cursor: "pointer", fontWeight: 700 }}>
                {savingToDrive ? "SAVING..." : savedToDrive ? "✓ SAVED" : "SAVE TO DRIVE"}
              </button>
              <button onClick={() => { saveSession(); setScreen("home"); }} style={{ padding: "8px 14px", background: "transparent", color: T.muted, border: `1px solid ${T.border}`, borderRadius: 4, fontFamily: "monospace", fontSize: 10, cursor: "pointer" }}>
                HOME
              </button>
              <button onClick={startSession} style={{ padding: "8px 14px", background: T.surface2, color: T.text, border: `1px solid ${T.border}`, borderRadius: 4, fontFamily: "monospace", fontSize: 10, cursor: "pointer" }}>
                NEW SESSION
              </button>
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}
        ::-webkit-scrollbar{width:3px}
        ::-webkit-scrollbar-thumb{background:${T.border};border-radius:2px}
        input[type=range]{height:3px}
      `}</style>
    </div>
  );
}
