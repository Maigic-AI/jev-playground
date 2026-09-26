import test from "node:test";
import assert from "node:assert/strict";
import {
  GLYPHS, buildResponderPayload, decodeVerdict, isTabooQuestion,
  createResponder, adjudicate, nextMood, MOOD_OVERLAYS, paramsWithMood, runSpiritCall,
} from "../src/lib/bixian-responder.js";
import { CELLS, cellByKey } from "../src/lib/bixian-board.js";
import { PERSONALITIES, createRng, paramsFor } from "../src/lib/bixian-drift.js";

// ============ 落定字表（criteria 即预设字表，ADR-0001：只分类、不生成文本） ============

test("落定字表：21 字与纸面逐一对应，勾/叉在列（问询中勾表是、叉表否）", () => {
  assert.equal(GLYPHS.length, 21);
  assert.deepEqual(GLYPHS, CELLS.map((cell) => cell.key));
  for (const key of ["勾", "叉", "是", "否", "十", "唐", "清", "男", "女"]) {
    assert.ok(GLYPHS.includes(key), `落定字表应含『${key}』`);
  }
});

// ============ payload 构建：一次调用、双 choice（问审 + 落定） ============

test("payload：一次调用同时携带问审与落定两个 choice 问题", () => {
  const { state, questions } = buildResponderPayload({ question: "我明年能脱单吗" });
  assert.equal(state.question, "我明年能脱单吗");
  assert.equal(Object.keys(questions).length, 2, "应恰好两个问题：一次调用双 choice");
  assert.equal(questions.review.type, "choice");
  assert.equal(questions.settle.type, "choice");
  assert.deepEqual(Object.keys(questions.review.criteria).sort(), ["answerable", "overstep"]);
  assert.deepEqual(Object.keys(questions.settle.criteria), GLYPHS, "落定 criteria 即预设字表");
  // 两问共享同一份 state，问题文本进入 state 供两问共用
  assert.ok(questions.review.instructions.includes("answerable"));
  assert.ok(questions.settle.instructions.length > 0);
});

// ============ 解码 ============

test("解码：可答+字值、越界、无效字值、缺答案各自落位", () => {
  const body = (review, settle) => ({
    answers: {
      review: { type: "choice", choice: review, confidence: 0.9 },
      settle: { type: "choice", choice: settle, confidence: 0.72 },
    },
  });
  assert.deepEqual(
    { ...decodeVerdict(body("answerable", "七")), cell: undefined },
    { review: "answerable", glyph: "七", confidence: 0.72, cell: undefined },
  );
  assert.equal(decodeVerdict(body("overstep", "是")).review, "overstep");
  assert.equal(decodeVerdict(body("answerable", "卅")).glyph, null, "字表之外的字值无效");
  assert.equal(decodeVerdict(body("随便", "七")).review, null, "问审选项之外无效");
  assert.deepEqual(decodeVerdict({ answers: {} }), { review: null, glyph: null, confidence: 0 });
  assert.deepEqual(decodeVerdict({}), { review: null, glyph: null, confidence: 0 });
  assert.equal(decodeVerdict({ answers: { review: { type: "score", score: 1 }, settle: { type: "choice", choice: "七" } } }).review, null);
});

// ============ 禁忌问法（本地即断：问仙之死直接触怒，不走问审、不耗灵力） ============

test("禁忌问法：问仙之死触怒，寻常问法与问人之事不触怒", () => {
  for (const text of ["笔仙是怎么死的", "笔仙是怎么死的？", "你是怎么死的", "笔仙你什么时候死的", "你会死吗", "仙家因何身亡"]) {
    assert.equal(isTabooQuestion(text), true, `『${text}』应为禁忌问法`);
  }
  for (const text of ["笔仙是怎么来的", "今晚吃什么", "我明年运势如何", "我什么时候结婚", "前朝是哪一朝", "你是笔仙吗", "你想让我死吗", "你要他死吗"]) {
    assert.equal(isTabooQuestion(text), false, `『${text}』不应为禁忌问法（问的是人，该走问审）`);
  }
});

// ============ 裁决编排 ============

// 假仙示：按序回放预设响应体；记录收到的 payload 供断言
function fakeSpirit(handlings) {
  const payloads = [];
  const call = async (payload) => {
    payloads.push(payload);
    const handling = handlings[Math.min(payloads.length - 1, handlings.length - 1)];
    if (typeof handling === "function") return handling(payload);
    if (handling.throw) {
      const error = new Error(handling.message);
      if (handling.status) error.status = handling.status;
      if (handling.quota) error.quota = handling.quota;
      throw error;
    }
    const answers = {
      review: { type: "choice", choice: handling.review ?? "answerable", confidence: 0.9 },
      settle: { type: "choice", choice: handling.settle ?? "是", confidence: handling.confidence ?? 0.8 },
    };
    return { model: "jev-latest", answers };
  };
  return { call, payloads };
}

