import test from "node:test";
import assert from "node:assert/strict";
import {
  PAPER, DEFAULT_PARAMS, PERSONALITIES, paramsFor, createRng,
  createDriftState, summon, ask, sendOff, resumeForSendoff, step, slippedLoose,
} from "../src/lib/bixian-drift.js";
import { CELLS, cellByKey } from "../src/lib/bixian-board.js";

// —— 纸面字位（A 边条式）与 cellByKey 自 bixian-board 库导入：引擎对布局无感知，这里只是落定矩阵的目标夹具。
// 字位若在布局/UI 层调整，下方落定矩阵的耗时窗需连带重新校准（board 库测试已锁定锚点坐标）。

const DT = 1 / 60; // 帧驱动由调用方提供：无头快进用 60fps
const SEEDS = [20260924, 42, 7, 99];

// —— 无头快进工具 ——
function makeReady(personality, seed) {
  const state = createDriftState({ rng: createRng(seed), personality });
  assert.equal(summon(state), true);
  advance(state, paramsFor(personality), 10, { holding: false }); // 口诀 6s 后自入 ready
  assert.equal(state.phase, "ready");
  return state;
}
function advance(state, params, seconds, input, onFrame) {
  const frames = Math.round(seconds / DT);
  for (let i = 0; i < frames; i += 1) {
    step(state, DT, params, input);
    if (onFrame) onFrame(i + 1, state);
  }
  return frames;
}
// 逐帧推进直到条件首次满足，返回所经帧数；超时返回 null
function advanceUntil(state, params, input, pred, maxSeconds) {
  const frames = Math.round(maxSeconds / DT);
  for (let i = 0; i < frames; i += 1) {
    step(state, DT, params, input);
    if (pred(state)) return i + 1;
  }
  return null;
}
// 从 ask 起步、持续扶笔，返回落定所用的扶笔秒数；未落定返回 null
function runToSettled(state, params, maxSeconds) {
  let elapsed = 0;
  let settledAt = null;
  advance(state, params, maxSeconds, { holding: true }, (frames, s) => {
    elapsed = frames * DT;
    if (s.phase === "settled" && settledAt === null) settledAt = elapsed;
  });
  return settledAt;
}
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const distToCenter = (pos) => Math.hypot(pos.x - PAPER.center.x, pos.y - PAPER.center.y);

// ============ 模块形态：五要素参数齐备、命中半径 > 收圈半径 ============
test("引擎参数五要素齐备，且三档性格包命中半径均大于收圈半径", () => {
  // 五要素：低阻尼 / 环行吸引子 / 双向噪声 / 蓄势 / 渐近+收势
  for (const key of ["damping", "ringK", "ringR0", "noiseAmp", "noiseTau", "warmup", "startRamp", "approach", "finalRadius", "stillTime"]) {
    assert.ok(DEFAULT_PARAMS[key] != null, `缺少五要素参数 ${key}`);
  }
  for (const id of Object.keys(PERSONALITIES)) {
    const p = paramsFor(id);
    // 命中半径必须大于收圈半径（末段收圈收到 0.5u），否则笔在命中圈外打转永不落定
    assert.ok(p.settleRadius > p.finalRadius, `${id}: settleRadius ${p.settleRadius} 应大于 finalRadius ${p.finalRadius}`);
    assert.ok(p.settleRadius > 0.5, `${id}: settleRadius 应大于末段收圈半径 0.5`);
    assert.equal(p.settleMode, "dwell", `${id}: 正式版判定为停留式`);
  }
});

test("参数包可整体替换：沉稳即默认，自定义包生效", () => {
  assert.deepEqual(paramsFor("steady"), DEFAULT_PARAMS); // 沉稳 = 基准参数
  const packs = Object.keys(PERSONALITIES).map((id) => paramsFor(id));
  assert.equal(new Set(packs.map((p) => JSON.stringify(p))).size, packs.length); // 三档互不相同
  // 整体替换一个快包：蓄势 1s + 渐近 2s，落定应远快于沉稳窗口下界
  const quick = { ...DEFAULT_PARAMS, warmup: 1, approach: 2 };
  const state = makeReady("steady", SEEDS[0]);
  ask(state, cellByKey("是"));
  const t = runToSettled(state, quick, 30);
  assert.ok(t !== null, "自定义快包应能落定");
  assert.ok(t < 10, `自定义快包落定应明显快于沉稳（实测 ${t}s）`);
});

test("paramsFor 对未知性格 id 显式抛错（不静默回退）", () => {
  assert.throws(() => paramsFor("nope"), /未知漂移性格/);
});

