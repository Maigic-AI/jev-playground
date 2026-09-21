import { createClient } from "./personality.mjs";

try {
  const models = await createClient().models.list();
  console.log("TypeSafe API 连接成功。");
  for (const model of models) console.log(`- ${model.name}: ${model.description}`);
} catch (error) {
  console.error(`TypeSafe API 连接失败：${error.message}`);
  process.exitCode = 1;
}
