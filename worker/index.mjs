import { handleSystemOne } from "../shared/system-one.mjs";

// Cloudflare Workers 入口：
// - POST /api/system-one 走共享的 Jev 处理逻辑
// - 其余请求交给静态资源绑定（dist/，带 SPA fallback，/quiz /game 等路由返回 index.html）

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
      const { status, payload } = await handleSystemOne(body);
      return Response.json(payload, { status });
    }
    return env.ASSETS.fetch(request);
  },
};
