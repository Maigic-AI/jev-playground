import express from "express";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { fileURLToPath } from "node:url";
import path from "node:path";

const app = express();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT || 5173);

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

app.post("/api/system-one", async (request, response) => {
  const { apiKey, state, questions, model = "jev-latest" } = request.body ?? {};
  if (typeof apiKey !== "string" || !apiKey.trim()) {
    return response.status(400).json({ error: "请先填写 TypeSafe API key。" });
  }
  if (!state || !questions || typeof questions !== "object") {
    return response.status(400).json({ error: "测试数据不完整。" });
  }
  const entries = Object.entries(questions);
  if (entries.length < 1 || entries.length > 40) {
    return response.status(400).json({ error: "问题数量必须在 1 到 40 之间。" });
  }
  for (const [, question] of entries) {
    if (!question || !["choice", "score", "noul"].includes(question.type)) {
      return response.status(400).json({ error: "包含不支持的问题类型。" });
    }
  }

  try {
    const client = new TypeSafeClient({ apiKey: apiKey.trim(), timeout: 30_000 });
    const result = await client.systemOne({ model, state, questions });
    return response.json(result);
  } catch (error) {
    const status = Number(error?.status) || 502;
    const safeStatus = status >= 400 && status < 600 ? status : 502;
    return response.status(safeStatus).json({
      error: error?.message || "TypeSafe 请求失败，请稍后重试。",
    });
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