test("裁决：可答之问得字值，同局同问走缓存且答案一致（确认式回答）", async () => {
  const { call, payloads } = fakeSpirit([{ settle: "七" }]);
  const responder = createResponder();
  const first = await adjudicate(responder, "我明年能脱单吗", { call });
  assert.equal(first.kind, "answer");
  assert.equal(first.source, "spirit");
  assert.equal(first.cell, cellByKey("七"));
  assert.equal(first.confidence, 0.8);
  assert.equal(payloads.length, 1);
  assert.equal(payloads[0].state.question, "我明年能脱单吗");

  // 同局同问（仅多标点/空白）→ 缓存命中，不再耗灵力，答案一致
  const again = await adjudicate(responder, "我明年能脱单吗？", { call });
  assert.equal(again.kind, "answer");
  assert.equal(again.source, "cache");
  assert.equal(again.cell, first.cell);
  assert.equal(payloads.length, 1, "重问不应再次调用");
});

test("裁决：问审越界 → 迷走，同问缓存后一致", async () => {
  const { call, payloads } = fakeSpirit([{ review: "overstep", settle: "是" }]);
  const responder = createResponder();
  const verdict = await adjudicate(responder, "我同桌的日记写了什么", { call });
  assert.equal(verdict.kind, "stray");
  assert.equal(verdict.cause, "overstep");
  assert.equal(verdict.source, "spirit");
  const again = await adjudicate(responder, "我同桌的日记写了什么", { call });
  assert.equal(again.source, "cache");
  assert.equal(again.cause, "overstep");
  assert.equal(payloads.length, 1);
});

test("裁决：禁忌问法零调用直接迷走，重复问亦零调用", async () => {
  const { call, payloads } = fakeSpirit([{ settle: "是" }]);
  const responder = createResponder();
  for (let i = 0; i < 2; i += 1) {
    const verdict = await adjudicate(responder, "笔仙是怎么死的", { call });
    assert.equal(verdict.kind, "stray");
    assert.equal(verdict.cause, "taboo");
    assert.equal(verdict.source, "taboo");
  }
  assert.equal(payloads.length, 0, "禁忌问法不走问审、不耗灵力");
});

test("裁决：调用失败退均匀随机天意并明示失准，不入缓存（重问即重试）", async () => {
  const { call, payloads } = fakeSpirit([{ throw: true, message: "仙路中断" }, { settle: "三" }]);
  const responder = createResponder();
  const rng = createRng(20260926);
  const fate = await adjudicate(responder, "我几岁有孩子", { call, rng });
  assert.equal(fate.kind, "answer");
  assert.equal(fate.source, "fate");
  assert.equal(fate.inaccurate, true);
  assert.equal(fate.reason, "call");
  assert.ok(CELLS.includes(fate.cell), "天意也应落在纸面字上");
  assert.equal(payloads.length, 1, "天意不入缓存：重问应重新调用");
  const retried = await adjudicate(responder, "我几岁有孩子", { call, rng });
  assert.equal(retried.source, "spirit", "重试可重新得到仙裁");
  assert.equal(payloads.length, 2);
});

test("裁决：配额耗尽（429）与解读失败各有来路，均退天意", async () => {
  const quota = { limit: 500, used: 500, remaining: 0 };
  const exhausted = fakeSpirit([{ throw: true, message: "今日默认 API 调用次数已用完", status: 429, quota }]);
  const responder = createResponder();
  const rng = createRng(7);
  const verdict = await adjudicate(responder, "考试能过吗", { call: exhausted.call, rng });
  assert.equal(verdict.source, "fate");
  assert.equal(verdict.reason, "quota");
  assert.equal(verdict.message, "今日默认 API 调用次数已用完");

  const garbled = fakeSpirit([{ settle: "卅" }]); // 问审可答、落定给了个字表外的字
  const garbledVerdict = await adjudicate(createResponder(), "股票会涨吗", { call: garbled.call, rng });
  assert.equal(garbledVerdict.source, "fate");
  assert.equal(garbledVerdict.reason, "decode");
});

test("裁决：预知仙力竭尽则不发一调用，直接天意", async () => {
  const { call, payloads } = fakeSpirit([{ settle: "是" }]);
  const responder = createResponder();
  const verdict = await adjudicate(responder, "问个也行吗", { call, rng: createRng(42), exhausted: true });
  assert.equal(verdict.source, "fate");
  assert.equal(verdict.reason, "exhausted");
  assert.equal(payloads.length, 0);
});

