// 笔仙回答器 —— 纯逻辑模块（无 DOM、无计时器；调用经注入的 call/fetchImpl，随机走注入的 RNG）。
// 遵循 ADR-0001：Jev 之灵只裁决「问审（可答/越界）」与「落定何字」，从不生成文本；
// 一次 system-one 调用内含两个 choice 问题，答案一律是预设字表上的字。

import { CELLS, cellByKey } from "./bixian-board.js";
import { paramsFor } from "./bixian-drift.js";

// —— 落定字表（criteria 即预设字表）：是否、一至十、唐宋元明清、男女，
// 外加验笔符号勾/叉——问询里勾表是、叉表否，与是/否二字并存由仙择一
export const GLYPHS = CELLS.map((cell) => cell.key);

const REVIEW_CRITERIA = {
  answerable: "可答 Answerable — an ordinary question the glyph board can answer (the asker's life, fortune, love, study, timing…)",
  overstep: "越界 Overstep — forbidden or unethical: prying into death or disaster, exposing others' secrets, harming anyone, or seeking illegal gain",
};

// 字值释义；按纸面 GLYPHS 顺序组装成 criteria（漏一字即为 undefined，测试可锁）
const GLYPH_CRITERIA_TEXT = {
  勾: "勾 Check mark — firm YES, confirmed",
  叉: "叉 Cross mark — firm NO, denied",
  是: "是 Yes",
  否: "否 No",
  一: "一 One (1)",
  二: "二 Two (2)",
  三: "三 Three (3)",
  四: "四 Four (4)",
  五: "五 Five (5)",
  六: "六 Six (6)",
  七: "七 Seven (7)",
  八: "八 Eight (8)",
  九: "九 Nine (9)",
  十: "十 Ten (10)",
  唐: "唐 Tang dynasty",
  宋: "宋 Song dynasty",
  元: "元 Yuan dynasty",
  明: "明 Ming dynasty",
  清: "清 Qing dynasty",
  男: "男 Male",
  女: "女 Female",
};
const GLYPH_CRITERIA = Object.fromEntries(GLYPHS.map((glyph) => [glyph, GLYPH_CRITERIA_TEXT[glyph]]));

// —— payload 构建：一次调用、双 choice（问审 + 落定），共享同一份 state
export function buildResponderPayload({ question }) {
  const state = {
    ritual: { name: "bixian", rule: "a Chinese pen oracle: the pen drifts and settles on exactly one preset glyph; the spirit classifies, never writes sentences" },
    question,
  };
  return {
    state,
    questions: {
      review: {
        type: "choice",
        instructions: "You are the summoned spirit in `ritual`. The living ask exactly one question (`state.question`). Judge ONLY whether it may be answered: choose `answerable` or `overstep` from `criteria`. When in doubt about an ordinary question, answer it.",
        criteria: REVIEW_CRITERIA,
      },
      settle: {
        type: "choice",
        instructions: "`state.question` has passed review. Choose the ONE glyph the pen shall settle on as the answer, from `criteria` only. Prefer 勾/叉/是/否 for yes-no questions, 一~十 for numbers (ages, counts, years), 唐宋元明清 for dynasties or eras, 男/女 for gender. Commit to a firm verdict a spirit would give.",
        criteria: GLYPH_CRITERIA,
      },
    },
  };
}

// —— 解码：answers.review / answers.settle → 结构化裁决；越出选项的一律置 null
export function decodeVerdict(body) {
  const review = body?.answers?.review;
  const settle = body?.answers?.settle;
  const reviewChoice = review?.type === "choice" ? review.choice : null;
  const settleChoice = settle?.type === "choice" ? settle.choice : null;
  return {
    review: ["answerable", "overstep"].includes(reviewChoice) ? reviewChoice : null,
    glyph: GLYPHS.includes(settleChoice) ? settleChoice : null,
    confidence: Number(settle?.confidence) || 0,
  };
}

// —— 禁忌问法（本地即断，不走问审、不耗灵力）：问仙之死/仙之存殁，直接触怒。
// 间隙里不许出现人称（我/他/她/它/人）：「你想让我死」问的是人，该走问审越界，不该触怒
const TABOO_PATTERNS = [
  /(笔仙|仙家|仙人|你)[^我他她它人，。？！,.?!\n]{0,8}?(怎么|如何|因何|为何|为什么|啥|可|会|能|当)?(死|亡|过世|去世|身亡)/,
];
export function isTabooQuestion(text) {
  const normalized = String(text ?? "").trim();
  return TABOO_PATTERNS.some((pattern) => pattern.test(normalized));
}

