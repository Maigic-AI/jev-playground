import test from "node:test";
import assert from "node:assert/strict";
import { buildAutoBatch, decodeAutoBatch } from "../src/lib/auto-run.js";

const questions = [{
  id: "q1",
  text: "更喜欢哪一种？",
  options: [{ label: "独处", value: 1 }, { label: "社交", value: 3 }],
}];

test("自动跑测把题目转换为独立 Choice", () => {
  const payload = buildAutoBatch({ title: "测试", locale: "zh" }, questions);
  assert.equal(payload.state.items[0].prompt, "更喜欢哪一种？");
  assert.deepEqual(payload.questions.item_0.criteria, { option_a: "独处", option_b: "社交" });
});

test("自动跑测保留选择、概率和原始计分值", () => {
  const decoded = decodeAutoBatch(questions, {
    answers: {
      item_0: {
        choice: "option_b",
        confidence: 0.6,
        probabilities: { option_a: 0.2, option_b: 0.8 },
      },
    },
  });
  assert.equal(decoded[0].selectedValue, 3);
  assert.equal(decoded[0].selectedLabel, "社交");
  assert.deepEqual(decoded[0].probabilities, { 独处: 0.2, 社交: 0.8 });
});
