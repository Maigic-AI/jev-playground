import test from "node:test";
import assert from "node:assert/strict";
import {
  HUMAN, MOVES, buildRpsPayload, decodeSeat, judge, normalizeProbabilities, pickMove,
  randomMove, runRpsRound, summarizeWindow, configById,
} from "../src/lib/rps.js";
import { emptyStats, readRpsStats, recordRoundHuman, recordRoundSim, resetRpsStats } from "../src/lib/rps-stats.js";

// 可注入的伪 localStorage
function fakeStorage(initial = {}) {
  const store = { ...initial };
  return {
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, value) => { store[key] = String(value); },
    removeItem: (key) => { delete store[key]; },
    dump: () => store,
  };
}

const history = [
  { round: 1, moves: { you: "paper", jev: "rock" }, result: "you" },
  { round: 2, moves: { you: "rock", jev: "rock" }, result: "draw" },
  { round: 3, moves: { you: "scissors", jev: "rock" }, result: "jev" },
  { round: 4, moves: { you: "rock", jev: "paper" }, result: "jev" },
  { round: 5, moves: { you: "scissors", jev: "paper" }, result: "you" },
  { round: 6, moves: { you: "paper", jev: "paper" }, result: "draw" },
];

test("judge 覆盖全部 9 种组合且对称", () => {
  const table = [
    ["rock", "rock", "draw"], ["rock", "paper", "lose"], ["rock", "scissors", "win"],
    ["paper", "rock", "win"], ["paper", "paper", "draw"], ["paper", "scissors", "lose"],
    ["scissors", "rock", "lose"], ["scissors", "paper", "win"], ["scissors", "scissors", "draw"],
  ];
  for (const [a, b, expected] of table) {
    assert.equal(judge(a, b), expected, `${a} vs ${b}`);
    if (expected !== "draw") assert.equal(judge(b, a), expected === "win" ? "lose" : "win", `${b} vs ${a}`);
  }
});

test("summarizeWindow 正确计数、截窗并计算事实", () => {
  // 最近 3 回合（R4–R6）you 出 rock / scissors / paper
  const summary = summarizeWindow(history, "you", 3);
  assert.deepEqual(summary.counts, { rock: 1, paper: 1, scissors: 1 });
  assert.equal(summary.rates.paper, 1 / 3);
  assert.equal(summary.facts.mostFrequent, "rock"); // 并列时取 MOVES 顺序首个
  assert.equal(summary.facts.repeatStreak, 1); // 最后一掷 paper
  // 窗口内 you 在第 4 回合失利，第 5 回合换了招；第 5 回合获胜不计
  assert.deepEqual(summary.facts.switchAfterLoss, { stayed: 0, switched: 1 });

  const full = summarizeWindow(history, "jev", 6);
  assert.deepEqual(full.counts, { rock: 3, paper: 3, scissors: 0 });
  assert.equal(full.facts.mostFrequent, "rock");
  assert.equal(full.facts.repeatStreak, 3); // R4–R6 连续 paper
  // jev 在第 1、5 回合失利后都保持了原招
  assert.deepEqual(full.facts.switchAfterLoss, { stayed: 2, switched: 0 });

  const empty = summarizeWindow([], "you", 3);
  assert.deepEqual(empty.counts, { rock: 0, paper: 0, scissors: 0 });
  assert.equal(empty.facts.mostFrequent, null);
  assert.equal(empty.facts.repeatStreak, 0);
});

test("buildRpsPayload 人机模式生成单个 Choice 问题", () => {
  const payload = buildRpsPayload({
    round: 4,
    history: history.slice(0, 3),
    score: { you: 1, jev: 1, draw: 1 },
    seats: [{ id: "you", config: HUMAN }, { id: "jev", config: configById("win3") }],
  });
  assert.equal(payload.state.round, 4);
  assert.equal(payload.state.players.you.style, "human");
  assert.equal(payload.state.players.jev.style, "recent-3");
  assert.equal(payload.state.history.length, 3);
  assert.deepEqual(payload.state.history[0], { round: 1, you: "paper", jev: "rock", winner: "you" });
  assert.ok(payload.state.windows["3"].you.counts);
  assert.equal(Object.keys(payload.questions).length, 1);
  const question = payload.questions.jev_throw;
  assert.equal(question.type, "choice");
  assert.deepEqual(Object.keys(question.criteria), MOVES);
  assert.match(question.instructions, /windows\.3/);
  assert.match(question.instructions, /players\.jev/);
});

