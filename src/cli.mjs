import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  evaluatePersonality,
  percentage,
  SAMPLE_ANSWERS,
  scoreBar,
  TEST_QUESTIONS,
} from "./personality.mjs";

const labels = {
  social_energy: "社交能量",
  spontaneity: "即兴探索",
  empathy_first: "共情优先",
  risk_appetite: "冒险倾向",
};

async function collectAnswers() {
  if (process.argv.includes("--sample")) return SAMPLE_ANSWERS;

  const inline = process.argv.find((arg) => arg.startsWith("--answers="));
  if (inline) return inline.slice("--answers=".length).split(",").map((answer) => answer.trim());

  const readline = createInterface({ input, output });
  const answers = [];
  console.log("Jev 娱乐性人格测试（每题输入 A 或 B）\n");
  try {
    for (const [index, question] of TEST_QUESTIONS.entries()) {
      console.log(`${index + 1}. ${question.text}`);
      question.options.forEach((option) => console.log(`   ${option}`));
      let answer = "";
      while (!/^[AB]$/i.test(answer)) {
        answer = (await readline.question("你的选择：")).trim();
      }
      answers.push(answer.toUpperCase());
      console.log();
    }
  } finally {
    readline.close();
  }
  return answers;
}

try {
  const answers = await collectAnswers();
  console.log("正在让 Jev 并行评估 4 个维度和 1 个人格原型…\n");
  const result = await evaluatePersonality(answers);

  console.log(`人格原型：${result.answers.archetype.choice}`);
  const archetypes = Object.entries(result.answers.archetype.probabilities)
    .sort(([, a], [, b]) => b - a)
    .map(([name, probability]) => `${name} ${percentage(probability)}`)
    .join(" · ");
  console.log(`候选概率：${archetypes}`);
  console.log(`原型置信度：${percentage(result.answers.archetype.confidence)}\n`);

  for (const key of Object.keys(labels)) {
    const answer = result.answers[key];
    console.log(`${labels[key].padEnd(6, "　")} ${scoreBar(answer.score)} ${answer.score.toFixed(2)}/4  置信度 ${percentage(answer.confidence)}`);
  }

  console.log(`\n模型：${result.model}`);
  console.log(`Token：输入 ${result.usage.input_tokens} / 输出 ${result.usage.output_tokens}`);
  console.log("提示：结果仅供娱乐，不是心理测量或诊断。 ");
} catch (error) {
  console.error(`运行失败：${error.message}`);
  process.exitCode = 1;
}
