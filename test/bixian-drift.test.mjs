import test from "node:test";
import assert from "node:assert/strict";
import {
  PAPER, DEFAULT_PARAMS, PERSONALITIES, paramsFor, pickPersonality, createRng,
  createDriftState, summon, ask, sendOff, resumeForSendoff, step, slippedLoose,
} from "../src/lib/bixian-drift.js";
import { MOOD_OVERLAYS, paramsWithMood } from "../src/lib/bixian-responder.js";
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
  assert.ok(t < WINDOWS.steady[0], `自定义快包落定应明显快于沉稳窗下界（实测 ${t}s）`);
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
// spec 锚点（压表后）：一问全程 沉稳≈7.6s / 急躁≈5.6s / 飘忽≈8.8s
// 4 种子 × 6 目标实测 7.00–8.25 / 4.80–5.87 / 8.20–9.30；窗留一成余量，且三档不同窗（快慢仍可辨）。
// 飘忽的上界定在 10.0s（而非均值上的一成）：README 对玩家许诺的「一问最坏不过 10s」由它守着——
// 更宽的 400 种子 × 6 目标实测最坏 9.62s（含怒），也在这个界内。
const MATRIX_TARGETS = ["勾", "是", "三", "八", "十", "唐"]; // 覆盖顶边、左右列、底边
const WINDOWS = { steady: [6, 9.5], hasty: [4.2, 7], erratic: [7.8, 10] };
const ANCHOR = { steady: 7.6, hasty: 5.6, erratic: 8.8 };
// 长尾种子组：专挑「收不住」的极端轨迹（与 bixian-mood 同一起点 1000+i×977，此处只取前 20 个）；回位停留式的守界用例用它
const TAIL_SEEDS = Array.from({ length: 20 }, (_, i) => 1000 + i * 977);
// 笔势轴（#7）：笔势只叠扰动、不换性格，故三档共用同一套耗时窗。笔势的定义在 bixian-responder，
// 此处验它与引擎的合成——「怒叠在飘忽上」（噪声最猛的一组）是否仍在窗内，此前从未验过。
const MOOD_NAMES = { calm: "静", restless: "躁", furious: "怒" };

for (const id of Object.keys(PERSONALITIES)) {
  for (const mood of Object.keys(MOOD_OVERLAYS)) {
    test(`落定矩阵（${PERSONALITIES[id].name}×${MOOD_NAMES[mood]}）：全部组合落定、答案正确、耗时在窗内`, () => {
      const params = paramsWithMood(id, mood);
      const times = [];
      for (const key of MATRIX_TARGETS) {
        for (const seed of SEEDS) {
          const state = makeReady(id, seed);
          ask(state, cellByKey(key));
          const t = runToSettled(state, params, 20);
          assert.ok(t !== null, `${id}×${mood}×${key}×seed${seed}：20s 内未落定`);
          assert.equal(state.answer.type, "cell");
          assert.equal(state.answer.key, key, `应落在目标字上，实际 ${state.answer.key}`);
          times.push(t);
        }
      }
      const [lo, hi] = WINDOWS[id];
      for (const t of times) assert.ok(t >= lo && t <= hi, `${id}×${mood} 落定耗时 ${t}s 应在窗 [${lo}, ${hi}]s 内`);
      const med = median(times);
      assert.ok(Math.abs(med - ANCHOR[id]) <= 2, `${id}×${mood} 中位耗时 ${med}s 应接近规格锚点 ${ANCHOR[id]}s`);
    });
  }
}