test("buildRpsPayload 模拟模式合并两个问题到一次调用", () => {
  const payload = buildRpsPayload({
    round: 6,
    history,
    score: { seat_a: 2, seat_b: 2, draw: 2 },
    seats: [{ id: "seat_a", config: configById("win5") }, { id: "seat_b", config: configById("win3") }],
  });
  assert.equal(Object.keys(payload.questions).length, 2);
  assert.match(payload.questions.seat_a_throw.instructions, /windows\.5\.seat_b/);
  assert.match(payload.questions.seat_b_throw.instructions, /windows\.3\.seat_a/);
  // history 截到最大窗口 5
  assert.equal(payload.state.history.length, 5);
  assert.equal(payload.state.history[0].round, 2);
  assert.ok(payload.state.windows["3"] && payload.state.windows["5"]);
});

test("buildRpsPayload 随机座位不产生问题", () => {
  const seats = [{ id: "a", config: configById("random") }, { id: "b", config: configById("win3") }];
  assert.equal(Object.keys(buildRpsPayload({ round: 1, history: [], score: {}, seats }).questions).length, 1);
  const bothRandom = [{ id: "a", config: configById("random") }, { id: "b", config: configById("random") }];
  const payload = buildRpsPayload({ round: 1, history: [], score: {}, seats: bothRandom });
  assert.equal(Object.keys(payload.questions).length, 0);
  assert.equal(payload.state.windows, undefined);
});

test("pickMove argmax 取最大概率并随机破平手", () => {
  const probabilities = { rock: 0.1, paper: 0.7, scissors: 0.2 };
  assert.equal(pickMove(probabilities, "argmax"), "paper");
  assert.equal(pickMove({ rock: 0.5, paper: 0.5, scissors: 0 }, "argmax", () => 0.9), "paper");
  assert.equal(pickMove({ rock: 0.5, paper: 0.5, scissors: 0 }, "argmax", () => 0.1), "rock");
});

test("pickMove 采样按权重落入正确区间（含未归一化权重）", () => {
  const probabilities = { rock: 0.5, paper: 0.3, scissors: 0.2 };
  assert.equal(pickMove(probabilities, "sample", () => 0), "rock");
  assert.equal(pickMove(probabilities, "sample", () => 0.49), "rock");
  assert.equal(pickMove(probabilities, "sample", () => 0.51), "paper");
  assert.equal(pickMove(probabilities, "sample", () => 0.99), "scissors");
  // 未归一化权重 5/3/2 与 0.5/0.3/0.2 分桶一致
  const unnormalized = { rock: 5, paper: 3, scissors: 2 };
  assert.equal(pickMove(unnormalized, "sample", () => 0.49), "rock");
  assert.equal(pickMove(unnormalized, "sample", () => 0.51), "paper");
  assert.equal(pickMove(unnormalized, "sample", () => 0.99), "scissors");
  // 浮点尾部安全
  assert.equal(pickMove(probabilities, "sample", () => 0.999999), "scissors");
});

test("pickMove 概率缺失或全零时回退均匀随机", () => {
  const outcomes = new Set();
  for (let index = 0; index < 60; index += 1) outcomes.add(pickMove({}, "sample", () => (index % 3) / 3));
  assert.ok(outcomes.has("rock") && outcomes.has("paper") && outcomes.has("scissors"));
  assert.equal(pickMove({ rock: 0, paper: 0, scissors: 0 }, "argmax", () => 0.5), "paper");
  assert.equal(randomMove(() => 0.34), "paper");
});

test("normalizeProbabilities 归一化展示值", () => {
  assert.deepEqual(normalizeProbabilities({ rock: 5, paper: 3, scissors: 2 }), { rock: 0.5, paper: 0.3, scissors: 0.2 });
  assert.equal(normalizeProbabilities({ rock: 0, paper: 0, scissors: 0 }), null);
  assert.equal(normalizeProbabilities(null), null);
});

test("decodeSeat 容忍缺失的概率键", () => {
  const decoded = decodeSeat({ answers: { jev_throw: { type: "choice", choice: "rock", confidence: 0.4, probabilities: { rock: 0.6 } } } }, "jev_throw");
  assert.equal(decoded.choice, "rock");
  assert.deepEqual(decoded.probabilities, { rock: 0.6, paper: 0, scissors: 0 });
  assert.equal(decodeSeat({ answers: {} }, "jev_throw"), null);
  assert.equal(decodeSeat({ answers: { jev_throw: { type: "score", score: 2 } } }, "jev_throw"), null);
});

function fakeFetch(handling) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return handling(calls.length);
  };
  return { fetchImpl, calls };
}

