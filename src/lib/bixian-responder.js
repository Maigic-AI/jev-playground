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
// 笔势是**叠在当局漂移性格之上**的行为表现（CONTEXT·笔势：只叠扰动、不换性格）——只加躁、不退性格。
// 故这里记的是相对增量而非整包：性格标志位（cruiseSpeed／ringR0／warmup／damping…）一律取自当局性格包，
// 只有扰动项（噪声／环心游走／松手微抖）随势升。若像从前那样整包替换（躁=急躁包、静=沉稳包），
// 一局之内赋一次笔势就会把当局性格悄悄踩回沉稳——不报错、只是手感没了（#7 的坑）。
// 增量按**绝对量**计（add），不按倍数（mul）：倍数叠在已经极端的档上会复利——怒 ×2 落在飘忽的
// 噪声 13 上就是 26，落定耗时被顶出 #2 锁死的窗（40 种子 × 6 目标实测越窗 29/240、最长 33.8s，
// 补行送仙最长 37.1s），笔心出纸的帧占比也从 0.09% 涨到 0.67%。绝对量则「无论请来的是哪一档，
// 怒都加同样的一分躁」：躁 = 怒的一半；怒另加噪声更碎（tau 是相关时间、非幅度，仍按倍数缩）
// 与脱手微抖更明显。同一口径复测：沉稳×怒 = 噪声 14／游走 15.3／微抖 0.45（#4 旧值 13／15／0.45，
// 手感一致），飘忽×怒降到噪声 20／游走 21.3，越窗 6/240、最长 28.4s，补行最长回位 24.1s。
// 残留：飘忽的躁/怒在宽种子下仍有约 1.7% 的落定擦过 28s 窗沿（最长 28.6s）——#2 的窗本为静息
// 标定，笔势是「更躁」的定义，这点溢出记在 bixian-mood 的长尾上界里，不再靠收紧性格参数去够。
export const MOOD_OVERLAYS = {
  calm: {},
  restless: { add: { noiseAmp: 3.5, wanderAmp: 3.15 } },
  furious: {
    add: { noiseAmp: 7, wanderAmp: 6.3, releaseJitterAmp: 0.2 },
    mul: { noiseTau: 0.6 }, // 噪声更碎（tau 短，笔锋更「跳」）
  },
};

// 当局性格 × 笔势 → 帧循环实际使用的参数包
export function paramsWithMood(personalityId, mood) {
  const base = paramsFor(personalityId);
  const overlay = MOOD_OVERLAYS[mood];
  if (!overlay) throw new Error(`未知笔势：${mood}（可选：${Object.keys(MOOD_OVERLAYS).join(" / ")}）`);
  const params = { ...base };
  for (const [key, delta] of Object.entries(overlay.add ?? {})) params[key] += delta;
  for (const [key, factor] of Object.entries(overlay.mul ?? {})) params[key] *= factor;
  return params;
}

export function nextMood(mood, verdict) {
  if (verdict?.kind !== "stray") return mood;
  if (verdict.cause === "taboo") return "furious";
  return mood === "furious" ? "furious" : "restless";
}

// —— API 封装：与 runRpsRound 同一模式；失败抛出带 .status / .quota 的 Error。
// signal 用于离场/作废时中断在途调用（与 runRpsRound 同款）；不传则行为不变
export async function runSpiritCall(payload, { apiKey, onQuota = () => {}, signal, fetchImpl = fetch } = {}) {
  const httpResponse = await fetchImpl("/api/system-one", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...(apiKey ? { apiKey } : {}), state: payload.state, questions: payload.questions }),
    ...(signal ? { signal } : {}),
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
