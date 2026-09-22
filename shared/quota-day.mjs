// 配额「日」的计算：按北京时间（UTC+8，无夏令时）的日历日划分，每天 0 点重置。

const SHIFT_MS = 8 * 3600_000;

/** 当前所属的北京日历日，形如 "2026-09-22"。 */
export function quotaDay(now = Date.now()) {
  return new Date(now + SHIFT_MS).toISOString().slice(0, 10);
}

/** 该日对应的下一个北京时间 0 点（epoch 毫秒），即 day 当天的 16:00Z。 */
export function quotaResetAt(day) {
  return Date.parse(`${day}T16:00:00.000Z`);
}
