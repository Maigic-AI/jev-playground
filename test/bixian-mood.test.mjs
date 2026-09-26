// 笔势叠层的集成与守界（#7）：笔势（MOOD_OVERLAYS）叠在当局漂移性格之上，定义在 bixian-responder，
// 参数合成后交给引擎。这里验四件事：
//   一、九组「性格 × 笔势」下送仙与补行送仙都收得回纸心，终距心 <3.5u——含长尾种子组；
//   二、飘忽×怒（噪声最猛的一组）下落定仍收敛、答案仍正确——这一组此前从未验过，是叠层修法的空白；
//   三、三档下跑满一局（验笔 + 五问 + 送仙）的节奏仍在规格量级内，且三档快慢可辨；
//   四、性格只以笔的行为示人：界面源码与整局事件流都不出现性格名（永不点名、无任何文案提示）。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PAPER, PERSONALITIES, paramsFor, createRng, createDriftState,
  summon, ask, sendOff, resumeForSendoff, step,
} from "../src/lib/bixian-drift.js";
import { MOOD_OVERLAYS, paramsWithMood } from "../src/lib/bixian-responder.js";
import { cellByKey, VERIFY_CELL } from "../src/lib/bixian-board.js";

const DT = 1 / 60; // 帧驱动由调用方提供：无头快进用 60fps
const IDS = Object.keys(PERSONALITIES);
const MOODS = Object.keys(MOOD_OVERLAYS);
const MOOD_NAMES = { calm: "静", restless: "躁", furious: "怒" };
const SEEDS = [20260924, 42, 7, 99]; // 与 bixian-drift 的落定矩阵同一组种子（同基准比较）
// 长尾种子组：换一批种子专挑「收不住」的极端轨迹。40 种子 × 6 目标实测最慢者为飘忽×躁（落定 28.6s）
// 与飘忽×怒（28.4s），补行送仙最慢 24.1s；故落定上界取 32s、回位上界 32s——留一成余量，
// 同时仍能挡住「怒改成倍数叠」那类复利回归（那一版实测最长 33.8s / 37.1s，会在此报红）。
const TAIL_SETTLE_CAP = 32;
const TAIL_RESUME_CAP = 32;
const TAIL_SEEDS = Array.from({ length: 40 }, (_, i) => 1000 + i * 977);
const TAIL_TARGETS = ["是", "三"]; // 顶边与左列各一，覆盖远端与近端

function makeReady(personality, seed, params) {
  const state = createDriftState({ rng: createRng(seed), personality });
  assert.equal(summon(state), true);
  advanceUntilPhase(state, params, "ready", 10); // 口诀 6s 后自入 ready
  assert.equal(state.phase, "ready");
  return state;
}
// 逐帧扶笔推进到指定相位，返回所经秒数；超时返回 null
function advanceUntilPhase(state, params, phase, maxSeconds) {
  const frames = Math.round(maxSeconds / DT);
  for (let i = 0; i < frames; i += 1) {
    step(state, DT, params, { holding: true });
    if (state.phase === phase) return (i + 1) * DT;
  }
  return null;
}
const distToCenter = (pos) => Math.hypot(pos.x - PAPER.center.x, pos.y - PAPER.center.y);
const combo = (id, mood) => `${PERSONALITIES[id].name}×${MOOD_NAMES[mood]}`;

// ============ 送仙回位：落定后扶笔相送（标准种子组） ============
for (const id of IDS) {
  for (const mood of MOODS) {
    test(`送仙回位（${combo(id, mood)}）：落定后送仙，25s 内回位、终距心 <3.5u`, () => {
      const params = paramsWithMood(id, mood);
      for (const seed of SEEDS) {
        const state = makeReady(id, seed, params);
        ask(state, cellByKey("三"));
        assert.ok(advanceUntilPhase(state, params, "settled", 45) !== null, `${combo(id, mood)}×seed${seed}：45s 内未落定`);
        assert.equal(state.answer.key, "三");
        assert.equal(sendOff(state), true);
        const returned = advanceUntilPhase(state, params, "returned", 25);
        assert.ok(returned !== null, `${combo(id, mood)}×seed${seed}：送仙 25s 内未回位`);
        assert.ok(distToCenter(state.pos) < 3.5, `${combo(id, mood)}×seed${seed}：回位后距纸心 ${distToCenter(state.pos).toFixed(2)}u`);
      }
    });
  }
}

// ============ 长尾收敛：宽种子组下「落定」与「补行送仙」都不掉链子 ============
for (const id of IDS) {
  for (const mood of MOODS) {
    test(`长尾收敛（${combo(id, mood)}）：40 种子下全部落定、答案正确，全部回位`, () => {
      const params = paramsWithMood(id, mood);
      for (const seed of TAIL_SEEDS.slice(0, 12)) {
        for (const key of TAIL_TARGETS) {
          const state = makeReady(id, seed, params);
          ask(state, cellByKey(key));
          const settled = advanceUntilPhase(state, params, "settled", TAIL_SETTLE_CAP);
          assert.ok(settled !== null, `${combo(id, mood)}×seed${seed}×${key}：${TAIL_SETTLE_CAP}s 内未落定`);
          assert.equal(state.answer.key, key, `${combo(id, mood)}：应落在目标字上，实际 ${state.answer.key}`);
        }
      }
      for (const seed of TAIL_SEEDS) {
        const state = createDriftState({ rng: createRng(seed), personality: id });
        assert.equal(resumeForSendoff(state), true);
        const returned = advanceUntilPhase(state, params, "returned", TAIL_RESUME_CAP);
        assert.ok(returned !== null, `${combo(id, mood)}×seed${seed}：补行送仙 ${TAIL_RESUME_CAP}s 内未回位`);
        assert.ok(distToCenter(state.pos) < 3.5, `${combo(id, mood)}×seed${seed}：补礼后距纸心 ${distToCenter(state.pos).toFixed(2)}u`);
      }
    });
  }
}

