import { CONFIGS, MOVES } from "./rps.js";

const RPS_STATS_KEY = "jev-pop-lab:rps-stats:v1";

function emptySide() {
  return { moves: Object.fromEntries(MOVES.map((move) => [move, 0])), win: 0, lose: 0, draw: 0 };
}

export function emptyStats() {
  return {
    version: 1,
    human: emptySide(),
    configs: Object.fromEntries(CONFIGS.map((config) => [config.id, emptySide()])),
    matchups: {},
    updatedAt: null,
  };
}

export function readRpsStats() {
  try {
    const parsed = JSON.parse(localStorage.getItem(RPS_STATS_KEY) || "null");
    if (!parsed || typeof parsed !== "object") return emptyStats();
    // 逐字段回填，容忍旧版本缺键
    const stats = emptyStats();
    for (const side of ["human", ...CONFIGS.map((config) => config.id)]) {
      const key = side === "human" ? "human" : "configs";
      const source = key === "human" ? parsed.human : parsed.configs?.[side];
      if (source) {
        const target = key === "human" ? stats.human : stats.configs[side];
        for (const move of MOVES) target.moves[move] = Number(source.moves?.[move]) || 0;
        for (const field of ["win", "lose", "draw"]) target[field] = Number(source[field]) || 0;
      }
    }
    if (parsed.matchups && typeof parsed.matchups === "object") {
      for (const [key, value] of Object.entries(parsed.matchups)) {
        stats.matchups[key] = { aWin: Number(value?.aWin) || 0, bWin: Number(value?.bWin) || 0, draw: Number(value?.draw) || 0, rounds: Number(value?.rounds) || 0 };
      }
    }
    return stats;
  } catch {
    return emptyStats();
  }
}

function write(stats) {
  const next = { ...stats, updatedAt: new Date().toISOString() };
  try { localStorage.setItem(RPS_STATS_KEY, JSON.stringify(next)); } catch { /* 隐私模式等场景下静默降级为仅内存统计 */ }
  return next;
}

function tally(side, move, outcome) {
  side.moves[move] += 1;
  side[outcome] += 1;
}

// record* 会被当作 setState(prev => …) 的 updater 调用，而 React StrictMode 在开发模式下
// 会重复调用 updater 暴露副作用——因此必须不改动入参，且对同一入参重复执行结果一致（幂等）
function cloneSide(side) {
  return { moves: { ...side.moves }, win: side.win, lose: side.lose, draw: side.draw };
}

function cloneStats(stats) {
  return {
    ...stats,
    human: cloneSide(stats.human),
    configs: Object.fromEntries(Object.entries(stats.configs).map(([id, side]) => [id, cloneSide(side)])),
    matchups: Object.fromEntries(Object.entries(stats.matchups).map(([key, matchup]) => [key, { ...matchup }])),
  };
}

// 人机对战：result 为玩家视角 "win" | "lose" | "draw"；配置的胜负与人相反
export function recordRoundHuman(stats, { configId, humanMove, jevMove, result }) {
  const next = cloneStats(stats);
  tally(next.human, humanMove, result);
  const config = next.configs[configId] || (next.configs[configId] = emptySide());
  const configOutcome = result === "win" ? "lose" : result === "lose" ? "win" : "draw";
  tally(config, jevMove, configOutcome);
  return write(next);
}

// 模拟对战：result 为 "a" | "b" | "draw"；双配置累计 + 有序 matchup 键
export function recordRoundSim(stats, { aId, bId, aMove, bMove, result }) {
  const next = cloneStats(stats);
  const a = next.configs[aId] || (next.configs[aId] = emptySide());
  const b = next.configs[bId] || (next.configs[bId] = emptySide());
  tally(a, aMove, result === "a" ? "win" : result === "b" ? "lose" : "draw");
  tally(b, bMove, result === "b" ? "win" : result === "a" ? "lose" : "draw");
  const key = `${aId}:${bId}`;
  const matchup = next.matchups[key] || (next.matchups[key] = { aWin: 0, bWin: 0, draw: 0, rounds: 0 });
  if (result === "a") matchup.aWin += 1;
  else if (result === "b") matchup.bWin += 1;
  else matchup.draw += 1;
  matchup.rounds += 1;
  return write(next);
}

export function resetRpsStats() {
  const stats = emptyStats();
  try { localStorage.setItem(RPS_STATS_KEY, JSON.stringify(stats)); } catch { /* 同上 */ }
  return stats;
}
