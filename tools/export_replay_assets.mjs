import fs from 'node:fs';
import path from 'node:path';
import { REAL_REPLAY_CATALOG } from '../src/realReplayData.js';
import { JULY10_REPLAY } from '../src/realReplayDataJul10.js';

const outDir = path.resolve('public/replays');
fs.mkdirSync(outDir, { recursive: true });
const catalog = { ...REAL_REPLAY_CATALOG, '2026-07-10': JULY10_REPLAY };
const manifest = {};
for (const [date, replay] of Object.entries(catalog)) {
  const file = `${date}.json`;
  fs.writeFileSync(path.join(outDir, file), JSON.stringify(replay));
  manifest[date] = {
    date,
    file,
    label: replay.label || date,
    dayType: replay.dayType || 'Historical replay',
    snapshotCount: replay.snapshots?.length || 0,
    firstTime: replay.snapshots?.[0]?.time || replay.snapshots?.[0]?.t || null,
    lastTime: replay.snapshots?.at(-1)?.time || replay.snapshots?.at(-1)?.t || null,
  };
}
fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(manifest);
