import test from "node:test";
import assert from "node:assert/strict";
import { createTrail, trailSample, pruneTrail, trailBuckets, TRAIL_TTL, TRAIL_MIN_STEP } from "../src/lib/bixian-trail.js";

// 笔迹为按时间衰减的轨迹队列（spec 定案）：每帧整帧重绘、按年龄着色、到期彻底清零。
// 不用 canvas destination-out 渐隐——8bit 舍入会让旧墨以低透明度永久残留（原型踩坑）。

// 直线行进 1u/样本，方便按时间铺开样本
function lineSamples(trail, t0, count, step = 1) {
  for (let i = 0; i < count; i += 1) trailSample(trail, t0 + i * 0.2, 10 + i * step, 80);
}

test("到期彻底清零：超龄样本修剪后队列归空、桶不再输出任何墨迹", () => {
  const trail = createTrail();
  lineSamples(trail, 0, 20); // 覆盖 0–3.8s，位移足够逐样本记录
  assert.ok(trail.samples.length >= 15, "行进中的笔应持续上墨");
  pruneTrail(trail, TRAIL_TTL + 4);
  assert.equal(trail.samples.length, 0, "全部样本到期后应彻底清零（无残留）");
  assert.equal(trailBuckets(trail, TRAIL_TTL + 4).length, 0, "到期后不应再渲染任何笔迹段");
});

test("采样门限：位移不足不上墨、静止不累积样本，移动够远才记录", () => {
  const trail = createTrail();
  assert.equal(trailSample(trail, 0, 50, 80), true, "首样本必记");
  assert.equal(trailSample(trail, 0.1, 50.3, 80.2), false, "微颤（< 门限）不应上墨");
  assert.equal(trailSample(trail, 0.2, 50.4, 80.3), false, "位移按上一次已记录点计，仍不足门限");
  assert.equal(trailSample(trail, 0.3, 50.8, 80), true, "位移达门限应记录");
  assert.equal(trail.samples.length, 2);
  assert.ok(TRAIL_MIN_STEP >= 0.5 && TRAIL_MIN_STEP <= 1, "采样门限应在 0.5–1u（防静止堆墨，又不至于断线）");
});

test("按年龄分桶：桶按先旧后新排序、桶龄单调、线宽与透明度随龄衰减", () => {
  const trail = createTrail();
  const t0 = 100;
  for (let i = 0; i < 40; i += 1) trailSample(trail, t0 - TRAIL_TTL + i * 0.1, 10 + i, 80 + i * 0.5);
  const buckets = trailBuckets(trail, t0, 10);
  assert.ok(buckets.length >= 3, `样本铺满留存期，应分出多段（实测 ${buckets.length} 段）`);
  for (let i = 0; i < buckets.length; i += 1) {
    if (i === 0) continue;
    assert.ok(buckets[i].age01 < buckets[i - 1].age01, `桶龄应单调递减（先旧后新，第 ${i} 桶应更新）`);
    assert.ok(buckets[i].width >= buckets[i - 1].width, "新墨应不细于旧墨");
    assert.ok(buckets[i].opacity >= buckets[i - 1].opacity, "新墨应不淡于旧墨");
  }
  const newest = buckets[buckets.length - 1];
  const oldest = buckets[0];
  assert.ok(newest.width > oldest.width && newest.opacity > oldest.opacity, "最新一段应明显浓粗于最旧一段");
});

test("桶间续接：相邻桶共享边界点，笔迹逐段相连不断线", () => {
  const trail = createTrail();
  const t0 = 50;
  for (let i = 0; i < 30; i += 1) trailSample(trail, t0 - 3.5 + i * 0.12, 12 + i, 70);
  const buckets = trailBuckets(trail, t0, 6);
  assert.ok(buckets.length >= 2);
  for (let i = 1; i < buckets.length; i += 1) {
    const prevLast = buckets[i - 1].points[buckets[i - 1].points.length - 1];
    const currFirst = buckets[i].points[0];
    assert.deepEqual(currFirst, prevLast, `第 ${i} 桶应从上一桶的末点续起`);
  }
});

test("单点不成线：孤立样本不产生线段；默认留存约 4 秒", () => {
  const trail = createTrail();
  trailSample(trail, 10, 50, 80);
  assert.equal(trailBuckets(trail, 10.5, 10).length, 0, "孤立一点不应画出线段");
  assert.ok(TRAIL_TTL >= 3.5 && TRAIL_TTL <= 4.5, "笔迹留存默认约 4s（spec 定案）");
});