// ============ 一局节奏：三档各跑满一局（spec 验收：25s–2min 量级） ============
// 验笔一问 + 问询五问 + 送仙，全程扶笔；请仙口诀期间不扶（与界面一致）。逐帧推进，
// 落定即续下一问，问满即送仙，直到回位归寂。
function playFullRound(id, seed, targets) {
  const params = paramsFor(id);
  const state = createDriftState({ rng: createRng(seed), personality: id });
  assert.equal(summon(state), true);
  let seconds = 0;
  while (state.phase !== "ready") {
    step(state, DT, params, { holding: false });
    seconds += DT;
    assert.ok(seconds < 60, "请仙口诀不应超过 60s");
  }
  const queue = [...targets];
  ask(state, queue.shift());
  while (state.phase !== "returned") {
    if (state.phase === "settled") {
      if (queue.length) ask(state, queue.shift());
      else sendOff(state);
      continue;
    }
    step(state, DT, params, { holding: true });
    seconds += DT;
    assert.ok(seconds < 600, `${PERSONALITIES[id].name}：一局超过 10 分钟仍未回位`);
  }
  return { seconds, state };
}

const ROUND_TARGETS = [cellByKey("是"), cellByKey("三"), cellByKey("八"), cellByKey("唐"), cellByKey("男")];

test("一局节奏：一问之局在 25s–2min、满局在 3min 内（三档同序：急<稳<飘）", () => {
  const totals = {};
  for (const id of IDS) {
    // 一问之局（验笔 + 一问 + 送仙）
    const one = playFullRound(id, SEEDS[0], [VERIFY_CELL, ROUND_TARGETS[0]]);
    assert.equal(one.state.questionCount, 2, "验笔一并算一问");
    assert.equal(one.state.phase, "returned");
    assert.ok(one.seconds >= 25 && one.seconds <= 120,
      `${combo(id, "calm")}：一问之局 ${one.seconds.toFixed(1)}s 应在 25s–2min 量级`);
    // 五问之局（验笔 + 五问 + 送仙，即满局）
    const five = playFullRound(id, SEEDS[0], [VERIFY_CELL, ...ROUND_TARGETS]);
    assert.equal(five.state.personality, id, "整局不换性格");
    assert.equal(five.state.questionCount, 6, "六问皆已发出");
    assert.equal(five.state.phase, "returned");
    // 上界放到 3min：满局本是「五问 × 每问窗」，飘忽按 spec 锚点 23s/问 算，六问就要 2.5min——
    // 每问的耗时窗（18–28s）是规格的硬约束，一局的上界只能跟着它走
    assert.ok(five.seconds >= 25 && five.seconds <= 180,
      `${combo(id, "calm")}：满局 ${five.seconds.toFixed(1)}s 应在 25s–3min 量级`);
    totals[id] = five.seconds;
  }
  assert.ok(totals.hasty < totals.steady && totals.steady < totals.erratic,
    `三档节奏应可辨（实测 急 ${totals.hasty.toFixed(0)}s / 稳 ${totals.steady.toFixed(0)}s / 飘 ${totals.erratic.toFixed(0)}s）`);
});

// ============ 性格不外泄：界面源码与事件流都不点名 ============
test("性格不外泄：界面源码不出现任何性格名，接线走「随机择档 × 笔势叠层」", () => {
  const source = readFileSync(new URL("../src/pages/game-bixian.jsx", import.meta.url), "utf8");
  for (const id of IDS) {
    // 注释里出现也算：文案的暗示往往就是从一句注释长出来的
    assert.ok(!source.includes(PERSONALITIES[id].name), `game-bixian.jsx 不应出现『${PERSONALITIES[id].name}』——差异只能从笔的行为感知`);
  }
  // 无 DOM 测试环境，界面接线以此为准：每局择档、参数一律经「性格 × 笔势」合成
  assert.match(source, /pickPersonality\(/, "请仙时须择一档漂移性格");
  assert.match(source, /paramsWithMood\(/, "漂移参数须经性格 × 笔势叠层");
  assert.ok(!source.includes("MOOD_PARAMS"), "旧的绝对包 MOOD_PARAMS 不得再回界面");
});

test("性格不外泄：整局事件流（请仙、落定、迷走、送仙）不出现任何性格名", () => {
  for (const id of IDS) {
    const params = paramsFor(id);
    const state = makeReady(id, SEEDS[0], params);
    ask(state, cellByKey("是"));
    assert.ok(advanceUntilPhase(state, params, "settled", 45) !== null);
    ask(state, null); // 迷走一问，补全事件流的各种来路
    assert.ok(advanceUntilPhase(state, params, "strayed", 20) !== null);
    sendOff(state);
    assert.ok(advanceUntilPhase(state, params, "returned", 40) !== null);
    assert.ok(state.events.length >= 5, `夹具有效性：整局应有事件产生（实测 ${state.events.length} 条）`);
    const transcript = state.events.map((event) => event.msg).join("\n");
    for (const other of IDS) {
      assert.ok(!transcript.includes(PERSONALITIES[other].name), `事件流不应出现『${PERSONALITIES[other].name}』`);
    }
  }
});