test("runRpsRound 成功时回传配额并解析响应体", async () => {
  const { fetchImpl, calls } = fakeFetch(() => ({
    ok: true,
    json: async () => ({ model: "jev-latest", quota: { limit: 500, remaining: 499 }, answers: {} }),
  }));
  const quotas = [];
  const body = await runRpsRound(
    { state: { round: 1 }, questions: { jev_throw: {} } },
    { apiKey: "ts_x", onQuota: (snapshot) => quotas.push(snapshot), fetchImpl },
  );
  assert.equal(body.model, "jev-latest");
  assert.deepEqual(quotas, [{ limit: 500, remaining: 499 }]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/system-one");
  const sent = JSON.parse(calls[0].options.body);
  assert.equal(sent.apiKey, "ts_x");
  assert.equal(sent.state.round, 1);

  const noKey = fakeFetch(() => ({ ok: true, json: async () => ({ answers: {} }) }));
  await runRpsRound({ state: {}, questions: {} }, { fetchImpl: noKey.fetchImpl });
  assert.equal(JSON.parse(noKey.calls[0].options.body).apiKey, undefined);
});

test("runRpsRound 失败时抛出带 status 与 quota 的错误", async () => {
  const quota = { limit: 500, remaining: 0 };
  const { fetchImpl } = fakeFetch(() => ({ ok: false, status: 429, json: async () => ({ error: "今日额度已用完", quota }) }));
  await assert.rejects(
    runRpsRound({ state: {}, questions: {} }, { fetchImpl }),
    (error) => error.status === 429 && error.quota === quota && error.message === "今日额度已用完",
  );
});

test("战绩统计双视角累计并写入 localStorage", () => {
  globalThis.localStorage = fakeStorage();
  let stats = readRpsStats();
  assert.deepEqual(stats, emptyStats());
  stats = recordRoundHuman(stats, { configId: "win3", humanMove: "rock", jevMove: "scissors", result: "win" });
  assert.equal(stats.human.moves.rock, 1);
  assert.equal(stats.human.win, 1);
  assert.equal(stats.configs.win3.moves.scissors, 1);
  assert.equal(stats.configs.win3.lose, 1); // 配置视角与人相反
  assert.ok(stats.updatedAt);

  stats = recordRoundSim(stats, { aId: "win3", bId: "win5", aMove: "paper", bMove: "rock", result: "b" });
  assert.equal(stats.configs.win3.moves.paper, 1);
  assert.equal(stats.configs.win3.lose, 2);
  assert.equal(stats.configs.win5.moves.rock, 1);
  assert.equal(stats.configs.win5.win, 1);
  assert.deepEqual(stats.matchups["win3:win5"], { aWin: 0, bWin: 1, draw: 0, rounds: 1 });

  // 持久化后重读一致
  assert.equal(readRpsStats().configs.win3.lose, 2);

  stats = resetRpsStats();
  assert.deepEqual(stats, { ...emptyStats(), updatedAt: null });
  assert.deepEqual(readRpsStats().matchups, {});
});

test("损坏的统计 JSON 回退到空结构", () => {
  globalThis.localStorage = fakeStorage({ "jev-pop-lab:rps-stats:v1": "{not json" });
  assert.deepEqual(readRpsStats().human.moves, { rock: 0, paper: 0, scissors: 0 });
});

test("record* 不改动入参且重复执行幂等（StrictMode 双调用安全）", () => {
  globalThis.localStorage = fakeStorage();
  let stats = readRpsStats();
  stats = recordRoundHuman(stats, { configId: "win3", humanMove: "rock", jevMove: "paper", result: "lose" });
  const snapshot = JSON.stringify(stats);

  // 开发模式下 React StrictMode 会用同一个 prev 调用 updater 两次，结果必须一致且只记一次
  const humanFirst = recordRoundHuman(stats, { configId: "win3", humanMove: "scissors", jevMove: "rock", result: "win" });
  const humanSecond = recordRoundHuman(stats, { configId: "win3", humanMove: "scissors", jevMove: "rock", result: "win" });
  assert.deepEqual({ ...humanFirst, updatedAt: null }, { ...humanSecond, updatedAt: null });
  assert.equal(humanFirst.human.win, 1);
  assert.equal(JSON.stringify(stats), snapshot); // 入参未被原地改动
  assert.equal(readRpsStats().human.win, 1); // localStorage 最终只记一次

  const simFirst = recordRoundSim(stats, { aId: "win3", bId: "win5", aMove: "rock", bMove: "scissors", result: "a" });
  const simSecond = recordRoundSim(stats, { aId: "win3", bId: "win5", aMove: "rock", bMove: "scissors", result: "a" });
  assert.deepEqual({ ...simFirst, updatedAt: null }, { ...simSecond, updatedAt: null });
  assert.equal(simFirst.matchups["win3:win5"].rounds, 1);
  assert.equal(JSON.stringify(stats), snapshot);
});