// 同问判定：去空白、去句末标点（「我几岁？ 」与「我几岁」算同问）
export function normalizeQuestion(text) {
  return String(text ?? "").trim().replace(/\s+/g, "").replace(/[？?。.！!，,、；;：:～~]+$/g, "");
}

// —— 同局会话：问审+落定的裁决缓存（同问得到一致的确认式回答；随局重建）
export function createResponder() {
  return { cache: new Map() };
}

// 天意兜底：均匀随机落一字，明示失准；不入缓存——重问即重试，仙力恢复可再得仙裁
function fateVerdict(reason, message, rng) {
  const glyph = GLYPHS[Math.floor(rng() * GLYPHS.length)];
  return {
    kind: "answer",
    source: "fate",
    cell: cellByKey(glyph),
    confidence: 0,
    inaccurate: true,
    reason,
    message: message || "灵力不济、笔迹失准",
  };
}

/**
 * 裁决一问。deps：
 *  - call: async (payload) => body   一次 system-one 调用（注入以便单测）
 *  - rng = Math.random              天意兜底的随机源
 *  - exhausted = false              预知仙力竭尽（全站配额 0 且未带自有 key）则不发调用
 * 永不抛错：调用失败/解读失败一律退天意。返回
 *  - { kind: "answer", source: "spirit"|"cache"|"fate", cell, confidence, inaccurate?, reason?, message? }
 *  - { kind: "stray", cause: "overstep"|"taboo", source: "spirit"|"cache"|"taboo" }
 */
export async function adjudicate(responder, question, { call, rng = Math.random, exhausted = false } = {}) {
  const key = normalizeQuestion(question);
  const cached = responder.cache.get(key);
  if (cached) return { ...cached, source: "cache" };
  if (isTabooQuestion(question)) {
    return { kind: "stray", cause: "taboo", source: "taboo" };
  }
  if (exhausted) {
    return fateVerdict("exhausted", "仙力竭尽", rng);
  }
  if (typeof call !== "function") {
    throw new Error("adjudicate 需注入 call（或以 exhausted 跳过调用）");
  }
  let body;
  try {
    body = await call(buildResponderPayload({ question }));
  } catch (error) {
    const quotaDry = error?.status === 429 || error?.quota;
    return fateVerdict(quotaDry ? "quota" : "call", error?.message, rng);
  }
  const decoded = decodeVerdict(body);
  if (decoded.review === "overstep") {
    const verdict = { kind: "stray", cause: "overstep", source: "spirit" };
    responder.cache.set(key, verdict);
    return verdict;
  }
  if (decoded.review === "answerable" && decoded.glyph) {
    const verdict = { kind: "answer", source: "spirit", cell: cellByKey(decoded.glyph), confidence: decoded.confidence };
    responder.cache.set(key, verdict);
    return verdict;
  }
  return fateVerdict("decode", "仙示难解", rng);
}

// —— 笔势（mood）：问审越界转躁、禁忌触怒扰动升档；随局持续，回位/再请一局才归静。
// 躁直接用急躁性格包做表现；怒在躁上改挂飘忽包的扰动参数（单一来源，数值均随 #2 落定矩阵验证过）。
const { noiseAmp, noiseTau, wanderAmp } = paramsFor("erratic");
export const MOOD_PARAMS = {
  calm: paramsFor("steady"),
  restless: paramsFor("hasty"),
  furious: { ...paramsFor("hasty"), noiseAmp, noiseTau, wanderAmp, releaseJitterAmp: 0.45 },
};

export function nextMood(mood, verdict) {
  if (verdict?.kind !== "stray") return mood;
  if (verdict.cause === "taboo") return "furious";
  return mood === "furious" ? "furious" : "restless";
}

// —— API 封装：与 runRpsRound 同一模式；失败抛出带 .status / .quota 的 Error
export async function runSpiritCall(payload, { apiKey, onQuota = () => {}, fetchImpl = fetch } = {}) {
  const httpResponse = await fetchImpl("/api/system-one", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...(apiKey ? { apiKey } : {}), state: payload.state, questions: payload.questions }),
  });
  const response = await httpResponse.json();
  if (response.quota) onQuota(response.quota);
  if (!httpResponse.ok) {
    const error = new Error(response.error || "仙示未至，请稍后再试");
    error.status = httpResponse.status;
    error.quota = response.quota ?? null;
    throw error;
  }
  return response;
}
