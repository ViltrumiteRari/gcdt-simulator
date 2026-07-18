const fs = require('fs');
const path = require('path');

const PIPELINE_VERSION = 2;
const DIRS = {
  sessions: '01-sessions',
  campaigns: '02-campaigns',
  findings: '03-findings',
  reviews: '04-reviews',
  memory: '05-memory',
  state: '06-state',
  indexes: '07-indexes',
  schemas: '08-schemas',
  archive: '90-archive',
};

function layout(root) {
  const out = { root };
  for (const [key, value] of Object.entries(DIRS)) out[key] = path.join(root, value);
  return out;
}

function ensurePipeline(root) {
  const p = layout(root);
  fs.mkdirSync(root, { recursive: true });
  for (const key of Object.keys(DIRS)) fs.mkdirSync(p[key], { recursive: true });
  return p;
}
function localIso(date = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const hh = pad(Math.floor(Math.abs(offset) / 60));
  const mm = pad(Math.abs(offset) % 60);
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${String(date.getMilliseconds()).padStart(3,'0')}${sign}${hh}:${mm}`;
}

function normalizeMarketTime(value) {
  if (!value) return null;
  const raw=String(value).trim();
  let m=raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)?$/i);
  if(!m)return raw;
  let h=Number(m[1]), min=Number(m[2]), sec=Number(m[3]||0), ap=(m[4]||'').toUpperCase();
  if(ap==='PM'&&h<12)h+=12;
  if(ap==='AM'&&h===12)h=0;
  return `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
}

function temporalMeta({ at = new Date(), replayDate = null, marketTime = null } = {}) {
  const d = at instanceof Date ? at : new Date(at);
  const observedAtUtc = d.toISOString();
  const observedAtLocal = localIso(d);
  const localDate = observedAtLocal.slice(0, 10);
  const marketDate = replayDate || localDate;
  const marketTime24 = normalizeMarketTime(marketTime);
  return {
    observedAtUtc,
    observedAtLocal,
    localDate,
    replayDate: replayDate || null,
    marketDate,
    marketTime: marketTime || null,
    marketTime24,
    chronologicalKey: `${marketDate}T${marketTime24 || '00:00:00'}|${observedAtUtc}`,
  };
}

function upsertIndex(file, arrayKey, keyField, record) {
  let current={generatedAtUtc:null,[arrayKey]:[]};
  try{current=JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}catch{}
  const list=Array.isArray(current[arrayKey])?current[arrayKey]:[];
  current.generatedAtUtc=new Date().toISOString();
  current[arrayKey]=[...list.filter(x=>x?.[keyField]!==record?.[keyField]),record].sort((a,b)=>String(b.completedAt||b.endedAt||b.startedAt||'').localeCompare(String(a.completedAt||a.endedAt||a.startedAt||'')));
  fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(file,JSON.stringify(current,null,2));
  return current;
}

module.exports = { PIPELINE_VERSION, DIRS, layout, ensurePipeline, temporalMeta, localIso, normalizeMarketTime, upsertIndex };
