import json, math, random, threading
from pathlib import Path

REPLAY_ROOT = Path(__file__).resolve().parents[1] / "public" / "replays"
SOURCE_DAYS = ["2026-06-29","2026-06-30","2026-07-01","2026-07-02","2026-07-06","2026-07-07","2026-07-08","2026-07-09","2026-07-10","2026-07-13","2026-07-14","2026-07-15","2026-07-16","2026-07-17"]
NATIVE_20S = {"2026-07-15","2026-07-16","2026-07-17"}
_POOL = None
_LOCK = threading.Lock()

def _finite(v, default=0.0):
    try:
        x=float(v)
        return x if math.isfinite(x) else default
    except (TypeError, ValueError): return default

def _load_pool():
    global _POOL
    if _POOL is not None: return _POOL
    with _LOCK:
        if _POOL is not None: return _POOL
        pool=[]
        for day in SOURCE_DAYS:
            path=REPLAY_ROOT/f"{day}.json"
            if not path.exists(): continue
            replay=json.loads(path.read_text(encoding="utf-8"))
            snaps=replay.get("snapshots") or []
            if len(snaps)<1000: continue
            pool.append({"day":day,"native20":day in NATIVE_20S,"snapshots":snaps})
        if len(pool)<3: raise RuntimeError("SEED_POOL_NOT_READY: fewer than 3 usable replay days")
        _POOL=pool
    return _POOL

def _features(snaps, i):
    s=snaps[i]; p3=snaps[max(0,i-3)]; p15=snaps[max(0,i-15)]
    spot=_finite(s.get("spySpot")); g=_finite(s.get("netGex")); gs=_finite(s.get("netGexSpx"))
    return (spot-_finite(p3.get("spySpot")), spot-_finite(p15.get("spySpot")),
            math.copysign(math.log1p(abs(g)),g), math.copysign(math.log1p(abs(gs)),gs),
            _finite(s.get("callDom"),.5), _finite(s.get("callDomSpx"),.5),
            spot-_finite(s.get("gammaFlip"),spot),
            _finite(s.get("callWall"),spot)-spot, spot-_finite(s.get("putWall"),spot),
            _finite(s.get("iv"),.2))

def _distance(a,b):
    scales=(.35,1.0,5.0,5.0,.12,.12,.8,1.5,1.5,.08)
    return sum(((x-y)/s)**2 for x,y,s in zip(a,b,scales))

def _shift_snapshot(src, spy_offset, spx_offset, gex_scale, dom_offset, out_time, seed_id):
    o=dict(src); o["time"]=out_time
    for k in ("spySpot","gammaFlip","callWall","putWall"):
        if src.get(k) is not None: o[k]=_finite(src[k])+spy_offset
    if src.get("spxSpot") is not None: o["spxSpot"]=_finite(src["spxSpot"])+spx_offset
    if src.get("netGex") is not None: o["netGex"]=_finite(src["netGex"])*gex_scale
    if src.get("netGexSpx") is not None: o["netGexSpx"]=_finite(src["netGexSpx"])*gex_scale
    o["callDom"]=min(.99,max(.01,_finite(src.get("callDom"),.5)+dom_offset))
    o["callDomSpx"]=min(.99,max(.01,_finite(src.get("callDomSpx"),.5)+dom_offset*.7))
    chain=[]
    for q in src.get("chain") or []:
        z=dict(q); z["strike"]=round((_finite(q.get("strike"))+spy_offset)*2)/2
        z["contract"]=f"SEED{seed_id}{'C' if str(q.get('side')).upper()=='CALL' else 'P'}{int(z['strike']*1000):08d}"
        z["quoteSource"]="REAL_TEMPLATE_TRANSFORMED"
        chain.append(z)
    o["chain"]=chain; o["quoteSource"]="REAL_TEMPLATE_TRANSFORMED"
    o["marketSource"]="UNIFIED_MULTI_DAY_TRANSITION_POOL"
    o["calibrationSourceDay"]="BLINDED_MULTI_DAY_POOL"
    return o

