import test from "node:test";
import assert from "node:assert/strict";
import {
  DISTURB_TIERS, BURST, CANDLE_DIP, VIBES,
  tierForMood, rhythmForPhase, createDisturbState, stepAmbient, settlePlan,
} from "../src/lib/bixian-disturb.js";

// 扰动调度（spec #5）：档位/节奏的「何时发」是纯逻辑（本模块），「如何呈现」归 UI（CSS/震动调用）。
// 档位参数全部来自原型标定：微晃 ±1.1px·2.8s；明晃 ±3.4px+0.12°·0.95s；试吓 ±7px+0.4°·0.42s；
// 落定爆发 ±10px+0.5°×8 次 0.11s + 烛光骤暗 brightness .5 / 550ms。明晃/试吓仅留代码作对照，不进正式玩法。

const midRng = () => 0.5; // 固定中位随机：间隔恒取区间中点

test("档位与节奏参数逐项等于原型标定值（正式玩法只用到微晃与爆发）", () => {
  assert.equal(DISTURB_TIERS.length, 4, "四档：关/微晃/明晃/试吓");
  const [off, slight, bright, scare] = DISTURB_TIERS;
  assert.deepEqual(pick(off, ["id", "ampPx", "rotDeg"]), { id: "off", ampPx: 0, rotDeg: 0 });
  assert.deepEqual(pick(slight, ["id", "ampPx", "period", "rotDeg"]), { id: "slight", ampPx: 1.1, period: 2.8, rotDeg: 0 });
  assert.deepEqual(pick(bright, ["id", "ampPx", "period", "rotDeg"]), { id: "bright", ampPx: 3.4, period: 0.95, rotDeg: 0.12 });
  assert.deepEqual(pick(scare, ["id", "ampPx", "period", "rotDeg"]), { id: "scare", ampPx: 7, period: 0.42, rotDeg: 0.4 });
  assert.deepEqual(pick(BURST, ["ampPx", "rotDeg", "reps", "stepMs"]), { ampPx: 10, rotDeg: 0.5, reps: 8, stepMs: 110 });
  assert.deepEqual(CANDLE_DIP, { brightness: 0.5, ms: 550 });
  assert.deepEqual(VIBES.breath, { every: [5, 9], pattern: [5] }, "常息 5ms/5–9s");
  assert.deepEqual(VIBES.triple, { every: [7, 11], pattern: [6, 380, 6, 380, 6] }, "间歇三连");
  assert.deepEqual(VIBES.settle.pattern, [16, 280, 8], "落定顿");
});

test("笔势映射档位：静/躁常驻微晃，怒止于明晃；试吓无任何来路", () => {
  assert.equal(tierForMood("calm"), 1, "静 → 微晃");
  assert.equal(tierForMood("restless"), 1, "躁 → 仍微晃（躁在笔行，不在摇晃）");
  assert.equal(tierForMood("furious"), 2, "怒 → 明晃（CONTEXT：怒级扰动止于明晃、不涉试吓）");
  const allTiers = ["calm", "restless", "furious"].map(tierForMood);
  assert.ok(allTiers.every((t) => t < 3), "试吓档（3）仅存于代码对照，无 gameplay 来路");
  assert.throws(() => tierForMood("unknown"), /笔势/, "未知笔势显式抛错（不静默回退）");
});

test("相位映射节奏：行笔与迷走走间歇三连，静候与回位走常息，其余无环境震动", () => {
  assert.equal(rhythmForPhase("asking"), "triple");
  assert.equal(rhythmForPhase("strayed"), "triple");
  assert.equal(rhythmForPhase("ready"), "breath");
  assert.equal(rhythmForPhase("sending"), "breath");
  for (const phase of ["idle", "summoning", "settled", "returned"]) {
    assert.equal(rhythmForPhase(phase), null, `${phase} 不发环境震动`);
  }
});

test("环境调度：扶笔后首拍等满一个间隔（贴上不震），到点发拍并重排", () => {
  const st = createDisturbState(midRng);
  const at = (t, active = true) => stepAmbient(st, t, { rhythm: "breath", active });
  assert.equal(at(0), null, "t=0 只布防不发拍");
  assert.equal(at(6.9), null, "中位间隔 7s 未到不发拍");
  const fired = at(7.0);
  assert.deepEqual(pick(fired, ["kind", "pattern"]), { kind: "breath", pattern: [5] }, "到点发常息一拍");
  assert.equal(fired.id, 1, "发拍带递增 id（视觉脉冲环的 React key）");
  assert.equal(at(7.1), null, "发拍后立即重排，下一拍要再等一个间隔");
  assert.ok(at(14.0), "第二拍到点（7+7）");
});

test("环境调度：间隔随注入 RNG 在档位区间内取值", () => {
  const lo = createDisturbState(() => 0);
  stepAmbient(lo, 0, { rhythm: "breath", active: true });
  assert.equal(stepAmbient(lo, 4.9, { rhythm: "breath", active: true }), null);
  assert.ok(stepAmbient(lo, 5.0, { rhythm: "breath", active: true }), "rng=0 → 间隔取下界 5s");

  const hi = createDisturbState(() => 0.999999);
  stepAmbient(hi, 0, { rhythm: "triple", active: true });
  assert.equal(stepAmbient(hi, 10.9, { rhythm: "triple", active: true }), null);
  assert.ok(stepAmbient(hi, 11.0, { rhythm: "triple", active: true }), "rng→1 → 间隔取上界 11s");
});

test("环境调度：脱手即止、积压不补发；重扶重新布防；换节奏重排", () => {
  const st = createDisturbState(midRng);
  stepAmbient(st, 0, { rhythm: "triple", active: true }); // 布防：9s（triple 中位）
  // 扶笔 3s 后脱手，空转很久
  for (let t = 0.2; t <= 3; t += 0.2) stepAmbient(st, t, { rhythm: "triple", active: true });
  for (let t = 3.2; t <= 60; t += 0.5) {
    assert.equal(stepAmbient(st, t, { rhythm: "triple", active: false }), null, "脱手期不发也不积压");
  }
  const refired = stepAmbient(st, 61, { rhythm: "triple", active: true });
  assert.equal(refired, null, "重扶先重新布防（不从旧 nextAt 补发）");
  assert.ok(stepAmbient(st, 61 + 9, { rhythm: "triple", active: true }), "重扶后等满新间隔才发拍");

  const switched = createDisturbState(midRng);
  stepAmbient(switched, 0, { rhythm: "breath", active: true }); // 布防 breath：7s
  stepAmbient(switched, 2, { rhythm: "triple", active: true }); // 换节奏：重排为 triple：2+9s
  assert.equal(stepAmbient(switched, 6.9, { rhythm: "triple", active: true }), null, "旧布防（7s）已作废");
  const f = stepAmbient(switched, 11, { rhythm: "triple", active: true });
  assert.deepEqual(f?.pattern, [6, 380, 6, 380, 6], "换节奏后按新节奏发拍");
});

test("落定扰动判定：常态爆发+骤暗；减弱动效降级为只骤暗（无晃无闪）", () => {
  assert.deepEqual(settlePlan({ reduced: false }), { burst: true, dip: true });
  assert.deepEqual(settlePlan({ reduced: true }), { burst: false, dip: true }, "reduced：只余烛光短暗");
});

function pick(obj, keys) {
  return Object.fromEntries(keys.map((k) => [k, obj[k]]));
}
