import csv, json, uuid
from datetime import datetime, timedelta, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

DATASET_ROOT = Path(r"D:\FirstSignal_GCDT_Dataset")
HOST, PORT = "127.0.0.1", 8765
TRADE_CUTOFF, DATA_END = "15:45:00", "16:15:00"
SIMS = {}

def dt(v):
    if not v: return None
    try: return datetime.fromisoformat(v.strip().replace("Z", "+00:00"))
    except ValueError: return None

def rows(path):
    if not path.exists(): return []
    with path.open(encoding="utf-8-sig", newline="") as f:
        out=list(csv.DictReader(f))
    for r in out:
        r["_dt"] = dt(r.get("captured_at") or r.get("timestamp") or r.get("time"))
    return sorted((r for r in out if r["_dt"]), key=lambda r:r["_dt"])

def load_day(day):
    base=DATASET_ROOT/day/"sim_input"
    manifest=base/"sim_manifest.json"
    if not manifest.exists(): raise FileNotFoundError(f"No sim package for {day}")
    return {"date":day,"manifest":json.loads(manifest.read_text()),
            "market":rows(base/"market_timeline.csv"),
            "gex":rows(base/"gex_key_levels.csv"),
            "options":rows(base/"options_focus.csv")}

def public(r):
    return None if r is None else {k:v for k,v in r.items() if k!="_dt"}

def latest(data, now):
    hit=None
    for r in data:
        if r["_dt"]<=now: hit=r
        else: break
    return public(hit)

def batch(data, now):
    eligible=[r for r in data if r["_dt"]<=now]
    if not eligible: return []
    stamp=eligible[-1]["_dt"]
    return [public(r) for r in eligible if r["_dt"]==stamp]

class Sim:
    def __init__(self, day, balance=1000, allow_after=False):
        self.id=uuid.uuid4().hex
        self.day=load_day(day)
        all_rows=self.day["market"]+self.day["gex"]+self.day["options"]
        if not all_rows: raise ValueError("No timestamped rows")
        self.now=min(r["_dt"] for r in all_rows)
        self.end=self.now.replace(hour=16,minute=15,second=0,microsecond=0)
        self.cash=float(balance); self.position=None; self.orders=[]
        self.allow_after=bool(allow_after); self.liquidated=False
    def trade_allowed(self):
        return self.allow_after or self.now.time()<time.fromisoformat(TRADE_CUTOFF)
    def observation(self):
        return {"simulation_id":self.id,"session_date":self.day["date"],
          "simulation_time":self.now.isoformat(),"data_end":self.end.isoformat(),
          "trade_cutoff":TRADE_CUTOFF,"trade_allowed":self.trade_allowed(),
          "market":latest(self.day["market"],self.now),"gex":batch(self.day["gex"],self.now),
          "options":batch(self.day["options"],self.now),"account":self.account(),
          "finished":self.now>=self.end,"air_gap":{"future_rows_exposed":False}}
    def account(self):
        return {"cash":round(self.cash,2),"position":self.position,"orders":self.orders,
                "trade_allowed":self.trade_allowed(),"trade_cutoff":TRADE_CUTOFF}
    def advance(self, seconds):
        self.now=min(self.now+timedelta(seconds=max(1,int(seconds))),self.end)
        auto=None
        if self.position and not self.trade_allowed() and not self.liquidated:
            quote=next((r for r in batch(self.day["options"],self.now)
                        if r.get("contract")==self.position["contract"]),None)
            px=float((quote or {}).get("bid") or (quote or {}).get("mid") or
                     (quote or {}).get("last") or 0)
            qty=self.position["quantity"]; self.cash+=px*100*qty
            auto={"side":"SELL","contract":self.position["contract"],"quantity":qty,
                  "price":px,"time":self.now.isoformat(),"reason":"DEFAULT_0DTE_CUTOFF_15_45"}
            self.orders.append(auto); self.position=None; self.liquidated=True
        result=self.observation()
        if auto: result["automatic_liquidation"]=auto
        return result
    def order(self, order):
        side=str(order.get("side","")).upper()
        if side=="BUY" and not self.trade_allowed():
            raise PermissionError("New 0DTE entries are blocked at/after 15:45 ET")
        contract=str(order.get("contract","")); qty=int(order.get("quantity",1))
        quote=next((r for r in batch(self.day["options"],self.now)
                    if r.get("contract")==contract),None)
        if not quote: raise ValueError("Contract is not in the current observable snapshot")
        px=float(quote.get("ask") or quote.get("mid") or quote.get("last") or 0) if side=="BUY" else float(quote.get("bid") or quote.get("mid") or quote.get("last") or 0)
        rec={"side":side,"contract":contract,"quantity":qty,"price":px,"time":self.now.isoformat()}
        if side=="BUY":
            cost=px*100*qty
            if self.position: raise ValueError("A position is already open")
            if cost>self.cash: raise ValueError("Insufficient cash")
            self.cash-=cost; self.position={**rec,"entry_price":px}
        elif side=="SELL":
            if not self.position or self.position["contract"]!=contract: raise ValueError("No matching position")
            self.cash+=px*100*qty; self.position=None
        else: raise ValueError("side must be BUY or SELL")
        self.orders.append(rec); return self.account()