// ============ 请仙 ============
test("请仙：口诀期满笔活，位置只在纸心附近微颤", () => {
  const state = makeReady("steady", SEEDS[0]);
  assert.equal(state.questionCount, 0);
  assert.ok(distToCenter(state.pos) < 2, `请仙后笔应在纸心附近（实测距心 ${distToCenter(state.pos)}u）`);
});

// ============ 落定矩阵：三档性格 × 多目标字 × 多种子 ============
// spec 锚点：一问全程 沉稳≈16s / 急躁≈8s / 飘忽≈23s（原型实测 15.2–16.9 / 7.9–9.1 / 21.8–24.5）
const MATRIX_TARGETS = ["勾", "是", "三", "八", "十", "唐"]; // 覆盖顶边、左右列、底边
const WINDOWS = { steady: [12, 20], hasty: [6, 11], erratic: [18, 28] };
const ANCHOR = { steady: 16, hasty: 8, erratic: 23 };

for (const id of Object.keys(PERSONALITIES)) {
  test(`落定矩阵（${PERSONALITIES[id].name}）：全部组合落定、答案正确、耗时在窗内`, () => {
    const times = [];
    for (const key of MATRIX_TARGETS) {
      for (const seed of SEEDS) {
        const state = makeReady(id, seed);
        ask(state, cellByKey(key));
        const t = runToSettled(state, paramsFor(id), 45);
        assert.ok(t !== null, `${id}×${key}×seed${seed}：45s 内未落定`);
        assert.equal(state.answer.type, "cell");
        assert.equal(state.answer.key, key, `应落在目标字上，实际 ${state.answer.key}`);
        times.push(t);
      }
    }
    const [lo, hi] = WINDOWS[id];
    for (const t of times) assert.ok(t >= lo && t <= hi, `${id} 落定耗时 ${t}s 应在窗 [${lo}, ${hi}]s 内`);
    const med = median(times);
    assert.ok(Math.abs(med - ANCHOR[id]) <= 4, `${id} 中位耗时 ${med}s 应接近规格锚点 ${ANCHOR[id]}s`);
  });
}

// ============ 收势锁：末段减速螺旋 ============
test("收势存在：渐近完成后笔在减速（末段速度显著低于渐近中段）", () => {
  const params = paramsFor("steady");
  const state = makeReady("steady", SEEDS[0]);
  ask(state, cellByKey("是"));
  let midSum = 0, midN = 0, lateSum = 0, lateN = 0;
  advance(state, params, 18, { holding: true }, (frames, s) => {
    const t = frames * DT;
    const speed = Math.hypot(s.vel.x, s.vel.y);
    if (t >= 10 && t <= 11.5) { midSum += speed; midN += 1; }
    if (t >= 15 && t <= 16) { lateSum += speed; lateN += 1; }
  });
  const mid = midSum / midN;
  const late = lateSum / lateN;
  assert.ok(late < 0.6 * mid, `收势段应显著减速（渐近中段 ${mid.toFixed(1)} u/s → 末段 ${late.toFixed(1)} u/s）`);
});

test("收势必要：去掉末段减速后，沉稳的落定节奏整体被破坏", () => {
  // 原型实测：整段删除末段速度调制会让笔稳定在命中圈外约 16u 的轨道上永不落定（12/12 失败）——
  // 那种强突变会直接打红上方落定矩阵（45s 不落定）。这里锁弱突变：仅去掉减速（stillTime 拉满），
  // 固定种子下节奏确定性地整体右移：中位明显变慢，且至少一组超出沉稳窗。
  const noTail = { ...paramsFor("steady"), stillTime: 1e6 };
  const times = [];
  for (const key of MATRIX_TARGETS) {
    for (const seed of SEEDS.slice(0, 2)) {
      const state = makeReady("steady", seed);
      ask(state, cellByKey(key));
      const t = runToSettled(state, noTail, 45);
      assert.ok(t !== null, "弱突变下仍会落定（若不落定，突变已强于本测试假设，矩阵会另行打红）");
      times.push(t);
    }
  }
  const med = median(times);
  assert.ok(med > 17.5, `去掉收势减速后中位耗时 ${med.toFixed(1)}s 应明显慢于沉稳节奏（默认约 16.2s）`);
  assert.ok(times.some((t) => t > WINDOWS.steady[1]),
    `去掉收势减速后应有组合超出沉稳窗 [12, 20]s（实测 ${times.map((t) => t.toFixed(1)).join(", ")}s）`);
});