// ============ 漂移性格：每局择一、全程不变（#7） ============
test("pickPersonality：种子化确定、覆盖三档、分布不退化", () => {
  const ids = Object.keys(PERSONALITIES);
  const draws = [];
  for (let i = 0; i < 300; i += 1) draws.push(pickPersonality(createRng(9000 + i)));
  assert.ok(draws.every((id) => ids.includes(id)), "只出已知的档");
  assert.deepEqual([...new Set(draws)].sort(), [...ids].sort(), `应覆盖三档（实测 ${[...new Set(draws)].join(" / ")}）`);
  assert.equal(pickPersonality(createRng(SEEDS[2])), pickPersonality(createRng(SEEDS[2])), "同种子同档");
  for (const id of ids) {
    const share = draws.filter((draw) => draw === id).length / draws.length;
    assert.ok(share > 0.2 && share < 0.47, `${id} 占比 ${share.toFixed(2)} 应接近均匀（防恒定一档的退化）`);
  }
  // 注入的 RNG 若碰到 1（或逾界）不能让抽签落空：undefined 会被 createDriftState 静默吃成默认档，
  // 一路顺到下一问才在 paramsWithMood 里抛错——那时已在一局当中了
  assert.equal(pickPersonality(() => 1), ids[ids.length - 1], "rng()===1 取末档（不越界成 undefined）");
  assert.equal(pickPersonality(() => 1.5), ids[ids.length - 1], "rng() 逾界取末档");
  assert.equal(pickPersonality(() => -0.2), ids[0], "rng() 为负取首档");
});

test("性格全程不变：一局（请仙→问→落定→送仙→回位）不换性格，只在新引擎里重新择档", () => {
  for (const id of Object.keys(PERSONALITIES)) {
    const state = makeReady(id, SEEDS[0]);
    assert.equal(state.personality, id, "择定的性格随当局引擎落座");
    ask(state, cellByKey("是"));
    assert.ok(runToSettled(state, paramsFor(id), 20) !== null);
    assert.equal(state.personality, id, "问询全程不换性格");
    sendOff(state);
    advance(state, paramsFor(id), 12, { holding: true });
    assert.equal(state.phase, "returned");
    assert.equal(state.personality, id, "送仙回位后仍不换（重开新局才重新择档）");
  }
});

// ============ 收势锁：末段减速螺旋 ============
test("收势存在：落定末段笔在减速（末段速度显著低于渐近速度峰值）", () => {
  const params = paramsFor("steady");
  const state = makeReady("steady", SEEDS[0]);
  ask(state, cellByKey("是"));
  // 取窗自锚定，不写死秒数（时间表随性格与版本而变，写死的秒数一压表就失效）：
  // 峰值取整个 asking 段，末段取「落定前最后半秒」。落定后笔被泊住（vel 归零），
  // 故只收 asking 帧——混进 settled 帧会把末段均值稀释成假象
  const speeds = [];
  advance(state, params, 12, { holding: true }, (frames, s) => {
    if (s.phase === "asking") speeds.push({ t: frames * DT, speed: Math.hypot(s.vel.x, s.vel.y) });
  });
  assert.equal(state.phase, "settled", "本用例的夹具应能落定");
  assert.ok(speeds.length > 120, `asking 段应有足够帧数（实测 ${speeds.length}）`);
  const lateFrom = speeds[speeds.length - 1].t - 0.5;
  const early = speeds.filter((row) => row.t <= lateFrom);
  const late = speeds.filter((row) => row.t > lateFrom);
  assert.ok(early.length > 0 && late.length >= 20, `落定前应有半秒的帧可测（实测 ${late.length}）`);
  const peak = Math.max(...early.map((row) => row.speed));
  const lateMean = late.reduce((sum, row) => sum + row.speed, 0) / late.length;
  assert.ok(lateMean < 0.6 * peak,
    `收势段应显著减速（渐近峰值 ${peak.toFixed(1)} u/s → 落定前 0.5s 均值 ${lateMean.toFixed(1)} u/s）`);
});

test("收势必要：去掉末段减速后，沉稳的落定节奏整体被破坏", () => {
  // 原型实测：整段删除末段速度调制会让笔稳定在命中圈外约 16u 的轨道上永不落定（12/12 失败）。
  // 这里锁弱突变：仅去掉减速（stillTime 拉满，收势强收也随 tail≈1 一并失效），固定种子下节奏
  // 确定性地整体右移——压表后实测 12/12 仍在 45s 内落定（7.0–11.4s），但中位从 7.6s 抬到 10.0s。
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
  assert.ok(med > ANCHOR.steady + 1, `去掉收势减速后中位耗时 ${med.toFixed(1)}s 应明显慢于沉稳锚点 ${ANCHOR.steady}s`);
  assert.ok(times.some((t) => t > WINDOWS.steady[1]),
    `去掉收势减速后应有组合超出沉稳窗 [${WINDOWS.steady[0]}, ${WINDOWS.steady[1]}]s（实测 ${times.map((t) => t.toFixed(1)).join(", ")}s）`);
});

