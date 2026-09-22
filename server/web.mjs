import express from "express";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { handleProxyRequest } from "../shared/default-key.mjs";
import { createMemoryQuota } from "../shared/quota-memory.mjs";

// 本地开发可选加载 .env（JEV_API / JEV_DAILY_LIMIT）；不覆盖已存在的环境变量。
try {
  process.loadEnvFile();
} catch {
  /* .env 不存在时忽略 */
}

const app = express();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT || 5173);

// 站方默认 key + 每日配额（进程内计数器，重启即重置；生产环境以 Worker 的 Durable Object 为准）。
const defaultKey = process.env.JEV_API?.trim() || null;
const quota = createMemoryQuota({ limit: Math.max(0, Number(process.env.JEV_DAILY_LIMIT) || 500) });
const QUOTA_UNAVAILABLE = { available: false, limit: 0, used: 0, remaining: 0, resetAt: null };

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

app.post("/api/system-one", async (request, response) => {
  try {
    const { status, payload } = await handleProxyRequest(request.body, { defaultKey, quota });
    return response.status(status).json(payload);
  } catch {
    return response.status(500).json({ error: "服务内部错误，请稍后重试。" });
  }
});

app.get("/api/quota", async (_request, response) => {
  if (!defaultKey) return response.json(QUOTA_UNAVAILABLE);
  try {
    return response.json({ available: true, ...(await quota.snapshot()) });
  } catch {
    return response.status(500).json(QUOTA_UNAVAILABLE);
  }
});

if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.join(root, "dist")));
  app.get("/{*path}", (_request, response) => response.sendFile(path.join(root, "dist", "index.html")));
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({ root, server: { middlewareMode: true, hmr: false }, appType: "spa" });
  app.use(vite.middlewares);
}

app.listen(port, "127.0.0.1", () => {
  console.log(`Jev Playground: http://127.0.0.1:${port}`);
});