// ============ 蓄势期不提前偏向目标 ============
test("蓄势期不偏靶：warmup 结束前，不同目标的轨迹逐帧完全一致", () => {
  const warmup = DEFAULT_PARAMS.warmup;
  const left = makeReady("steady", SEEDS[0]);
  const right = makeReady("steady", SEEDS[0]);
  ask(left, cellByKey("一")); // 左列远端
  ask(right, cellByKey("十")); // 右列远端
  const params = paramsFor("steady");
  const frames = Math.ceil(warmup / DT) - 1; // 只取严格早于 warmup 结束的帧（末帧 t 理论=6.0，浮点累加可能越界）
  for (let i = 0; i < frames; i += 1) {
    step(left, DT, params, { holding: true });
    step(right, DT, params, { holding: true });
    assert.equal(left.bias, 0, `第 ${i + 1} 帧蓄势期内 bias 应为 0`);
    assert.deepEqual(left.pos, right.pos, `第 ${i + 1} 帧两个目标的笔位应完全一致（目标未影响轨迹）`);
  }
});

// ============ 脱手冻结 / 重扶继续 ============
test("脱手：蓄势/渐近计时全部冻结、笔停驻微抖；重扶从停点无缝继续并落定", () => {
  const params = paramsFor("steady");
  const state = makeReady("steady", SEEDS[0]);
  ask(state, cellByKey("三"));
  advance(state, params, 7, { holding: true }); // 进入渐近早期
  const { t: tBefore, bias: biasBefore, dwell: dwellBefore } = state;
  assert.ok(biasBefore > 0, "已进入渐近（bias > 0）");

  // 脱手 10s：计时冻结（脱手不能刷进度）、笔近乎停驻只剩微抖
  advance(state, params, 10, { holding: false });
  assert.equal(state.t, tBefore, "脱手期间 asking 计时 t 应冻结");
  assert.equal(state.bias, biasBefore, "脱手期间渐近进度 bias 应冻结");
  assert.equal(state.dwell, dwellBefore, "脱手期间落定驻留 dwell 应冻结");
  assert.ok(Math.hypot(state.vel.x, state.vel.y) < 0.1, "脱手后笔应近乎停驻");
  const drift = Math.hypot(state.pos.x - PAPER.center.x, state.pos.y - PAPER.center.y);
  assert.ok(drift < 60, "脱手微抖不应把笔带走（仍在纸面活动区）");

  // 重扶：不重置、从停点无缝继续，按沉稳节奏落定
  const heldAfterRelease = runToSettled(state, params, 30);
  assert.ok(heldAfterRelease !== null, "重扶后应能落定");
  const activeTotal = tBefore + heldAfterRelease; // 冻结的 10s 不计入仪式进度
  const [lo, hi] = WINDOWS.steady;
  assert.ok(activeTotal >= lo && activeTotal <= hi, `重扶后的有效耗时 ${activeTotal}s 应仍在沉稳窗 [${lo}, ${hi}]s 内`);
  assert.equal(state.answer.key, "三");
});

test("脱手不能刷落定进度：驻留累积中脱手，dwell 计时冻结，重扶续满落定", () => {
  const params = paramsFor("steady");
  const state = makeReady("steady", SEEDS[0]);
  ask(state, cellByKey("三"));
  // 推进到收势驻留期：渐近已完成（bias=1）且落定驻留已累积过半（未到 dwellTime，尚未落定）
  const hit = advanceUntil(state, params, { holding: true }, (s) => s.dwell >= 0.6, 25);
  assert.ok(hit !== null, "25s 内应进入落定驻留累积");
  assert.equal(state.bias, 1, "驻留累积时渐近应已完成");
  const { t: tBefore, dwell: dwellBefore } = state;
  assert.ok(dwellBefore >= 0.6, `驻留应已累积过半（实测 ${dwellBefore.toFixed(2)}s / 需 ${params.dwellTime}s）`);

  // 脱手 5s：落定驻留计时冻结、笔停驻
  advance(state, params, 5, { holding: false });
  assert.equal(state.t, tBefore, "脱手期间 asking 计时应冻结");
  assert.equal(state.dwell, dwellBefore, "脱手期间落定驻留 dwell 应冻结");
  assert.ok(Math.hypot(state.vel.x, state.vel.y) < 0.1, "脱手后笔应近乎停驻");
  assert.equal(state.phase, "asking", "脱手期间不应自行落定");

  // 重扶：续满剩余驻留即落定
  const rest = runToSettled(state, params, 10);
  assert.ok(rest !== null, "重扶后应续满驻留并落定");
  assert.ok(rest <= 5, `重扶后只需补满剩余驻留（实测再扶 ${rest.toFixed(1)}s）`);
  assert.equal(state.answer.key, "三");
});

