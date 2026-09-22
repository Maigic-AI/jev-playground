import { handleProxyRequest } from "../shared/default-key.mjs";
import { QuotaCounter } from "./quota-do.mjs";

// Cloudflare Workers 入口：
// - POST /api/system-one 走共享的代理策略（自带 key 透传；无 key 用站方默认 key + 每日配额）
// - GET /api/quota 返回默认 API 的当日配额快照
// - 其余请求交给静态资源绑定（dist/，带 SPA fallback，/quiz /game 等路由返回 index.html）
//
// 站方默认 key 通过 `npx wrangler secret put JEV_API` 配置，只存在于服务端；
// 每日限额通过 wrangler.jsonc 的 vars.JEV_DAILY_LIMIT 配置（默认 500）。

export { QuotaCounter };

const QUOTA_UNAVAILABLE = { available: false, limit: 0, used: 0, remaining: 0, resetAt: null };

function quotaLimit(env) {
  return Math.max(0, Number(env.JEV_DAILY_LIMIT) || 500);
}

function durableQuota(env) {
  const stub = env.QUOTA.get(env.QUOTA.idFromName("global"));
  const limit = quotaLimit(env);
  return {
    snapshot: () => stub.snapshot(limit),
    tryReserve: () => stub.tryReserve(limit),
    release: (reservation) => stub.release(reservation.day),
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/system-one") {
      if (request.method !== "POST") {
        return Response.json({ error: "只支持 POST 请求。" }, { status: 405, headers: { Allow: "POST" } });
      }
      let body = null;
      try {
        body = await request.json();
      } catch {
        body = null;
      }
      try {
        const { status, payload } = await handleProxyRequest(body, {
          defaultKey: typeof env.JEV_API === "string" ? env.JEV_API.trim() || null : null,
          quota: durableQuota(env),
        });
        return Response.json(payload, { status });
      } catch (error) {
        console.error("system-one 代理失败：", error);
        return Response.json({ error: "服务内部错误，请稍后重试。" }, { status: 500 });
      }
    }
    if (url.pathname === "/api/quota") {
      if (request.method !== "GET") {
        return Response.json({ error: "只支持 GET 请求。" }, { status: 405, headers: { Allow: "GET" } });
      }
      const headers = { "Cache-Control": "no-store" };
      if (!env.JEV_API) return Response.json(QUOTA_UNAVAILABLE, { headers });
      try {
        return Response.json({ available: true, ...(await durableQuota(env).snapshot()) }, { headers });
      } catch (error) {
        console.error("读取配额失败：", error);
        return Response.json(QUOTA_UNAVAILABLE, { headers, status: 500 });
      }
    }
    return env.ASSETS.fetch(request);
  },
};
