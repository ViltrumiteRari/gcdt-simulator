export const REAL_REPLAY_META = {
  "2026-07-06": { date: "2026-07-06", file: "2026-07-06.json", label: "2026-07-06 | Unified native SPY/SPX | 1-minute replay", dayType: "REAL DATA REPLAY", snapshotCount: 406 },
  "2026-07-07": { date: "2026-07-07", file: "2026-07-07.json", label: "2026-07-07 | Unified native SPY/SPX | 1-minute replay", dayType: "REAL DATA REPLAY", snapshotCount: 406 },
  "2026-07-08": { date: "2026-07-08", file: "2026-07-08.json", label: "2026-07-08 | Unified native SPY/SPX | 1-minute replay", dayType: "REAL DATA REPLAY", snapshotCount: 406 },
  "2026-07-09": { date: "2026-07-09", file: "2026-07-09.json", label: "2026-07-09 | Unified native SPY/SPX | 1-minute replay", dayType: "REAL DATA REPLAY", snapshotCount: 406 },
  "2026-07-10": { date: "2026-07-10", file: "2026-07-10.json", label: "2026-07-10 | Unified native SPY/SPX | 1-minute replay", dayType: "REAL DATA REPLAY", snapshotCount: 406 },
};

const cache = new Map();

export async function loadRealReplay(date) {
  if (!REAL_REPLAY_META[date]) return null;
  if (cache.has(date)) return cache.get(date);
  const promise = fetch(`/replays/${REAL_REPLAY_META[date].file}`, { cache: "no-store" })
    .then(async response => {
      if (!response.ok) throw new Error(`REPLAY_LOAD_${response.status}:${date}`);
      const replay = await response.json();
      if (!Array.isArray(replay?.snapshots) || replay.snapshots.length === 0) throw new Error(`REPLAY_INVALID:${date}`);
      return replay;
    })
    .catch(error => { cache.delete(date); throw error; });
  cache.set(date, promise);
  return promise;
}
