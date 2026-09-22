import test from "node:test";
import assert from "node:assert/strict";
import { handleProxyRequest } from "../shared/default-key.mjs";

// 可通过校验的最小请求体（apiKey 由策略模块补上）。
const validBody = {
  state: { subject: "test" },
  questions: { item_0: { type: "choice", criteria: { option_a: "是", option_b: "否" } } },
};

/** 记录调用序列的假配额计数器。 */
function fakeQuota(script = {}) {
  const calls = [];
  return {
    calls,
    async snapshot() {
      calls.push("snapshot");
      return { limit: 500, used: 1, remaining: 499, resetAt: 1790000000000 };
    },
    async tryReserve() {
      calls.push("tryReserve");
      if (script.reserve === false) {
        return { ok: false, day: "2026-09-22", snapshot: { limit: 500, used: 500, remaining: 0, resetAt: 1790000000000 } };
      }
      return { ok: true, day: "2026-09-22", snapshot: { limit: 500, used: 1, remaining: 499, resetAt: 1790000000000 } };
    },
    async release() {
      calls.push("release");
    },
  };
}

/** 记录收到的请求体的假上游。 */
function fakeUpstream(result = { status: 200, payload: { answers: {}, model: "jev-latest" } }) {
  const received = [];
  return {
    received,
    async callUpstream(body) {
      received.push(body);
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

test("访客自带 key：原样透传，不占配额", async () => {
  const quota = fakeQuota();
  const upstream = fakeUpstream();
  const result = await handleProxyRequest(
    { ...validBody, apiKey: "ts_own_key" },
    { defaultKey: "ts_site_key", quota, callUpstream: upstream.callUpstream }
  );
  assert.equal(result.status, 200);
  assert.deepEqual(upstream.received[0], { ...validBody, apiKey: "ts_own_key" });
  assert.deepEqual(quota.calls, []);
  assert.equal("quota" in result.payload, false);
});

test("站方未配置默认 key：维持原有 400 提示", async () => {
  const quota = fakeQuota();
  const upstream = fakeUpstream();
  const result = await handleProxyRequest(validBody, { defaultKey: null, quota, callUpstream: upstream.callUpstream });
  assert.equal(result.status, 400);
  assert.equal(result.payload.error, "请先填写 TypeSafe API key。");
  assert.deepEqual(quota.calls, []);
  assert.equal(upstream.received.length, 0);
});

test("默认 key 正常路径：服务端补 key 调上游，成功响应附带配额快照", async () => {
  const quota = fakeQuota();
  const upstream = fakeUpstream();
  const result = await handleProxyRequest(validBody, { defaultKey: "ts_site_key", quota, callUpstream: upstream.callUpstream });
  assert.equal(result.status, 200);
  assert.equal(upstream.received[0].apiKey, "ts_site_key");
  assert.equal(upstream.received[0].state.subject, "test");
  assert.equal(result.payload.model, "jev-latest");
  assert.deepEqual(result.payload.quota, { limit: 500, used: 1, remaining: 499, resetAt: 1790000000000 });
  assert.ok(quota.calls.includes("tryReserve"));
  assert.ok(!quota.calls.includes("release"));
});

test("上游返回非 200：释放名额并透传错误", async () => {
  for (const status of [400, 502]) {
    const quota = fakeQuota();
    const upstream = fakeUpstream({ status, payload: { error: "上游错误" } });
    const result = await handleProxyRequest(validBody, { defaultKey: "ts_site_key", quota, callUpstream: upstream.callUpstream });
    assert.equal(result.status, status);
    assert.equal(result.payload.error, "上游错误");
    assert.ok(quota.calls.includes("release"));
    assert.equal("quota" in result.payload, false);
  }
});

test("上游抛错：释放名额后重抛", async () => {
  const quota = fakeQuota();
  const upstream = fakeUpstream(new Error("boom"));
  await assert.rejects(
    handleProxyRequest(validBody, { defaultKey: "ts_site_key", quota, callUpstream: upstream.callUpstream }),
    /boom/
  );
  assert.ok(quota.calls.includes("release"));
});

test("额度不足：返回 429 且附带配额快照，不调上游", async () => {
  const quota = fakeQuota({ reserve: false });
  const upstream = fakeUpstream();
  const result = await handleProxyRequest(validBody, { defaultKey: "ts_site_key", quota, callUpstream: upstream.callUpstream });
  assert.equal(result.status, 429);
  assert.ok(result.payload.error.includes("已用完"));
  assert.equal(result.payload.quota.remaining, 0);
  assert.equal(upstream.received.length, 0);
  assert.ok(!quota.calls.includes("release"));
});

test("非法请求体：先校验后预占，坏请求不占配额", async () => {
  const quota = fakeQuota();
  const upstream = fakeUpstream();
  const tooMany = { state: {}, questions: Object.fromEntries(Array.from({ length: 41 }, (_, i) => [`item_${i}`, { type: "choice" }])) };
  const result = await handleProxyRequest(tooMany, { defaultKey: "ts_site_key", quota, callUpstream: upstream.callUpstream });
  assert.equal(result.status, 400);
  assert.deepEqual(quota.calls, []);
  assert.equal(upstream.received.length, 0);
});

test("空白 apiKey 视为未填写，走默认 key 路径", async () => {
  const quota = fakeQuota();
  const upstream = fakeUpstream();
  const result = await handleProxyRequest({ ...validBody, apiKey: "   " }, { defaultKey: "ts_site_key", quota, callUpstream: upstream.callUpstream });
  assert.equal(result.status, 200);
  assert.equal(upstream.received[0].apiKey, "ts_site_key");
});