class Handler(BaseHTTPRequestHandler):
    def send_json(self,status,payload):
        body=json.dumps(payload,default=str).encode()
        self.send_response(status); self.send_header("Content-Type","application/json")
        self.send_header("Content-Length",str(len(body)))
        self.send_header("Access-Control-Allow-Origin","*")
        self.send_header("Access-Control-Allow-Headers","Content-Type")
        self.send_header("Access-Control-Allow-Methods","GET,POST,OPTIONS")
        self.end_headers(); self.wfile.write(body)
    def body(self):
        return json.loads(self.rfile.read(int(self.headers.get("Content-Length",0))) or b"{}")
    def do_OPTIONS(self): self.send_json(204,{})
    def do_GET(self):
        p=[x for x in urlparse(self.path).path.split("/") if x]
        try:
            if p==["api","health"]:
                return self.send_json(200,{"ok":True,"service":"gcdt-v26-airgap",
                  "dataset_root":str(DATASET_ROOT),"trade_cutoff":TRADE_CUTOFF,"data_end":DATA_END})
            if p==["api","sessions"]:
                days=[]
                for d in sorted(DATASET_ROOT.iterdir(),reverse=True):
                    if (d/"sim_input"/"sim_manifest.json").exists():
                        x=load_day(d.name); allr=x["market"]+x["gex"]+x["options"]
                        days.append({"date":d.name,"rows":{"market":len(x["market"]),"gex":len(x["gex"]),"options":len(x["options"])},
                          "first":min((r["_dt"] for r in allr),default=None),"last":max((r["_dt"] for r in allr),default=None)})
                return self.send_json(200,{"sessions":days})
            if len(p)==4 and p[:2]==["api","simulations"]:
                sim=SIMS[p[2]]
                return self.send_json(200,sim.observation() if p[3]=="observation" else sim.account())
            self.send_json(404,{"error":"not found"})
        except Exception as e: self.send_json(400,{"error":str(e)})
    def do_POST(self):
        p=[x for x in urlparse(self.path).path.split("/") if x]
        try:
            data=self.body()
            if p==["api","simulations"]:
                sim=Sim(data.get("session_date","2026-07-08"),data.get("starting_balance",1000),data.get("allow_after_cutoff",False))
                SIMS[sim.id]=sim; return self.send_json(201,sim.observation())
            if len(p)==4 and p[:2]==["api","simulations"]:
                sim=SIMS[p[2]]
                if p[3]=="advance": return self.send_json(200,sim.advance(data.get("seconds",60)))
                if p[3]=="orders": return self.send_json(200,sim.order(data))
            self.send_json(404,{"error":"not found"})
        except PermissionError as e: self.send_json(409,{"error":str(e),"code":"TRADE_CUTOFF"})
        except Exception as e: self.send_json(400,{"error":str(e)})
    def log_message(self,fmt,*args): print("[GCDT API]",fmt%args)

if __name__=="__main__":
    print(f"GCDT v26 air-gap API http://{HOST}:{PORT}")
    print(f"3:45 ET trade cutoff; data continues through 4:15 ET; dataset {DATASET_ROOT}")
    ThreadingHTTPServer((HOST,PORT),Handler).serve_forever()
