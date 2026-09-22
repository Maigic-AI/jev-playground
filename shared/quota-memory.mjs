import { quotaDay, quotaResetAt } from "./quota-day.mjs";

// 进程内配额计数器（本地 Express 服务用），接口与 Worker 的 Durable Object 适配器一致，
// 使 shared/default-key.mjs 的策略逻辑对两种运行时完全透明。now 可注入以便单测。

/** 创建内存计数器：{ snapshot(), tryReserve(), release(reservation) }。 */
export function createMemoryQuota({ limit, now = Date.now }) {
  const days = new Map(); // day(string) -> used(number)

  const snapshotFor = (day) => {
    const used = Math.min(days.get(day) ?? 0, limit);
    return { limit, used, remaining: Math.max(0, limit - used), resetAt: quotaResetAt(day) };
  };

  return {
    snapshot() {
      return snapshotFor(quotaDay(now()));
    },
    tryReserve() {
      const day = quotaDay(now());
      const snap = snapshotFor(day);
      if (snap.remaining <= 0) return { ok: false, day, snapshot: snap };
      days.set(day, snap.used + 1);
      return { ok: true, day, snapshot: snapshotFor(day) };
    },
    release(reservation) {
      const used = days.get(reservation.day) ?? 0;
      if (used > 0) days.set(reservation.day, used - 1); // 按预占时的日期回退，跨天不污染新的一天
    },
  };
}