test("天意兜底：种子化可复现，均匀散布在字表之内", async () => {
  const glyphs = [];
  for (let i = 0; i < 400; i += 1) {
    const { call } = fakeSpirit([{ throw: true, message: "x" }]);
    const verdict = await adjudicate(createResponder(), `第${i}问`, { call, rng: createRng(1000 + i) });
    glyphs.push(verdict.cell.key);
  }
  assert.ok(glyphs.every((key) => GLYPHS.includes(key)), "天意只落预设字表");
  assert.ok(new Set(glyphs).size >= 15, `均匀抽样应铺开字表（实测 ${new Set(glyphs).size} 种）`);
  const rerun = await adjudicate(createResponder(), "同一种子", {
    call: fakeSpirit([{ throw: true, message: "x" }]).call,
    rng: createRng(20260926),
  });
  const first = await adjudicate(createResponder(), "同一种子", {
    call: fakeSpirit([{ throw: true, message: "x" }]).call,
    rng: createRng(20260926),
  });
  assert.equal(rerun.cell, first.cell, "同种子天意可复现");
});

// ============ 笔势（越界转躁、触怒升档，随局持续到回位） ============

test("笔势迁移：越界转躁、禁忌触怒升档，答案不动笔势", () => {
  const answer = { kind: "answer", source: "spirit", cell: cellByKey("是") };
  const overstep = { kind: "stray", cause: "overstep" };
  const taboo = { kind: "stray", cause: "taboo" };
  assert.equal(nextMood("calm", answer), "calm");
  assert.equal(nextMood("calm", overstep), "restless");
  assert.equal(nextMood("restless", overstep), "restless", "躁不因再越界降档");
  assert.equal(nextMood("calm", taboo), "furious");
  assert.equal(nextMood("restless", taboo), "furious");
  assert.equal(nextMood("furious", answer), "furious", "怒意随局持续");
  assert.equal(nextMood("furious", null), "furious");
});

test("笔势叠层：只加扰动不换性格——三档性格 × 三笔势下，性格标志位原封不动", () => {
  // 性格标志位：起速／蓄势环半径／环行弹簧与径向阻尼／全局阻尼／慢起速／蓄势与渐近时长／收圈半径与收势时长
  const MARKERS = [
    "cruiseSpeed", "ringR0", "ringK", "ringDamp", "damping",
    "startRamp", "warmup", "approach", "finalRadius", "stillTime",
  ];
  for (const id of Object.keys(PERSONALITIES)) {
    const base = paramsFor(id);
    assert.deepEqual(paramsWithMood(id, "calm"), base, `${id}：静即当局性格本身，不叠任何扰动`);
    for (const mood of Object.keys(MOOD_OVERLAYS)) {
      const params = paramsWithMood(id, mood);
      for (const key of MARKERS) {
        assert.equal(params[key], base[key], `${id}×${mood}：性格标志位 ${key} 不应被笔势改动`);
      }
      assert.equal(params.settleMode, base.settleMode, `${id}×${mood}：判定式属性格`);
      assert.equal(params.dwellTime, base.dwellTime, `${id}×${mood}：落定驻留属性格`);
      assert.deepEqual(Object.keys(params).sort(), Object.keys(base).sort(), "笔势不新增键");
    }
  }
});

test("笔势叠层：扰动项随势升（怒 > 躁 > 静），怒级噪声更碎、脱手更抖", () => {
  for (const id of Object.keys(PERSONALITIES)) {
    const calm = paramsWithMood(id, "calm");
    const restless = paramsWithMood(id, "restless");
    const furious = paramsWithMood(id, "furious");
    assert.ok(restless.noiseAmp > calm.noiseAmp && furious.noiseAmp > restless.noiseAmp, `${id}：噪声随势升`);
    assert.ok(restless.wanderAmp > calm.wanderAmp && furious.wanderAmp > restless.wanderAmp, `${id}：环心游走随势升`);
    assert.ok(furious.noiseTau < restless.noiseTau, `${id}：怒级噪声更碎（tau 更短）`);
    assert.ok(furious.releaseJitterAmp > restless.releaseJitterAmp, `${id}：怒级脱手微抖更大`);
  }
});

