const LEVEL_NUM = { L: 1, M: 2, H: 3 };

export function scoreMbti(questions, answers) {
  const scores = { E: 0, I: 0, S: 0, N: 0, T: 0, F: 0, J: 0, P: 0 };
  for (const question of questions) {
    const selected = answers[question.id];
    if (selected == null) continue;
    const pair = question.dimension;
    scores[selected === 0 ? pair[0] : pair[1]] += 1;
  }
  const type = `${scores.E > scores.I ? "E" : "I"}${scores.S > scores.N ? "S" : "N"}${scores.T > scores.F ? "T" : "F"}${scores.J > scores.P ? "J" : "P"}`;
  return { kind: "mbti", type, scores };
}

export function score8Values(questions, answers) {
  const dimensions = ["econ", "dipl", "govt", "scty"];
  const result = {};
  for (const dimension of dimensions) {
    const max = questions.reduce((sum, item) => sum + Math.abs(item.effect[dimension]), 0);
    const raw = questions.reduce((sum, item, index) => sum + (answers[index] ?? 0) * item.effect[dimension], 0);
    result[dimension] = Number((100 * (max + raw) / (2 * max)).toFixed(1));
  }
  return { kind: "8values", values: result };
}

function parsePattern(pattern) {
  return pattern.replaceAll("-", "").split("");
}

function matchType(userLevels, order, type) {
  const levels = parsePattern(type.pattern);
  let distance = 0;
  let exact = 0;
  order.forEach((dimension, index) => {
    const diff = Math.abs(LEVEL_NUM[userLevels[dimension]] - LEVEL_NUM[levels[index]]);
    distance += diff;
    if (diff === 0) exact += 1;
  });
  return { ...type, distance, exact, similarity: Math.max(0, Math.round((1 - distance / 30) * 100)) };
}

export function scoreSbti(questions, answers, dimensions, types, config) {
  const sums = {};
  for (const question of questions) {
    const value = answers[question.id];
    if (value == null) continue;
    sums[question.dim] = (sums[question.dim] || 0) + value;
  }
  const levels = {};
  for (const [dimension, value] of Object.entries(sums)) {
    levels[dimension] = value <= config.scoring.levelThresholds.L[1] ? "L" : value >= config.scoring.levelThresholds.H[0] ? "H" : "M";
  }
  const rankings = types.standard
    .map((type) => matchType(levels, dimensions.order, type))
    .sort((a, b) => a.distance - b.distance || b.exact - a.exact || b.similarity - a.similarity);
  let primary = rankings[0];
  const isDrunk = answers[config.drinkGate.questionId] === config.drinkGate.drunkTriggerValue;
  if (isDrunk) primary = { ...types.special.find((type) => type.code === "DRUNK"), similarity: rankings[0].similarity };
  else if (primary.similarity < config.scoring.fallbackThreshold) primary = { ...types.special.find((type) => type.code === "HHHH"), similarity: rankings[0].similarity };
  return { kind: "sbti", primary, rankings, levels };
}

export function percentPair(left, right) {
  const total = left + right || 1;
  return Math.round((left / total) * 100);
}
