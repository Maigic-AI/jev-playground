import test from "node:test";
import assert from "node:assert/strict";
import { quotaDay, quotaResetAt } from "../shared/quota-day.mjs";
import { createMemoryQuota } from "../shared/quota-memory.mjs";

test("配额日按北京时间 0 点切换（16:00Z 边界）", () => {
  assert.equal(quotaDay(Date.parse("2026-09-22T15:59:59.999Z")), "2026-09-22");
  assert.equal(quotaDay(Date.parse("2026-09-22T16:00:00.000Z")), "2026-09-23");
});

test("重置时间总是当前时刻之后的下一个北京时间 0 点", () => {
  const start = Date.parse("2026-09-22T00:00:00.000Z");
  for (let offset = 0; offset < 72; offset += 1) {
    const now = start + offset * 3600_000;
    const day = quotaDay(now);
    const resetAt = quotaResetAt(day);
    assert.equal(new Date(resetAt).toISOString(), `${day}T16:00:00.000Z`);
    assert.ok(resetAt > now, `resetAt 应晚于 now（offset=${offset}）`);
  }
});

test("内存计数器：预占至上限后拒绝，release 恢复一个名额", () => {
  const quota = createMemoryQuota({ limit: 2, now: () => 0 });
  assert.deepEqual(quota.snapshot(), { limit: 2, used: 0, remaining: 2, resetAt: quotaResetAt(quotaDay(0)) });

  const first = quota.tryReserve();
  assert.equal(first.ok, true);
  assert.equal(first.snapshot.used, 1);

  const second = quota.tryReserve();
  assert.equal(second.ok, true);

  const third = quota.tryReserve();
  assert.equal(third.ok, false);
  assert.equal(third.snapshot.remaining, 0);
  assert.equal(quota.snapshot().used, 2);

  quota.release(second);
  assert.equal(quota.snapshot().remaining, 1);
});

test("内存计数器：跨天后额度重置", () => {
  let now = Date.parse("2026-09-22T10:00:00.000Z");
  const quota = createMemoryQuota({ limit: 1, now: () => now });
  assert.equal(quota.tryReserve().ok, true);
  assert.equal(quota.tryReserve().ok, false);

  now = Date.parse("2026-09-22T16:00:00.001Z"); // 北京时间已进入次日
  assert.equal(quota.snapshot().remaining, 1);
  assert.equal(quota.tryReserve().ok, true);
});

test("内存计数器：跨天 release 只回退预占当天的计数", () => {
  let now = Date.parse("2026-09-22T10:00:00.000Z");
  const quota = createMemoryQuota({ limit: 1, now: () => now });
  const reservation = quota.tryReserve();
  assert.equal(reservation.ok, true);

  now = Date.parse("2026-09-23T02:00:00.000Z");
  quota.release(reservation);
  assert.deepEqual(quota.snapshot().used, 0); // 新的一天不受昨天的回退影响
});

test("内存计数器：limit 为 0 时始终拒绝", () => {
  const quota = createMemoryQuota({ limit: 0, now: () => 0 });
  assert.equal(quota.tryReserve().ok, false);
  assert.equal(quota.snapshot().remaining, 0);
});

test("snapshot 的 limit 反映配置值（前端展示的总额来自服务端）", () => {
  for (const limit of [3, 200, 500]) {
    const quota = createMemoryQuota({ limit, now: () => 0 });
    assert.equal(quota.snapshot().limit, limit);
  }
});
