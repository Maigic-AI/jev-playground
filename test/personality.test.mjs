import test from "node:test";
import assert from "node:assert/strict";
import { buildState, percentage, SAMPLE_ANSWERS, scoreBar, TEST_QUESTIONS } from "../src/personality.mjs";

test("buildState 将 A/B 答案转成完整的结构化回答", () => {
  const state = buildState(SAMPLE_ANSWERS);
  assert.equal(state.responses.length, TEST_QUESTIONS.length);
  assert.equal(state.responses[0].answer, "独处充电，沉浸在自己的兴趣里");
});

test("buildState 拒绝缺失和非法答案", () => {
  assert.throws(() => buildState(["A"]), /需要 6 个答案/);
  assert.throws(() => buildState(["A", "B", "C", "A", "B", "A"]), /只能回答 A 或 B/);
});

test("展示辅助函数生成稳定结果", () => {
  assert.equal(percentage(0.734), "73%");
  assert.equal(scoreBar(2), "█████░░░░░");
});
