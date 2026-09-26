// 笔迹：按时间衰减的轨迹队列 —— 纯逻辑，无 DOM、无计时器（时间由调用方传入的单调秒时钟显式给出）。
// spec 定案：每帧整帧重绘、按年龄着色、到期彻底清零。
// 勿改回 canvas destination-out 渐隐：低 α 处 8bit 舍入会让旧墨以约 16% 透明度永久残留（原型踩坑）。

export const TRAIL_TTL = 4; // 笔迹留存秒数（默认约 4s）
export const TRAIL_MIN_STEP = 0.7; // 距上一样本至少移动此距离（u）才记录：静止不多墨、微颤不糊纸
const WIDTH_MAX = 1.1; // 新墨线宽 u
const WIDTH_MIN = 0.3; // 旧墨线宽 u
const OPACITY_MAX = 0.9; // 新墨浓度
const DEFAULT_BUCKETS = 12; // 年龄分段数：段内同色，段间渐变

export function createTrail(ttl = TRAIL_TTL) {
  return { ttl, samples: [] }; // samples: [{ t, x, y }]，按时间递增
}

// 采样门限：位移不足不上墨。返回是否记录。
export function trailSample(trail, now, x, y) {
  const last = trail.samples[trail.samples.length - 1];
  if (last && Math.hypot(x - last.x, y - last.y) < TRAIL_MIN_STEP) return false;
  trail.samples.push({ t: now, x, y });
  return true;
}

// 修剪超龄样本（到期彻底清零，队列头是最旧的）
export function pruneTrail(trail, now) {
  while (trail.samples.length && now - trail.samples[0].t > trail.ttl) trail.samples.shift();
  return trail;
}

// 按年龄分桶，供整帧重绘：返回 [{ points, age01, width, opacity }]，
// 按「先画旧、后画新」排序（新墨压在旧墨上）；相邻桶共享边界点，笔迹不断线。
export function trailBuckets(trail, now, bucketCount = DEFAULT_BUCKETS) {
  const { ttl, samples } = trail;
  const groups = Array.from({ length: bucketCount }, () => []);
  let prevBucket = null;
  for (let i = 0; i < samples.length; i += 1) {
    const sample = samples[i];
    const age = now - sample.t;
    if (age > ttl) continue; // 修剪前的漏网超龄样本
    let bucket = Math.floor((age / ttl) * bucketCount); // 0 = 最新
    if (bucket >= bucketCount) bucket = bucketCount - 1;
    if (prevBucket !== null && prevBucket !== bucket) groups[bucket].push(samples[i - 1]); // 桶边界续接上一点
    groups[bucket].push(sample);
    prevBucket = bucket;
  }
  const out = [];
  for (let bucket = bucketCount - 1; bucket >= 0; bucket -= 1) {
    if (groups[bucket].length < 2) continue; // 单点不成线
    const age01 = (bucket + 0.5) / bucketCount;
    out.push({
      points: groups[bucket],
      age01,
      width: WIDTH_MAX - age01 * (WIDTH_MAX - WIDTH_MIN),
      opacity: OPACITY_MAX * Math.pow(1 - age01, 1.7),
    });
  }
  return out;
}