def generate_seed(seed=None):
    pool=_load_pool(); rng=random.Random(seed); seed_id=f"{rng.randrange(16**6):06x}"
    total=1216; output=[]; provenance=[]; recent_days=[]; day_counts={x["day"]:0 for x in pool}
    first=rng.choice(pool); idx=0
    current=first["snapshots"][0]
    spy_anchor=_finite(current.get("spySpot")); spx_anchor=_finite(current.get("spxSpot"),spy_anchor*10)
    while len(output)<total:
        out_i=len(output); target_feat=_features(first["snapshots"],idx) if not output else _features([output[max(0,j)] for j in range(len(output))],len(output)-1)
        candidates=[]
        lo=max(0,out_i-45); hi=min(total-1,out_i+45)
        for src in pool:
            stride=1 if src["native20"] else 3
            for j in range(lo,hi+1,stride):
                if j>=len(src["snapshots"])-35: continue
                score=_distance(target_feat,_features(src["snapshots"],j))
                score+=day_counts[src["day"]]*2.25
                if day_counts[src["day"]]==0: score-=2.0
                if src["day"] in recent_days[-2:]: score+=3.5
                if src["native20"]: score*=.88
                candidates.append((score+rng.random()*.35,src,j))
        candidates.sort(key=lambda x:x[0]); _,chosen,j=rng.choice(candidates[:min(24,len(candidates))])
        block=rng.randint(9,30); base=chosen["snapshots"][j]
        last=output[-1] if output else current
        spy_off=_finite(last.get("spySpot"))- _finite(base.get("spySpot"))
        spx_off=_finite(last.get("spxSpot"))- _finite(base.get("spxSpot"))
        bg=abs(_finite(base.get("netGex"))); lg=abs(_finite(last.get("netGex")))
        gscale=min(2.0,max(.5,lg/bg if bg>1 else 1.0))
        doff=_finite(last.get("callDom"),.5)-_finite(base.get("callDom"),.5)
        start=len(output)
        for k in range(block):
            if len(output)>=total or j+k>=len(chosen["snapshots"]): break
            n=len(output); seconds=9*3600+30*60+n*20; h=seconds//3600; m=(seconds%3600)//60; s=seconds%60
            decay=math.exp(-k/10)
            snap=_shift_snapshot(chosen["snapshots"][j+k],spy_off,spx_off,1+(gscale-1)*decay,doff*decay,f"{h:02d}:{m:02d}:{s:02d}",seed_id)
            if output:
                jump=_finite(snap.get("spySpot"))-_finite(output[-1].get("spySpot"))
                if abs(jump)>3.5:
                    correction=jump-math.copysign(3.5,jump)
                    for key in ("spySpot","gammaFlip","callWall","putWall"):
                        if snap.get(key) is not None: snap[key]-=correction
                    for q in snap.get("chain") or []: q["strike"]=round((q["strike"]-correction)*2)/2
            output.append(snap)
        provenance.append({"outputStart":start,"outputEnd":len(output)-1,"sourceDay":chosen["day"],"sourceStart":j,"native20":chosen["native20"]})
        recent_days.append(chosen["day"]); day_counts[chosen["day"]]+=1; first=chosen; idx=min(j+block,len(chosen["snapshots"])-1)
    days=sorted(set(x["sourceDay"] for x in provenance)); chain_ticks=sum(bool(x.get("chain")) for x in output)
    max_jump=max(abs(_finite(output[i]["spySpot"])-_finite(output[i-1]["spySpot"])) for i in range(1,len(output)))
    quality={"level":"GREEN" if len(days)>=6 and chain_ticks/total>=.95 and max_jump<=3.5 else "RED",
             "snapshotCount":len(output),"sourceDaysUsed":days,"sourceDayCount":len(days),
             "native20SourceBlocks":sum(x["native20"] for x in provenance),"blockCount":len(provenance),
             "realTemplateOptionTicks":chain_ticks,"optionCoveragePct":round(chain_ticks/total*100,2),
             "max20sJump":round(max_jump,4),"lookAheadExposed":False,"archetypeSelected":False}
    if quality["level"]!="GREEN": raise RuntimeError(f"SEED_VALIDATION_FAILED:{quality}")
    return {"date":f"SEED-{seed_id}","label":"Unified multi-day 20s seed | all-data transition pool",
            "dayType":"EMERGENT / NOT PRESELECTED","playbackIntervalSeconds":20,"sourceIntervalSeconds":20,
            "nativeSourceCadence":True,"seedId":seed_id,"quality":quality,"provenanceHidden":True,"snapshots":output}

def readiness():
    pool=_load_pool(); return {"ready":len(pool)>=3,"sourceDays":[x["day"] for x in pool],
        "native20Days":[x["day"] for x in pool if x["native20"]],"mode":"UNIFIED_MULTI_DAY_TRANSITION_POOL",
        "archetypes":False,"failClosed":True,"targetSnapshots":1216}
