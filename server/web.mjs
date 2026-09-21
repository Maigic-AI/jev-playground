import express from "express";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { handleSystemOne } from "../shared/system-one.mjs";

const app = express();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT || 5173);

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

app.post("/api/system-one", async (request, response) => {
  const { status, payload } = await handleSystemOne(request.body);
  return response.status(status).json(payload);
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