test("松手微抖：幅度参数定在 0.2–0.3u，脱手期笔仍可见地颤", () => {
  assert.ok(DEFAULT_PARAMS.releaseJitterAmp >= 0.2 && DEFAULT_PARAMS.releaseJitterAmp <= 0.3,
    `松手微抖幅度应定在 0.2–0.3u（实测 ${DEFAULT_PARAMS.releaseJitterAmp}u）`);
  const params = paramsFor("steady");
  const state = makeReady("steady", SEEDS[0]);
  ask(state, cellByKey("是"));
  advance(state, params, 7, { holding: true }); // 进入渐近后脱手
  let prev = { ...state.pos };
  let path = 0;
  advance(state, params, 10, { holding: false }, (frames, s) => {
    if (frames > 120) path += Math.abs(s.pos.x - prev.x) + Math.abs(s.pos.y - prev.y); // 前 2s 让余速衰减干净
    prev = { x: s.pos.x, y: s.pos.y };
  });
  // 8s 累计颤动路径：0.25u 幅度约 24u；原型旧值 0.09u 仅约 9u（几乎不可见）——下界用于排除旧值回退
  assert.ok(path >= 15 && path <= 30, `脱手期 8s 颤动路径 ${path.toFixed(1)}u 应可见但不夸张`);
});

// ============ 严格扶笔 ============
test("严格脱手判定：指尖距笔逾 strictRadius（默认 15u）即脱手，恰在半径上不脱", () => {
  const pen = { x: 50, y: 80 };
  assert.equal(slippedLoose(pen, { x: 50 + 14.9, y: 80 }), false, "半径内：仍算扶着");
  assert.equal(slippedLoose(pen, { x: 50 + 15, y: 80 }), false, "恰在 15u：不脱（须「超过」才脱）");
  assert.equal(slippedLoose(pen, { x: 50, y: 80 - 15.1 }), true, "超过 15u：脱手");
  assert.equal(slippedLoose(pen, null), false, "无指针（宽松式/未跟踪）：不判脱手");
  assert.equal(DEFAULT_PARAMS.strictRadius, 15, "严格判定半径默认 15u（原型标定）");
  assert.equal(slippedLoose(pen, { x: 50 + 40, y: 80 }, 60), false, "半径可由参数包覆写（如无障碍放宽）");
});

// ============ 迷走 ============
test("迷走：无可落定目标时约 12s 进入迷走态并保持乱画", () => {
  const params = paramsFor("steady");
  const state = makeReady("steady", SEEDS[0]);
  assert.equal(ask(state, null), true); // 无目标 = 迷走
  assert.equal(state.stray, true);

  let strayedAt = null;
  advance(state, params, 14, { holding: true }, (frames, s) => {
    if (s.phase === "strayed" && strayedAt === null) strayedAt = frames * DT;
  });
  assert.ok(strayedAt !== null, "14s 内应进入迷走态");
  assert.ok(strayedAt >= 11.9 && strayedAt <= 12.2, `迷走判定应约 12s（实测 ${strayedAt}s）`);
  assert.equal(state.answer.type, "stray");

  // 迷走不是停笔：继续保持乱画（位置持续变化）
  const posBefore = { ...state.pos };
  advance(state, params, 2, { holding: true });
  const moved = Math.hypot(state.pos.x - posBefore.x, state.pos.y - posBefore.y);
  assert.ok(moved > 3, `迷走态应持续乱画（2s 位移 ${moved}u）`);
  assert.equal(state.phase, "strayed");
});

// ============ 送仙回位 ============
test("送仙：笔回纸心、停稳、距心小于容差，归寂后不再移动", () => {
  const params = paramsFor("steady");
  const state = makeReady("steady", SEEDS[0]);
  ask(state, cellByKey("三"));
  assert.ok(runToSettled(state, params, 30) !== null);

  assert.equal(sendOff(state), true);
  assert.equal(state.phase, "sending");
  let returnedAt = null;
  advance(state, params, 25, { holding: true }, (frames, s) => {
    if (s.phase === "returned" && returnedAt === null) returnedAt = frames * DT;
  });
  assert.ok(returnedAt !== null, "送仙 25s 内应回位");
  assert.ok(distToCenter(state.pos) < 3.5, `回位后距纸心应小于容差 3.5u（实测 ${distToCenter(state.pos)}u）`);

  // 归寂：回位后笔不再动（位置逐位不变）
  const posReturned = { ...state.pos };
  advance(state, params, 2, { holding: true });
  advance(state, params, 2, { holding: false });
  assert.deepEqual(state.pos, posReturned, "returned 后笔应纹丝不动");
});

