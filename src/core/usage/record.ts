import type { UsageBucket, UsageStore, UsageTick } from "../types/domain";
const empty = (): UsageBucket => ({
  totalSeconds: 0,
  studySeconds: 0,
  liveSeconds: 0,
});
function dateKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
// Merge overlapping tab intervals, independently for each counter. Split before adding
// so a heartbeat crossing an hour/day/month doesn't land entirely in the later bucket.
export function applyUsageTick(store: UsageStore, tick: UsageTick) {
  if (!Number.isFinite(tick.seconds) || !Number.isFinite(tick.recordedAt))
    return;
  const end = Math.min(Date.now(), tick.recordedAt);
  const seconds = Math.min(300, Math.max(0, tick.seconds));
  const keys: (keyof UsageBucket)[] = ["totalSeconds"];
  if (tick.study) keys.push("studySeconds");
  if (tick.live) keys.push("liveSeconds");
  const cursors = (store.lastCounted ??= {});
  for (const key of keys) {
    const last = cursors[key] ?? 0;
    // Reset a cursor from the future after the system clock is corrected.
    let start = Math.max(end - seconds * 1000, last > Date.now() ? 0 : last);
    if (start >= end) continue;
    while (start < end) {
      const d = new Date(start);
      const next = new Date(start);
      next.setHours(d.getHours() + 1, 0, 0, 0);
      const until = Math.min(end, next.getTime());
      const date = dateKey(d),
        month = date.slice(0, 7);
      const day = (store.days[date] ??= {
        date,
        hours: Array.from({ length: 24 }, empty),
      });
      const monthly = (store.months[month] ??= { month, ...empty() });
      const amount = (until - start) / 1000;
      day.hours[d.getHours()][key] += amount;
      monthly[key] += amount;
      start = until;
    }
    cursors[key] = end;
  }
}
