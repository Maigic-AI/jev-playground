// 笔仙扰动调度 —— 纯逻辑模块（无 DOM、无计时器、无 navigator：何时发何种扰动在此定，
// 如何呈现——CSS 摇晃类、navigator.vibrate、视觉脉冲环——归调用方）。
// 参数全部来自原型标定（prototype/bixian-drift 结论 Q4）；正式玩法只用：常驻微晃 + 落定爆发一档，
// 明晃/试吓仅留代码作越界对照、不进正式玩法（无 UI 入口）。怒级笔势例外地升到明晃即止（CONTEXT·笔势）。

// 摇晃档位（索引即档级）：ampPx/rotDeg/period 是同名 CSS keyframes 的参数契约
export const DISTURB_TIERS = [
  { id: "off", ampPx: 0, rotDeg: 0, period: 0 }, // 关（减弱动效降级也落在此档）
  { id: "slight", ampPx: 1.1, rotDeg: 0, period: 2.8 }, // 微晃：常驻档
  { id: "bright", ampPx: 3.4, rotDeg: 0.12, period: 0.95 }, // 明晃：对照档（仅怒级笔势可达）
  { id: "scare", ampPx: 7, rotDeg: 0.4, period: 0.42 }, // 试吓：对照档（不可达，勿接任何来路）
];

// 落定爆发一档：短促连晃 + 烛光骤暗
export const BURST = { ampPx: 10, rotDeg: 0.5, reps: 8, stepMs: 110 };
export const CANDLE_DIP = { brightness: 0.5, ms: 550 };

// 震动节奏（pattern 即 Vibration API 的毫秒序列：vibrate-pause 交替；也是视觉脉冲环的时刻表）
export const VIBES = {
  breath: { every: [5, 9], pattern: [5] }, // 常息：静候时指上的呼吸
  triple: { every: [7, 11], pattern: [6, 380, 6, 380, 6] }, // 间歇三连：行笔时
  settle: { pattern: [16, 280, 8] }, // 落定顿：仅落定一瞬一次（无 every）
};

// 笔势 → 常驻摇晃档：静/躁皆微晃（躁在笔行、不在摇晃），怒升明晃即止、不涉试吓
export function tierForMood(mood) {
  const tiers = { calm: 1, restless: 1, furious: 2 };
  const tier = tiers[mood];
  if (tier === undefined) throw new Error(`未知笔势：${mood}（可选：${Object.keys(tiers).join(" / ")}）`);
  return tier;
}

// 相位 → 环境震动节奏：行笔（问/迷走）走间歇三连，静候/回位走常息，落定后与其余相位无环境震动
export function rhythmForPhase(phase) {
  if (phase === "asking" || phase === "strayed") return "triple";
  if (phase === "ready" || phase === "sending") return "breath";
  return null;
}

// 环境震动调度器：now 为单调秒时钟，随机走注入 RNG（可种子化）
export function createDisturbState(rng = Math.random) {
  return { rng, nextAt: null, seq: 0 };
}

const nextInterval = (state, rhythm) => {
  const [lo, hi] = VIBES[rhythm].every;
  return lo + state.rng() * (hi - lo);
};

// 每帧推进：active 为「此刻是否该有环境震动」（扶笔中且未降级）。到点返回 { kind, pattern, id }，
// 否则 null。脱手/降级/换节奏即重新布防——积压永不补发（离开很久回来不该连震）。
export function stepAmbient(state, now, { rhythm, active }) {
  if (!active || !rhythm || !VIBES[rhythm].every) {
    state.nextAt = null;
    return null;
  }
  if (state.nextAt === null) {
    state.nextAt = now + nextInterval(state, rhythm); // 布防：首拍也要等满一个间隔（贴上不震）
    return null;
  }
  if (now < state.nextAt) return null;
  state.nextAt = now + nextInterval(state, rhythm);
  return { id: ++state.seq, kind: rhythm, pattern: VIBES[rhythm].pattern };
}

// 落定扰动判定：常态爆发+骤暗；减弱动效下降级为只骤暗（无晃无闪，静态烛光底色 + 短暗）
export function settlePlan({ reduced }) {
  return { burst: !reduced, dip: true };
}
