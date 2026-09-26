import test from "node:test";
import assert from "node:assert/strict";
import { CELLS, cellByKey, ANSWER_CELLS, VERIFY_CELL, pickScriptTarget } from "../src/lib/bixian-board.js";
import { createRng } from "../src/lib/bixian-drift.js";

// ============ A 边条布局（spec 定案：顶边勾-是-否-叉，左右列一~五/六~十，底边男唐宋元明清女） ============
test("A 边条布局：21 字/符号齐备、键唯一、全部落在纸面内", () => {
  assert.equal(CELLS.length, 21, "纸面应为 21 字/符号");
  assert.equal(new Set(CELLS.map((cell) => cell.key)).size, 21, "字键应无重复");
  for (const cell of CELLS) {
    assert.ok(cell.x > 0 && cell.x < 100, `${cell.key} 横坐标应在纸内（实测 ${cell.x}）`);
    assert.ok(cell.y > 0 && cell.y < 160, `${cell.key} 纵坐标应在纸内（实测 ${cell.y}）`);
  }
});

test("布局字位锁定：分组结构与锚点坐标沿用原型验证值", () => {
  const byKey = Object.fromEntries(CELLS.map((cell) => [cell.key, cell]));
  // 顶边：勾-是-否-叉，横排
  for (const key of ["勾", "是", "否", "叉"]) assert.equal(byKey[key].y, 13, `${key} 应在顶边`);
  assert.deepEqual(
    ["勾", "是", "否", "叉"].map((key) => byKey[key].x),
    [14, 37, 63, 86],
  );
  // 左列 一~五 / 右列 六~十：纵向、间距一致
  const left = [..."一二三四五"].map((key) => byKey[key]);
  const right = [..."六七八九十"].map((key) => byKey[key]);
  for (const cell of left) assert.equal(cell.x, 12, `${cell.key} 应在左列`);
  for (const cell of right) assert.equal(cell.x, 88, `${cell.key} 应在右列`);
  assert.deepEqual(left.map((cell) => cell.y), [42, 64.5, 87, 109.5, 132]);
  assert.deepEqual(right.map((cell) => cell.y), left.map((cell) => cell.y), "左右列应同高对齐");
  // 底边：男唐宋元明清女，横排
  const bottom = ["男", "唐", "宋", "元", "明", "清", "女"].map((key) => byKey[key]);
  for (const cell of bottom) assert.equal(cell.y, 147, `${cell.key} 应在底边`);
  assert.ok(Math.abs(bottom[0].x - 12) < 1e-9 && Math.abs(bottom[6].x - 88.02) < 1e-9, "底边应从 12 铺到约 88");
  for (let i = 1; i < bottom.length; i += 1) assert.ok(bottom[i].x > bottom[i - 1].x, "底边字序应自左向右");
});

// ============ 验笔与答案类别 ============
test("验笔固定落勾；勾/叉为验笔符号不入答案类别，答案类别共 19 字", () => {
  assert.equal(VERIFY_CELL.key, "勾", "验笔应固定落『勾』");
  assert.equal(VERIFY_CELL, cellByKey("勾"));
  assert.equal(ANSWER_CELLS.length, 19);
  const keys = new Set(ANSWER_CELLS.map((cell) => cell.key));
  assert.ok(!keys.has("勾") && !keys.has("叉"), "勾/叉不应出现在答案类别");
  // CONTEXT.md「答案类别」：是否、一至十、唐宋元明清、男女
  for (const key of "是否一二三四五六七八九十唐宋元明清男女") assert.ok(keys.has(key), `答案类别应含『${key}』`);
});

// ============ 脚本目标字（本票占位裁决：回答器接入前的随机预设） ============
test("脚本目标字：同种子序列确定、必在答案类别内、多次抽样覆盖广", () => {
  const run = () => {
    const rng = createRng(20260926);
    return Array.from({ length: 200 }, () => pickScriptTarget(rng).key);
  };
  const first = run();
  assert.deepEqual(first, run(), "同种子应给出完全一致的序列");
  const pool = new Set(ANSWER_CELLS.map((cell) => cell.key));
  for (const key of first) assert.ok(pool.has(key), `脚本目标『${key}』应在答案类别内`);
  assert.ok(new Set(first).size >= 17, `200 次抽样应几乎覆盖 19 字（实测 ${new Set(first).size} 种）`);
});
