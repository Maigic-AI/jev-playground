export const MOVES = ["rock", "paper", "scissors"];
export const MOVE_CN = { rock: "石头", paper: "布", scissors: "剪刀" };
export const MOVE_EMOJI = { rock: "✊", paper: "✋", scissors: "✌️" };

export const HUMAN = { id: "human", name: "你", window: 0, usesApi: false };

export const CONFIGS = [
  { id: "random", name: "随机", emoji: "🎲", window: 0, usesApi: false, note: "本地均匀随机，不调用 Jev、不耗配额" },
  { id: "win3", name: "近3回合", emoji: "🧠", window: 3, usesApi: true, note: "依据双方最近 3 回合出招，由 Jev Choice 决策" },
  { id: "win5", name: "近5回合", emoji: "🔭", window: 5, usesApi: true, note: "依据双方最近 5 回合出招，由 Jev Choice 决策" },
];

export function configById(id) {
  return CONFIGS.find((config) => config.id === id) || CONFIGS[0];
}

const BEATS = { rock: "scissors", scissors: "paper", paper: "rock" };
const CRITERIA = {
  rock: "石头 Rock — beats scissors, loses to paper",
  paper: "布 Paper — beats rock, loses to scissors",
  scissors: "剪刀 Scissors — beats paper, loses to rock",
};

// 从 a 的视角判定：win / lose / draw
export function judge(a, b) {
  if (a === b) return "draw";
  return BEATS[a] === b ? "win" : "lose";
}

// 预计算某座位在最近 windowSize 回合内的出招统计（精确事实交给代码，Jev 只做判断）
export function summarizeWindow(history, seat, windowSize) {
  const rounds = history.slice(-windowSize);
  const counts = Object.fromEntries(MOVES.map((move) => [move, 0]));
  for (const record of rounds) {
    const move = record.moves?.[seat];
    if (counts[move] != null) counts[move] += 1;
  }
  const total = rounds.length;
  const rates = Object.fromEntries(MOVES.map((move) => [move, total ? counts[move] / total : 0]));
  let mostFrequent = null;
  if (total) mostFrequent = MOVES.reduce((best, move) => (counts[move] > counts[best] ? move : best), MOVES[0]);
  let repeatStreak = 0;
  if (total) {
    const last = rounds[total - 1].moves?.[seat];
    if (last) for (let index = total - 1; index >= 0 && rounds[index].moves?.[seat] === last; index -= 1) repeatStreak += 1;
  }
  const switchAfterLoss = { stayed: 0, switched: 0 };
  for (let index = 1; index < total; index += 1) {
    const previous = rounds[index - 1];
    if (previous.result !== "draw" && previous.result !== seat) {
      if (previous.moves?.[seat] === rounds[index].moves?.[seat]) switchAfterLoss.stayed += 1;
      else switchAfterLoss.switched += 1;
    }
  }
  return { counts, rates, facts: { mostFrequent, repeatStreak, switchAfterLoss } };
}

function seatStyle(config) {
  if (config.id === "human") return "human";
  if (!config.usesApi) return "random";
  return `recent-${config.window}`;
}

// seats: [{ id, config }, { id, config }]；每个调用 Jev 的座位生成一个 choice 问题
export function buildRpsPayload({ round, history, score, seats }) {
  const apiSeats = seats.filter((seat) => seat.config.usesApi);
  const windowSizes = [...new Set(apiSeats.map((seat) => seat.config.window))];
  const maxWindow = Math.max(0, ...seats.map((seat) => seat.config.window));
  const windows = Object.fromEntries(windowSizes.map((size) => [
    String(size),
    Object.fromEntries(seats.map((seat) => [seat.id, summarizeWindow(history, seat.id, size)])),
  ]));
  const state = {
    game: { name: "rock_paper_scissors", rule: "rock beats scissors; scissors beats paper; paper beats rock; identical throws draw" },
    round,
    score,
    players: Object.fromEntries(seats.map((seat) => [seat.id, { style: seatStyle(seat.config) }])),
    history: history.slice(-maxWindow).map((record) => ({ round: record.round, ...record.moves, winner: record.result })),
  };
  if (windowSizes.length) state.windows = windows;
  const questions = {};
  for (const seat of apiSeats) {
    const opponent = seats.find((other) => other.id !== seat.id);
    questions[`${seat.id}_throw`] = {
      type: "choice",
      instructions: `You are \`players.${seat.id}\` (recent-${seat.config.window} style) playing rock-paper-scissors. Your opponent is \`${opponent.id}\`. Using ONLY the last ${seat.config.window} rounds of \`history\` (both players' throws; frequencies in \`windows.${seat.config.window}\`, especially \`windows.${seat.config.window}.${opponent.id}\`), decide your own best next throw.`,
      criteria: CRITERIA,
    };
  }
  return { state, questions };
}

export function decodeSeat(body, questionId) {
  const answer = body?.answers?.[questionId];
  if (!answer || answer.type !== "choice") return null;
  return {
    choice: MOVES.includes(answer.choice) ? answer.choice : null,
    confidence: Number(answer.confidence) || 0,
    probabilities: Object.fromEntries(MOVES.map((move) => [move, Math.max(0, Number(answer.probabilities?.[move]) || 0)])),
  };
}

export function randomMove(rng = Math.random) {
  return MOVES[Math.floor(rng() * MOVES.length)];
}

// strategy: "sample"（按概率抽样，默认）| "argmax"（总取最高概率）
export function pickMove(probabilities, strategy = "sample", rng = Math.random) {
  const entries = MOVES.map((move) => [move, Math.max(0, Number(probabilities?.[move]) || 0)]);
  const total = entries.reduce((sum, [, probability]) => sum + probability, 0);
  if (!(total > 0)) return randomMove(rng);
  if (strategy === "argmax") {
    const max = Math.max(...entries.map(([, probability]) => probability));
    const ties = entries.filter(([, probability]) => probability === max).map(([move]) => move);
    return ties[Math.floor(rng() * ties.length)];
  }
  let roll = rng() * total;
  for (const [move, probability] of entries) {
    roll -= probability;
    if (roll < 0) return move;
  }
  return entries[entries.length - 1][0];
}

// 仅供展示：把概率归一化为 100%；无有效数据返回 null
export function normalizeProbabilities(probabilities) {
  const values = Object.fromEntries(MOVES.map((move) => [move, Math.max(0, Number(probabilities?.[move]) || 0)]));
  const total = MOVES.reduce((sum, move) => sum + values[move], 0);
  if (!(total > 0)) return null;
  return Object.fromEntries(MOVES.map((move) => [move, values[move] / total]));
}

// 与 auto-run.js 相同的代理调用模式；失败抛出带 .status / .quota 的 Error
export async function runRpsRound(payload, { apiKey, onQuota = () => {}, signal, fetchImpl = fetch } = {}) {
  const httpResponse = await fetchImpl("/api/system-one", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...(apiKey ? { apiKey } : {}), state: payload.state, questions: payload.questions }),
    ...(signal ? { signal } : {}),
  });
  const response = await httpResponse.json();
  if (response.quota) onQuota(response.quota);
  if (!httpResponse.ok) {
    const error = new Error(response.error || "本回合 Jev 请求失败");
    error.status = httpResponse.status;
    error.quota = response.quota ?? null;
    throw error;
  }
  return response;
}
