import { choice, score, TypeSafeClient } from "@typesafe-ai/sdk";

export const TEST_QUESTIONS = [
  {
    text: "一个没有安排的周末，你更想怎样度过？",
    options: ["A. 独处充电，沉浸在自己的兴趣里", "B. 约朋友出门，越热闹越有精神"],
  },
  {
    text: "接到一个完全陌生的项目时，你通常先做什么？",
    options: ["A. 先列步骤和风险，再开始执行", "B. 先做一个小实验，边走边调整"],
  },
  {
    text: "团队讨论出现分歧时，什么更能说服你？",
    options: ["A. 数据、逻辑和可验证的依据", "B. 每个人的感受和方案对关系的影响"],
  },
  {
    text: "旅行前，你更接近哪种状态？",
    options: ["A. 住宿、路线和备选方案都提前安排", "B. 只定大方向，把惊喜留给现场"],
  },
  {
    text: "面对一个高回报但结果不确定的机会，你更可能？",
    options: ["A. 先控制风险，信息足够后再决定", "B. 只要最坏结果能承受，就愿意尝试"],
  },
  {
    text: "朋友向你倾诉烦恼时，你的第一反应通常是？",
    options: ["A. 帮他拆解问题，找出可行动的解法", "B. 先理解他的情绪，让他感到被接住"],
  },
];

export const SAMPLE_ANSWERS = ["A", "B", "A", "B", "B", "A"];

export function buildState(answers) {
  if (answers.length !== TEST_QUESTIONS.length) {
    throw new Error(`需要 ${TEST_QUESTIONS.length} 个答案，当前收到 ${answers.length} 个。`);
  }

  return {
    purpose: "娱乐性人格倾向测试，不是心理诊断",
    responses: TEST_QUESTIONS.map((question, index) => {
      const answer = answers[index].toUpperCase();
      const optionIndex = answer === "A" ? 0 : answer === "B" ? 1 : -1;
      if (optionIndex < 0) throw new Error(`第 ${index + 1} 题只能回答 A 或 B。`);
      return {
        question: question.text,
        answer: question.options[optionIndex].slice(3),
      };
    }),
  };
}

export const personalityQuestions = {
  social_energy: score(
    "根据 `responses`，这个人的社交能量来源更接近哪一级？只评估偏好，不推断社交能力。",
    [
      "明显从独处和低刺激环境中恢复能量",
      "多数时候偏好独处，只在熟悉的小范围社交中获得能量",
      "独处与社交的能量偏好大致平衡，取决于情境",
      "多数时候从与人互动和外部刺激中获得能量",
      "明显从频繁、多样和高强度的社交互动中获得能量",
    ],
  ),
  spontaneity: score(
    "根据 `responses`，这个人面对计划与变化时有多偏好即兴探索？",
    [
      "强烈偏好预先规划、明确步骤和可预测结果",
      "通常先规划，只为少量变化留出空间",
      "规划与即兴大致平衡，会按情境选择",
      "通常先行动再调整，愿意保留较多开放空间",
      "强烈偏好即兴探索，主动寻找变化和意外可能",
    ],
  ),
  empathy_first: score(
    "根据 `responses`，这个人在处理他人问题或分歧时有多倾向先关注情绪与关系？",
    [
      "几乎总是先看逻辑、事实和问题解法",
      "通常先分析问题，也会考虑情绪与关系",
      "分析问题与照顾情绪大致平衡",
      "通常先理解情绪与关系，再考虑解决方案",
      "几乎总是先维护感受、关系和心理安全",
    ],
  ),
  risk_appetite: score(
    "根据 `responses`，这个人在信息不完整时有多愿意承担可控风险？",
    [
      "需要高度确定性，会尽量避免不确定结果",
      "偏谨慎，通常在掌握充分信息后才行动",
      "谨慎与冒险大致平衡，取决于收益和后果",
      "愿意在最坏结果可承受时较快尝试",
      "主动追求高不确定性、高变化和高潜在回报",
    ],
  ),
  archetype: choice("综合 `responses`，哪个娱乐性人格原型最贴近这个人的整体行为偏好？", {
    strategist: "策略家：先看结构、证据和风险，喜欢让行动可控",
    explorer: "探索者：好奇、灵活，愿意通过行动发现答案",
    connector: "连接者：从互动中获得能量，重视关系与共同体验",
    guardian: "守护者：稳定、谨慎、体察他人，重视安全与秩序",
    adapter: "适应者：没有单一强偏好，会随情境切换策略",
  }),
};

export function createClient() {
  const apiKey = process.env.TYPESAFE_API_KEY?.trim() || process.env.JEV_API?.trim();
  if (!apiKey) {
    throw new Error("未找到 API key。请在 .env 中设置 JEV_API 或 TYPESAFE_API_KEY。");
  }
  return new TypeSafeClient({ apiKey });
}

export async function evaluatePersonality(answers, client = createClient()) {
  return client.systemOne({
    model: "jev-latest",
    state: buildState(answers),
    questions: personalityQuestions,
  });
}

export function percentage(value) {
  return `${Math.round(value * 100)}%`;
}

export function scoreBar(value, max = 4, width = 10) {
  const filled = Math.round((value / max) * width);
  return `${"█".repeat(filled)}${"░".repeat(width - filled)}`;
}
