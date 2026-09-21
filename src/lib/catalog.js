import { questionsEn } from "../data/8values-en.js";
import { questionsZh } from "../data/8values-cn.js";
import { score8Values, scoreMbti, scoreSbti } from "./scoring.js";

export const catalog = [
  {
    id: "sbti",
    title: "SBTI",
    subtitle: "今天的你是哪种抽象人格？",
    detail: "30 题 · 27 种人格",
    emoji: "🪩",
    color: "coral",
    languages: ["zh"],
    source: "pingfanfan/SBTI",
  },
  {
    id: "mbti",
    title: "16 型人格",
    subtitle: "同一套题，切换中英文再测一次",
    detail: "40 / 93 题 · 中英双语",
    emoji: "🧩",
    color: "violet",
    languages: ["zh", "en"],
    variants: ["40", "93"],
    source: "luhuadong/mbti-test",
  },
  {
    id: "8values",
    title: "8values",
    subtitle: "四组坐标，看看价值观落在哪里",
    detail: "70 题 · 中英双语",
    emoji: "🌏",
    color: "lime",
    languages: ["zh", "en"],
    source: "8values",
  },
];

async function json(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`题库加载失败：${response.status}`);
  return response.json();
}

export async function loadTest(id, locale = "zh", variant = "40") {
  if (id === "mbti") {
    const questionCount = variant === "93" ? "93" : "40";
    const payload = await json(`/vendor/mbti/questions_${questionCount}.json`);
    const questions = payload.MBTI_questions.map((item) => ({
      id: item.id,
      dimension: item.dimension,
      text: item.question[locale],
      options: item.options[locale].map((label, value) => ({ label, value })),
    }));
    return {
      id, locale, variant: questionCount, title: locale === "zh" ? `16 型人格 · ${questionCount}题` : `16-type personality · ${questionCount}Q`,
      questions,
      score: (answers) => scoreMbti(questions, answers),
      answerLabels: null,
      source: "luhuadong/mbti-test · MIT",
    };
  }

  if (id === "8values") {
    const raw = locale === "zh" ? questionsZh : questionsEn;
    const questions = raw.map((item, index) => ({
      id: `q${index + 1}`,
      text: item.question,
      effect: item.effect,
      options: [
        { label: locale === "zh" ? "非常同意" : "Strongly agree", value: 1 },
        { label: locale === "zh" ? "同意" : "Agree", value: 0.5 },
        { label: locale === "zh" ? "中立 / 不确定" : "Neutral / unsure", value: 0 },
        { label: locale === "zh" ? "不同意" : "Disagree", value: -0.5 },
        { label: locale === "zh" ? "非常不同意" : "Strongly disagree", value: -1 },
      ],
    }));
    return {
      id, locale, title: "8values", questions,
      score: (answers) => score8Values(questions, answers),
      source: locale === "zh" ? "Songyon/8valuescn · MIT" : "8values/8values.github.io · MIT",
    };
  }

  const [questionData, dimensions, types, config] = await Promise.all([
    json("/vendor/sbti/questions.json"),
    json("/vendor/sbti/dimensions.json"),
    json("/vendor/sbti/types.json"),
    json("/vendor/sbti/config.json"),
  ]);
  const questions = questionData.main;
  return {
    id, locale: "zh", title: "SBTI", questions, dimensions, types, config,
    score: (answers) => scoreSbti(questions, answers, dimensions, types, config),
    source: "pingfanfan/SBTI · MIT",
  };
}

const MBTI_TYPES = ["ISTJ", "ISFJ", "INFJ", "INTJ", "ISTP", "ISFP", "INFP", "INTP", "ESTP", "ESFP", "ENFP", "ENTP", "ESTJ", "ESFJ", "ENFJ", "ENTJ"];

function responseState(test, answers) {
  return {
    test: { name: test.title, language: test.locale, purpose: "娱乐性测试，不用于诊断" },
    responses: test.questions.map((question) => {
      const value = answers[question.id];
      const option = question.options.find((item) => item.value === value);
      return { question: question.text, selected_answer: option?.label ?? String(value) };
    }),
  };
}

export function buildJevPayload(test, answers) {
  const state = responseState(test, answers);
  if (test.id === "mbti") {
    const questions = {
      ei: { type: "score", instructions: "根据 `responses`，此人的能量偏好从外向到内向更接近哪一级？", criteria: ["明显外向", "偏外向", "情境平衡", "偏内向", "明显内向"] },
      sn: { type: "score", instructions: "根据 `responses`，此人的信息偏好从实感到直觉更接近哪一级？", criteria: ["明显偏好具体事实与现实经验", "偏好具体事实", "两者平衡", "偏好概念与可能性", "明显偏好抽象概念与未来可能"] },
      tf: { type: "score", instructions: "根据 `responses`，此人的决策偏好从思考到情感更接近哪一级？", criteria: ["明显优先逻辑与一致性", "偏逻辑", "两者平衡", "偏关系与价值", "明显优先感受、关系与价值"] },
      jp: { type: "score", instructions: "根据 `responses`，此人的生活方式从判断到知觉更接近哪一级？", criteria: ["明显偏好计划、确定与收束", "偏计划", "两者平衡", "偏开放与灵活", "明显偏好即兴、开放与探索"] },
      type: { type: "choice", instructions: "综合 `responses`，哪个 16 型人格代码最贴近此人的整体偏好？", criteria: Object.fromEntries(MBTI_TYPES.map((type) => [type, `${type} 所代表的四个偏好组合`])) },
    };
    return { state, questions };
  }
  if (test.id === "8values") {
    return {
      state,
      questions: {
        econ: { type: "score", instructions: "根据 `responses`，此人的经济价值取向从平等到市场更接近哪一级？", criteria: ["强烈平等", "偏平等", "居中", "偏市场", "强烈市场"] },
        dipl: { type: "score", instructions: "根据 `responses`，此人的外交价值取向从国家到世界更接近哪一级？", criteria: ["强烈国家", "偏国家", "居中", "偏世界", "强烈世界"] },
        govt: { type: "score", instructions: "根据 `responses`，此人的公民价值取向从自由到权威更接近哪一级？", criteria: ["强烈自由", "偏自由", "居中", "偏权威", "强烈权威"] },
        scty: { type: "score", instructions: "根据 `responses`，此人的社会价值取向从传统到进步更接近哪一级？", criteria: ["强烈传统", "偏传统", "居中", "偏进步", "强烈进步"] },
      },
    };
  }
  const typeCriteria = Object.fromEntries(test.types.standard.map((type) => [type.code, `${type.cn}：${type.intro}`]));
  const modelQuestions = Object.fromEntries(Object.entries(test.dimensions.models).map(([key, model]) => [
    `model_${key.toLowerCase()}`,
    { type: "score", instructions: `根据 \`responses\`，此人在“${model.cn}”相关倾向上的整体强度如何？`, criteria: ["整体偏低", "略低", "中等或混合", "略高", "整体偏高"] },
  ]));
  return {
    state,
    questions: {
      ...modelQuestions,
      type: { type: "choice", instructions: "综合 `responses`，哪个 SBTI 娱乐性人格类型最贴近此人的整体表现？", criteria: typeCriteria },
    },
  };
}
