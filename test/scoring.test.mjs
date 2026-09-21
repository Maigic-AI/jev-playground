import test from "node:test";
import assert from "node:assert/strict";
import { score8Values, scoreMbti } from "../src/lib/scoring.js";

test("MBTI 计分按四个二分维度输出类型", () => {
  const questions = [
    { id: 1, dimension: "EI" },
    { id: 2, dimension: "SN" },
    { id: 3, dimension: "TF" },
    { id: 4, dimension: "JP" },
  ];
  assert.equal(scoreMbti(questions, { 1: 0, 2: 1, 3: 0, 4: 1 }).type, "ENTP");
});

test("8values 全部中立时四轴均为 50", () => {
  const questions = [
    { effect: { econ: 10, dipl: -5, govt: 4, scty: -8 } },
    { effect: { econ: -10, dipl: 5, govt: -4, scty: 8 } },
  ];
  assert.deepEqual(score8Values(questions, { 0: 0, 1: 0 }).values, {
    econ: 50, dipl: 50, govt: 50, scty: 50,
  });
});
