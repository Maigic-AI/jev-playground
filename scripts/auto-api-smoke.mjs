import { readFile } from "node:fs/promises";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { buildAutoBatch, decodeAutoBatch } from "../src/lib/auto-run.js";
import { scoreSbti } from "../src/lib/scoring.js";

const readJson = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
const [questionData, dimensions, types, config] = await Promise.all([
  readJson("../public/vendor/sbti/questions.json"),
  readJson("../public/vendor/sbti/dimensions.json"),
  readJson("../public/vendor/sbti/types.json"),
  readJson("../public/vendor/sbti/config.json"),
]);

const apiKey = process.env.TYPESAFE_API_KEY?.trim() || process.env.JEV_API?.trim();
if (!apiKey) throw new Error("未找到 JEV_API 或 TYPESAFE_API_KEY。");

const testDefinition = { title: "SBTI", locale: "zh", questions: questionData.main };
const batches = [questionData.main.slice(0, 18), questionData.main.slice(18)];
const client = new TypeSafeClient({ apiKey, timeout: 30_000 });
const details = [];
let inputTokens = 0;
let model = null;

for (const batch of batches) {
  const response = await client.systemOne(buildAutoBatch(testDefinition, batch));
  details.push(...decodeAutoBatch(batch, response));
  inputTokens += response.usage.input_tokens;
  model = response.model;
}

const answers = Object.fromEntries(details.map((item) => [item.questionId, item.selectedValue]));
const result = scoreSbti(questionData.main, answers, dimensions, types, config);
const averageConfidence = details.reduce((sum, item) => sum + item.confidence, 0) / details.length;

console.log(JSON.stringify({
  ok: details.length === questionData.main.length,
  model,
  questionsAnswered: details.length,
  batchCount: batches.length,
  result: `${result.primary.code} · ${result.primary.cn}`,
  similarity: result.primary.similarity,
  averageConfidence: Number(averageConfidence.toFixed(3)),
  inputTokens,
}, null, 2));