test("笔势叠层：增量按绝对量叠，不在极端档上复利（改回倍数会让飘忽×怒越出 #2 的耗时窗）", () => {
  // 这条锁的是「叠」的语义：怒加的是同一分躁，不是同一倍数。改成倍数（噪声 ×2）会落在飘忽的
  // 噪声 13 上变成 26，落定耗时被顶出 #2 锁死的窗 [18, 28]s（40 种子实测最长 33.8s）——
  // 越窗的后果是「一局能拖过 3 分钟」，而沉稳档一切正常，单看沉稳的参数值发现不了。
  const deltas = {};
  for (const id of Object.keys(PERSONALITIES)) {
    const base = paramsFor(id);
    const furious = paramsWithMood(id, "furious");
    const restless = paramsWithMood(id, "restless");
    deltas[id] = {
      noise: furious.noiseAmp - base.noiseAmp,
      wander: furious.wanderAmp - base.wanderAmp,
      jitter: furious.releaseJitterAmp - base.releaseJitterAmp,
    };
    // 躁 = 怒的一半（同一条倍数规则，写死一处即可推另一处）；比浮点差要留容差
    assert.ok(Math.abs(restless.noiseAmp - base.noiseAmp - deltas[id].noise / 2) < 1e-9, `${id}：躁的噪声增量应为怒的一半`);
    assert.ok(Math.abs(restless.wanderAmp - base.wanderAmp - deltas[id].wander / 2) < 1e-9, `${id}：躁的游走增量应为怒的一半`);
  }
  for (const id of Object.keys(PERSONALITIES)) {
    assert.deepEqual(deltas[id], deltas.steady, `${id}：怒的扰动增量应与沉稳档同量（绝对增量，不随档复利）`);
  }
  // 沉稳×怒 的绝对值即 #4 定下的怒档手感（旧 MOOD_PARAMS.furious：噪声 13／游走 15／微抖 0.45）
  const anchor = paramsWithMood("steady", "furious");
  assert.equal(anchor.noiseAmp, 14, "沉稳×怒噪声 14（#4 旧值 13）");
  assert.equal(anchor.wanderAmp, 15.3, "沉稳×怒游走 15.3（#4 旧值 15）");
  assert.equal(anchor.releaseJitterAmp, 0.45, "沉稳×怒脱手微抖 0.45（#4 旧值同）");
  assert.equal(anchor.noiseTau, 0.42, "沉稳×怒噪声更碎（tau 0.7→0.42，约 #4 旧值 0.35）");
});

test("笔势叠层：不再把当局性格踩回沉稳（#7 的坑——旧实现是整包替换）", () => {
  const steady = paramsFor("steady");
  for (const id of ["hasty", "erratic"]) {
    const base = paramsFor(id);
    const mooded = paramsWithMood(id, "furious");
    for (const key of ["cruiseSpeed", "ringR0", "warmup", "damping"]) {
      assert.equal(mooded[key], base[key], `${id}：${key} 须是当局性格的`);
      assert.notEqual(base[key], steady[key], `夹具前提：${id} 的 ${key} 与沉稳不同`);
    }
  }
});

test("笔势叠层：未知笔势或未知性格显式抛错（不静默回退到静）", () => {
  assert.throws(() => paramsWithMood("steady", "nope"), /未知笔势/);
  assert.throws(() => paramsWithMood("nope", "calm"), /未知漂移性格/);
});

// ============ API 封装（可注入 fetchImpl，与猜拳同一模式） ============

function fakeFetch(handling) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return handling(calls.length);
  };
  return { fetchImpl, calls };
}

test("runSpiritCall 成功时回传配额并解析响应体，自带 key 优先随行", async () => {
  const quota = { limit: 500, used: 6, remaining: 494 };
  const { fetchImpl, calls } = fakeFetch(() => ({
    ok: true,
    json: async () => ({ model: "jev-latest", quota, answers: {} }),
  }));
  const quotas = [];
  const body = await runSpiritCall(
    { state: { question: "在吗" }, questions: { review: {}, settle: {} } },
    { apiKey: "ts_x", onQuota: (snapshot) => quotas.push(snapshot), fetchImpl },
  );
  assert.equal(body.model, "jev-latest");
  assert.deepEqual(quotas, [quota]);
  assert.equal(calls[0].url, "/api/system-one");
  const sent = JSON.parse(calls[0].options.body);
  assert.equal(sent.apiKey, "ts_x");
  assert.equal(sent.state.question, "在吗");
  assert.deepEqual(Object.keys(sent.questions), ["review", "settle"]);

  const noKey = fakeFetch(() => ({ ok: true, json: async () => ({ answers: {} }) }));
  await runSpiritCall({ state: {}, questions: {} }, { fetchImpl: noKey.fetchImpl });
  assert.equal(JSON.parse(noKey.calls[0].options.body).apiKey, undefined);
});

test("runSpiritCall 失败时抛出带 status 与 quota 的错误", async () => {
  const quota = { limit: 500, used: 500, remaining: 0 };
  const { fetchImpl } = fakeFetch(() => ({ ok: false, status: 429, json: async () => ({ error: "今日额度已用完", quota }) }));
  const quotas = [];
  await assert.rejects(
    runSpiritCall({ state: {}, questions: {} }, { onQuota: (snapshot) => quotas.push(snapshot), fetchImpl }),
    (error) => error.status === 429 && error.quota === quota && error.message === "今日额度已用完",
  );
  assert.deepEqual(quotas, [quota], "429 响应也带回最新配额快照");
});