// ============ 补行送仙（仙未离去的补起） ============
test("补行送仙：仅 idle 可补，起笔落在蓄势环上、径直送回纸心", () => {
  for (const seed of SEEDS) {
    const state = createDriftState({ rng: createRng(seed), personality: "steady" });
    assert.equal(state.phase, "idle");
    assert.equal(resumeForSendoff(state), true, "新页补礼：仙本就在，无需再请");
    assert.equal(state.phase, "sending");
    const r = distToCenter(state.pos);
    assert.ok(r > DEFAULT_PARAMS.ringR0 * 0.8 && r < DEFAULT_PARAMS.ringR0 * 1.2,
      `起笔应在蓄势环一带（距心 ${r.toFixed(1)}u / 环半径 ${DEFAULT_PARAMS.ringR0}u）`);
    assert.ok(state.pos.x > 6 && state.pos.x < PAPER.w - 6 && state.pos.y > 8 && state.pos.y < PAPER.h - 8,
      "起笔须在纸面软边界内");

    let returnedAt = null;
    advance(state, paramsFor("steady"), 25, { holding: true }, (frames, s) => {
      if (s.phase === "returned" && returnedAt === null) returnedAt = frames * DT;
    });
    assert.ok(returnedAt !== null, "扶笔相送 25s 内应回位");
    assert.ok(distToCenter(state.pos) < 3.5, `回位后距纸心应小于容差 3.5u（实测 ${distToCenter(state.pos)}u）`);
  }
});

test("补行送仙的守卫：非 idle 相位一律拒绝（不与正常送仙串道）", () => {
  const state = makeReady("steady", SEEDS[0]);
  assert.equal(resumeForSendoff(state), false, "ready 不可补（那是正常仪式的地界）");
  ask(state, cellByKey("是"));
  assert.equal(resumeForSendoff(state), false, "asking 中不可补");
  assert.ok(runToSettled(state, paramsFor("steady"), 30) !== null);
  assert.equal(resumeForSendoff(state), false, "settled 后走正常 sendOff");
  assert.equal(sendOff(state), true);
  advance(state, paramsFor("steady"), 25, { holding: true });
  assert.equal(state.phase, "returned");
  assert.equal(resumeForSendoff(state), false, "returned 归寂后无事可补");
});

// ============ 固定种子确定性 ============
test("同种子两次完整一问：落定帧、答案与终点笔位逐位一致", () => {
  const run = () => {
    const state = makeReady("erratic", SEEDS[1]); // 飘忽：噪声路径最长，最能暴露随机源泄漏
    ask(state, cellByKey("宋"));
    let settledAt = null;
    advance(state, paramsFor("erratic"), 40, { holding: true }, (frames, s) => {
      if (s.phase === "settled" && settledAt === null) settledAt = frames * DT;
    });
    return { settledAt, answer: state.answer, pos: { ...state.pos }, events: state.events.map((e) => e.msg) };
  };
  assert.deepEqual(run(), run());
});

// ============ 状态机守卫 ============
test("仪式状态机：各指令只在接受的相位生效", () => {
  const state = createDriftState({ rng: createRng(1), personality: "steady" });
  assert.equal(state.phase, "idle");
  assert.equal(ask(state, cellByKey("是")), false, "idle 不可直接问");
  assert.equal(sendOff(state), false, "idle 不可送仙");

  assert.equal(summon(state), true);
  assert.equal(summon(state), false, "summoning 中不可重复请仙");
  assert.equal(ask(state, cellByKey("是")), false, "summoning 中不可问");
  assert.equal(sendOff(state), false, "summoning 中不可送仙");

  advance(state, paramsFor("steady"), 10, { holding: false });
  assert.equal(state.phase, "ready");
  assert.equal(ask(state, cellByKey("是")), true);
  assert.equal(state.questionCount, 1);
  assert.ok(runToSettled(state, paramsFor("steady"), 30) !== null);
  assert.equal(ask(state, cellByKey("否")), true, "settled 后可再问");
  assert.equal(state.questionCount, 2);
  assert.equal(sendOff(state), true, "asking 中可送仙");
  assert.equal(sendOff(state), false, "sending 中不可重复送仙");
  assert.equal(ask(state, null), false, "sending 中不可问");
});