// ============ 蓄势期不提前偏向目标 ============
test("蓄势期不偏靶：warmup 结束前，不同目标的轨迹逐帧完全一致", () => {
  const warmup = DEFAULT_PARAMS.warmup;
  const left = makeReady("steady", SEEDS[0]);
  const right = makeReady("steady", SEEDS[0]);
  ask(left, cellByKey("一")); // 左列远端
  ask(right, cellByKey("十")); // 右列远端
  const params = paramsFor("steady");
  const frames = Math.ceil(warmup / DT) - 1; // 只取严格早于 warmup 结束的帧（末帧 t 理论=warmup，浮点累加可能越界）
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
  advance(state, params, 4, { holding: true }); // 进入渐近早期（bias>0，尚未完成）
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
  const half = params.dwellTime / 2;
  const hit = advanceUntil(state, params, { holding: true }, (s) => s.dwell >= half, 12);
  assert.ok(hit !== null, "12s 内应进入落定驻留累积");
  assert.equal(state.bias, 1, "驻留累积时渐近应已完成");
  const { t: tBefore, dwell: dwellBefore } = state;
  assert.ok(dwellBefore >= half, `驻留应已累积过半（实测 ${dwellBefore.toFixed(2)}s / 需 ${params.dwellTime}s）`);

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
  advance(state, params, 4, { holding: true }); // 进入渐近后脱手
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
test("迷走：无可落定目标时约 7s 进入迷走态并保持笔行（不停、不落定）", () => {
  const params = paramsFor("steady");
  const state = makeReady("steady", SEEDS[0]);
  assert.equal(ask(state, null), true); // 无目标 = 迷走
  assert.equal(state.stray, true);

  let strayedAt = null;
  advance(state, params, 9, { holding: true }, (frames, s) => {
    if (s.phase === "strayed" && strayedAt === null) strayedAt = frames * DT;
  });
  assert.ok(strayedAt !== null, "9s 内应进入迷走态");
  assert.ok(strayedAt >= 6.9 && strayedAt <= 7.2, `迷走判定应约 ${params.strayTime}s（实测 ${strayedAt}s）`);
  assert.equal(state.answer.type, "stray");

  // 迷走不是停笔：笔继续行于纸上（位置持续变化）
  const posBefore = { ...state.pos };
  advance(state, params, 2, { holding: true });
  const moved = Math.hypot(state.pos.x - posBefore.x, state.pos.y - posBefore.y);
  assert.ok(moved > 3, `迷走态应笔行不辍（2s 位移 ${moved}u）`);
  assert.equal(state.phase, "strayed");
});

// ============ 送仙回位 ============
test("送仙：笔回纸心、停稳、距心小于容差，归寂后不再移动", () => {
  const params = paramsFor("steady");
  const state = makeReady("steady", SEEDS[0]);
  ask(state, cellByKey("三"));
  assert.ok(runToSettled(state, params, 20) !== null);

  assert.equal(sendOff(state), true);
  assert.equal(state.phase, "sending");
  let returnedAt = null;
  advance(state, params, 12, { holding: true }, (frames, s) => {
    if (s.phase === "returned" && returnedAt === null) returnedAt = frames * DT;
  });
  assert.ok(returnedAt !== null, "送仙 12s 内应回位");
  assert.ok(distToCenter(state.pos) < 3.5, `回位后距纸心应小于容差 3.5u（实测 ${distToCenter(state.pos)}u）`);

  // 归寂：回位后笔不再动（位置逐位不变）
  const posReturned = { ...state.pos };
  advance(state, params, 2, { holding: true });
  advance(state, params, 2, { holding: false });
  assert.deepEqual(state.pos, posReturned, "returned 后笔应纹丝不动");
});

test("送仙三段是参数：改 sendoffWarm / sendoffApproach，回位时刻随之整体移动", () => {
  // 旧实现把 0.8 / 5.5 / 2.5 写死在 step 里，节奏调不动、测试也覆写不了——这里锁参数真的接线了
  const base = paramsFor("steady");
  const returnAt = (over, seed) => {
    const state = createDriftState({ rng: createRng(seed), personality: "steady" });
    assert.equal(resumeForSendoff(state), true); // 借补行送仙取同一段规程，不必先问一问
    let returnedAt = null;
    advance(state, { ...base, ...over }, 20, { holding: true }, (frames, s) => {
      if (s.phase === "returned" && returnedAt === null) returnedAt = frames * DT;
    });
    assert.ok(returnedAt !== null, `seed${seed}：20s 内应回位`);
    return returnedAt;
  };
  for (const seed of SEEDS.slice(0, 3)) {
    const [quick, normal, slow] = [returnAt({ sendoffApproach: 1.0 }, seed), returnAt({}, seed), returnAt({ sendoffApproach: 6.0 }, seed)];
    assert.ok(slow - quick >= 2.5, `渐近 1.0s→6.0s 应把回位整体推后（实测 ${quick.toFixed(2)} → ${slow.toFixed(2)}s）`);
    assert.ok(normal > quick && normal < slow, `默认 3.0s 应落在两者之间（实测 ${normal.toFixed(2)}s）`);
    // 起手同理：warm +2.0s，回位至少跟着推后 1s（末段强收心会在途中追回一部分）
    const warmSlow = returnAt({ sendoffWarm: base.sendoffWarm + 2 }, seed);
    assert.ok(warmSlow - normal >= 1.0, `起手 +2.0s 应把回位推后（实测 ${normal.toFixed(2)} → ${warmSlow.toFixed(2)}s）`);
  }
});

test("回位是停留式且有界：入圈后至多再等 3s（三趟停留），整程 ≤8s——不再等「恰好慢下来」那一帧", () => {
  // 旧判据是单帧 speed<3u/s：实测最坏那局笔 6.8s 就已在纸心 0.7u，却在心口以 5–15u/s 抖到 13.5s
  // 才碰上一帧够慢的——没有上界。改停留式后：入圈（bias=1 且距心 <3.5u）起累计，满 returnDwellTime
  // 即回位；3s 的上界留给「入圈又被扰动顶出、累积清零重来」的那几帧。
  for (const id of Object.keys(PERSONALITIES)) {
    const params = paramsWithMood(id, "furious"); // 怒＝扰动最猛，回位最难的一组
    for (const seed of TAIL_SEEDS) {
      const state = createDriftState({ rng: createRng(seed), personality: id });
      assert.equal(resumeForSendoff(state), true);
      let entryAt = null, returnedAt = null;
      advance(state, params, 20, { holding: true }, (frames, s) => {
        const t = frames * DT;
        if (entryAt === null && s.bias >= 1 && distToCenter(s.pos) < 3.5) entryAt = t;
        if (s.phase === "returned" && returnedAt === null) returnedAt = t;
      });
      assert.ok(entryAt !== null, `${id}×seed${seed}：应先入纸心圈`);
      assert.ok(returnedAt !== null, `${id}×seed${seed}：20s 内应回位`);
      assert.ok(returnedAt - entryAt <= 3.0,
        `${id}×seed${seed}：入圈后应至多再等 3s（实测 ${(returnedAt - entryAt).toFixed(2)}s；旧判据此值可达 6.7s）`);
      // 8s 是「送仙三段 5.1s + 停留 1.0s」之外还留的余量：400 种子 × 九组实测最坏 7.87s（飘忽×怒），
      // 旧判据在同一批种子上最坏 29.5s——有界本身就是这一轮要买的东西，别把界收得比实测还紧
      assert.ok(returnedAt <= 8.0, `${id}×seed${seed}：整程回位 ${returnedAt.toFixed(1)}s 应 ≤8s（旧判据最坏 29.5s）`);
    }
  }
});

test("回位：停稳的即时快路径仍在——把停留上界拉到无穷，笔照样回位", () => {
  // 停留式是**兜底**而非唯一判据：笔若已停稳（speed<3u/s），当帧即回位，不必等满 returnDwellTime。
  // 把 returnDwellTime 拉到 1e6 便只剩快路径——仍能回位，即证明这一支没有被停留式吞掉。
  // （实测快路径单跑：三档 40 种子下 4.12–9.10s，比停留式慢，故它只是「早停」而非主力。）
  for (const id of Object.keys(PERSONALITIES)) {
    for (const seed of TAIL_SEEDS.slice(0, 12)) {
      const params = { ...paramsFor(id), returnDwellTime: 1e6 };
      const state = createDriftState({ rng: createRng(seed), personality: id });
      assert.equal(resumeForSendoff(state), true);
      const frames = advanceUntil(state, params, { holding: true }, (s) => s.phase === "returned", 12);
      assert.ok(frames !== null, `${id}×seed${seed}：无停留兜底时应靠停稳快路径回位`);
    }
  }
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
    advance(state, paramsFor("steady"), 12, { holding: true }, (frames, s) => {
      if (s.phase === "returned" && returnedAt === null) returnedAt = frames * DT;
    });
    assert.ok(returnedAt !== null, "扶笔相送 12s 内应回位");
    assert.ok(distToCenter(state.pos) < 3.5, `回位后距纸心应小于容差 3.5u（实测 ${distToCenter(state.pos)}u）`);
  }
});

test("补行送仙：起笔落在**当局性格**的蓄势环上（沉稳 24u / 急躁 20u / 飘忽 27u）", () => {
  for (const id of Object.keys(PERSONALITIES)) {
    const ringR0 = paramsFor(id).ringR0;
    for (const seed of SEEDS) {
      const state = createDriftState({ rng: createRng(seed), personality: id });
      assert.equal(resumeForSendoff(state), true);
      const r = distToCenter(state.pos);
      assert.ok(Math.abs(r - ringR0) < 0.01, `${id}：起笔应在当局蓄势环上（距心 ${r.toFixed(2)}u / 环半径 ${ringR0}u）`);
      assert.ok(state.pos.x > 6 && state.pos.x < PAPER.w - 6 && state.pos.y > 8 && state.pos.y < PAPER.h - 8,
        "起笔须在纸面软边界内");
      if (id !== "steady") {
        // 回归：旧实现写死 DEFAULT_PARAMS.ringR0（=24），急躁偏外 4u、飘忽偏内 3u
        assert.ok(Math.abs(r - DEFAULT_PARAMS.ringR0) > 1, `${id}：起笔不应落在写死的默认环 24u 上`);
      }
    }
  }
});

test("补行送仙的守卫：非 idle 相位一律拒绝（不与正常送仙串道）", () => {
  const state = makeReady("steady", SEEDS[0]);
  assert.equal(resumeForSendoff(state), false, "ready 不可补（那是正常仪式的地界）");
  ask(state, cellByKey("是"));
  assert.equal(resumeForSendoff(state), false, "asking 中不可补");
  assert.ok(runToSettled(state, paramsFor("steady"), 20) !== null);
  assert.equal(resumeForSendoff(state), false, "settled 后走正常 sendOff");
  assert.equal(sendOff(state), true);
  advance(state, paramsFor("steady"), 12, { holding: true });
  assert.equal(state.phase, "returned");
  assert.equal(resumeForSendoff(state), false, "returned 归寂后无事可补");
});

// ============ 固定种子确定性 ============
test("同种子两次完整一问：落定帧、答案与终点笔位逐位一致", () => {
  const run = () => {
    const state = makeReady("erratic", SEEDS[1]); // 飘忽：噪声路径最长，最能暴露随机源泄漏
    ask(state, cellByKey("宋"));
    let settledAt = null;
    advance(state, paramsFor("erratic"), 15, { holding: true }, (frames, s) => {
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
  assert.ok(runToSettled(state, paramsFor("steady"), 20) !== null);
  assert.equal(ask(state, cellByKey("否")), true, "settled 后可再问");
  assert.equal(state.questionCount, 2);
  assert.equal(sendOff(state), true, "asking 中可送仙");
  assert.equal(sendOff(state), false, "sending 中不可重复送仙");
  assert.equal(ask(state, null), false, "sending 中不可问");
});
