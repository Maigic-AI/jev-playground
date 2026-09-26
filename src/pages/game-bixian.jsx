import React, { useEffect, useRef, useState } from "react";
import {
  PAPER, createRng, createDriftState, summon, ask, sendOff, step, paramsFor,
} from "../lib/bixian-drift.js";
import { CELLS, VERIFY_CELL, pickScriptTarget } from "../lib/bixian-board.js";
import { createTrail, pruneTrail, trailSample, trailBuckets } from "../lib/bixian-trail.js";

// 仪式口诀（调研报告 §2.3：人民网版本的语序）
const CHANT_SUMMON = "笔仙笔仙，我是你的今生，你是我的前世，若要与我续缘，请在纸上画圈。";
const CHANT_SENDOFF = "笔仙笔仙，今日问事已毕，天光将晓，请你回去吧。";
const MAX_QUESTIONS = 5; // 一局至多五问（验笔是仪式脚本，不占问数）
const PERSONALITY = "steady"; // 本票固定沉稳基准；漂移性格三档与每局随机属后续票
const PARAMS = paramsFor(PERSONALITY);
const STILL_PHASES = new Set(["idle", "returned", "settled"]); // 笔迹沥干后可停帧的相位
const CN_NUM = ["一", "二", "三", "四", "五"];
const STAGE_BADGE = {
  entrance: "归寂", summoning: "请仙", verify: "验笔", inquiry: "问询", sendoff: "送仙", returned: "回位",
};
// 笔行段（drift）的徽章随仪式语义走：验笔之问用「验笔」，正式问询用「问询」（词条不另造词）
const driftBadge = (kind) => (kind === "verify" ? "验笔" : "问询");

export default function BixianGame({ apiKey, onKey, quota, onQuota, onExit }) {
  // apiKey / onKey / quota / onQuota 是既有注入缝（同猜拳的挂法），为回答器接入的后续票预留；
  // 本票答案为脚本目标字，全程零调用、不耗仙力。
  const engineRef = useRef(null);
  const trailRef = useRef(createTrail());
  const holdingRef = useRef(false);
  const inkVisibleRef = useRef(false); // 上一帧屏上是否还有墨：沥干后的首个空帧也要重绘一次，清掉最后一段笔迹
  const flashTimerRef = useRef(null);
  const lastQuestionRef = useRef(""); // 当前 drift 段的用户问题
  const driftKindRef = useRef(null); // verify | ask | send：当前 drift 段的仪式语义
  const [stage, setStage] = useState("entrance"); // entrance|summoning|verify|drift|inquiry|sendoff|returned
  const [questions, setQuestions] = useState([]); // 本局问事：{ q, answer, kind: verify|ask|stray }
  const [input, setInput] = useState("");
  const [flash, setFlash] = useState(null); // 落定/回位反馈条
  const [, setTick] = useState(0); // 帧驱动重绘

  const engine = engineRef.current;
  const phase = engine ? engine.phase : "idle";
  const askedCount = questions.filter((item) => item.kind === "ask").length;

  function flashOnce(label) {
    setFlash({ label });
    clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => setFlash(null), 2800);
  }

  // 相位迁移的界面反响（由帧循环回调；经 ref 持有以避免闭包拿到旧 stage）
  const handlePhaseRef = useRef(() => {});
  handlePhaseRef.current = (nextPhase, prevPhase) => {
    if (prevPhase === "summoning" && nextPhase === "ready") {
      setStage("verify");
      return;
    }
    if (nextPhase === "settled") {
      const { answer } = engineRef.current;
      const verifying = driftKindRef.current === "verify";
      flashOnce(verifying ? `仙至——验笔落『${answer.label}』` : `问毕——落定『${answer.label}』`);
      setQuestions((list) => [
        ...list,
        verifying
          ? { q: "你是笔仙吗？", answer: answer.label, kind: "verify" }
          : { q: lastQuestionRef.current, answer: answer.label, kind: "ask" },
      ]);
      setStage("inquiry");
      return;
    }
    if (nextPhase === "strayed") {
      // 防御分支：脚本目标字不会迷走，回答器接入（后续票）后才真正可达
      flashOnce("笔不肯落定——此问迷走");
      setQuestions((list) => [...list, { q: lastQuestionRef.current, answer: "迷走", kind: "stray" }]);
      setStage("inquiry");
      return;
    }
    if (nextPhase === "returned") {
      flashOnce("笔回位，仙已送走");
      setStage("returned");
    }
  };

  // 帧循环：推进引擎、采样笔迹、按需重绘（静置且墨干后停帧，交互立即恢复）
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (now) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min((now - last) / 1000, 0.25);
      last = now;
      const current = engineRef.current;
      if (current) {
        const prevPhase = current.phase;
        step(current, dt, PARAMS, { holding: holdingRef.current, mode: "loose", pointer: null });
        if (current.phase !== prevPhase) handlePhaseRef.current(current.phase, prevPhase);
        // 着墨以扶笔为准：扶笔（笔尖受压于纸）才留痕；脱手停驻只剩微颤，不添新墨
        if (holdingRef.current && current.phase !== "idle" && current.phase !== "returned") {
          trailSample(trailRef.current, now / 1000, current.pos.x, current.pos.y);
        }
      }
      pruneTrail(trailRef.current, now / 1000);
      const moving = current && !STILL_PHASES.has(current.phase)
        && (current.phase === "summoning" || holdingRef.current || Math.hypot(current.vel.x, current.vel.y) > 0.05);
      const hasInk = trailRef.current.samples.length > 0;
      if (moving || hasInk || inkVisibleRef.current) setTick((n) => n + 1);
      inkVisibleRef.current = hasInk;
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(flashTimerRef.current);
    };
  }, []);

  // —— 仪式指令 ——

  function beginSummon() {
    clearTimeout(flashTimerRef.current);
    const seed = ((Date.now() & 0xffff) ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
    const next = createDriftState({ rng: createRng(seed), personality: PERSONALITY });
    summon(next);
    engineRef.current = next;
    trailRef.current = createTrail();
    driftKindRef.current = null;
    lastQuestionRef.current = "";
    setQuestions([]);
    setInput("");
    setFlash(null);
    setStage("summoning");
  }

  function castVerify() {
    const current = engineRef.current;
    if (!current || stage !== "verify" || current.phase !== "ready") return;
    driftKindRef.current = "verify";
    ask(current, VERIFY_CELL); // 仪式脚本：固定落『勾』，不走回答器、不占问数
    setStage("drift");
  }

  function castQuestion(event) {
    event.preventDefault();
    const current = engineRef.current;
    const text = input.trim();
    if (!current || stage !== "inquiry" || !text || askedCount >= MAX_QUESTIONS) return;
    if (current.phase !== "settled" && current.phase !== "strayed") return;
    driftKindRef.current = "ask";
    lastQuestionRef.current = text;
    ask(current, pickScriptTarget(current.rng)); // 本票脚本目标字（随机预设），裁决接入是后续票
    setInput("");
    setStage("drift");
  }

  function castSendOff() {
    const current = engineRef.current;
    if (!current || stage !== "inquiry" || askedCount < 1 || (current.phase !== "settled" && current.phase !== "strayed")) return;
    driftKindRef.current = "send";
    sendOff(current);
    setStage("sendoff");
  }

  // —— 扶笔（宽松式：按压即扶、抬手脱手停驻；笔位从不跟随指针）———

  function grabHold(event) {
    event.currentTarget.setPointerCapture(event.pointerId);
    holdingRef.current = true;
    setTick((n) => n + 1);
  }

  function releaseHold() {
    holdingRef.current = false;
    setTick((n) => n + 1);
  }

  // —— 纸面渲染 ——

  const pos = engine ? engine.pos : PAPER.center;
  const buckets = trailBuckets(trailRef.current, performance.now() / 1000);
  const summonProgress = phase === "summoning" ? Math.min(1, engine.t / PARAMS.summonTime) : 0;
  const chantShown = CHANT_SUMMON.slice(0, Math.ceil((stage === "summoning" ? summonProgress : 1) * CHANT_SUMMON.length));
  const litCell = phase === "settled" && engine.answer?.type === "cell" ? engine.answer.key : null;
  const lit = litCell ? CELLS.find((cell) => cell.key === litCell) : null;
  const holdable = ["ready", "asking", "strayed", "sending"].includes(phase);
  const drifting = stage === "drift";
  const holding = holdingRef.current;

  return (
    <main className="bx-page wrap">
      <div className="bx-scene">
        <div className="bx-head">
          <button className="bx-back" onClick={onExit} aria-label="回大厅">×</button>
          <div><strong>笔仙</strong><span>ROOM 02 · 游戏室</span></div>
          <b className="bx-badge">{stage === "drift" ? driftBadge(driftKindRef.current) : STAGE_BADGE[stage]}</b>
        </div>
        <div className="bx-body">
          <div className="bx-paper-wrap">
            <svg className="bx-paper" viewBox="0 0 100 160" role="img" aria-label="笔仙纸面">
              <defs>
                {/* 渐变必须 userSpaceOnUse：竖直窄件的 objectBoundingBox 在零宽包围盒下不渲染（原型踩坑） */}
                <linearGradient id="bxPenBody" gradientUnits="userSpaceOnUse" x1="-1.8" y1="0" x2="1.8" y2="0">
                  <stop offset="0" stopColor="#241a10" />
                  <stop offset="0.42" stopColor="#8a6b3f" />
                  <stop offset="0.55" stopColor="#c9a266" />
                  <stop offset="1" stopColor="#2b2013" />
                </linearGradient>
              </defs>
              {CELLS.map((cell) => (
                <text key={cell.key} x={cell.x} y={cell.y} className={`bx-cell${litCell === cell.key ? " lit" : ""}`}>{cell.key}</text>
              ))}
              {lit && <circle cx={lit.x} cy={lit.y} r="7" className="bx-settle-ring" />}
              {buckets.map((bucket, index) => (
                <polyline
                  key={index} className="bx-ink"
                  points={bucket.points.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ")}
                  strokeWidth={bucket.width} strokeOpacity={bucket.opacity.toFixed(3)}
                />
              ))}
              <g transform={`translate(${pos.x.toFixed(3)} ${pos.y.toFixed(3)})`} className={`bx-pen${phase === "idle" ? " resting" : ""}`}>
                <ellipse className="bx-pen-shadow" cx="0" cy="0.9" rx="4.4" ry="1.4" />
                <g transform="rotate(-8)">
                  <polygon className="bx-pen-tip" points="0,0 -1.5,-4.4 1.5,-4.4" />
                  <rect className="bx-pen-ferrule" x="-1.9" y="-6" width="3.8" height="1.7" rx="0.5" />
                  <rect className="bx-pen-body" x="-1.8" y="-21" width="3.6" height="15.2" rx="1.4" fill="url(#bxPenBody)" />
                </g>
              </g>
              <rect
                className={`bx-hold${holdable ? "" : " inert"}`} x="0" y="0" width="100" height="160"
                onPointerDown={grabHold} onPointerUp={releaseHold} onPointerCancel={releaseHold}
              />
            </svg>
            {flash && <div className="bx-flash" key={flash.label}>{flash.label}</div>}
          </div>
          <aside className="bx-panel">
            {stage === "entrance" && (
              <div className="bx-card">
                <span className="bx-kicker">入局须知</span>
                <h2>夜静更深，铺纸请仙</h2>
                <p>一局之礼：请仙 → 验笔 → 问询 → 送仙 → 回位。至多五问，问毕必送，送必至回位。</p>
                <p>扶笔之法：按住纸面即扶笔，抬手笔自停驻；笔行于纸，不由人引。</p>
                <p className="bx-dim">戏中之事，纯属娱乐。</p>
                <button className="bx-primary" onClick={beginSummon}>点烛请仙 🕯️</button>
              </div>
            )}
            {stage === "summoning" && (
              <div className="bx-card">
                <span className="bx-kicker">请仙 · 口诀</span>
                <p className="bx-chant">「{chantShown}」</p>
                <div className="bx-progress"><div style={{ width: `${Math.round(summonProgress * 100)}%` }} /></div>
                <p className="bx-dim">口诀声中，凝神静候——笔杆微颤，仙将至矣。</p>
              </div>
            )}
            {stage === "verify" && (
              <div className="bx-card">
                <span className="bx-kicker">验笔 · 固定一问</span>
                <p className="bx-chant">「你是笔仙吗？」</p>
                <p className="bx-dim">以此一问验笔：笔落『勾』，即仙至。此问为礼，不占问数。</p>
                <button className="bx-primary" onClick={castVerify}>念出此问</button>
              </div>
            )}
            {stage === "drift" && (
              <div className="bx-card">
                <span className="bx-kicker">{driftKindRef.current === "verify" ? "验笔 · 笔行" : "问询 · 笔行"}</span>
                <p className="bx-chant">「{driftKindRef.current === "verify" ? "你是笔仙吗？" : lastQuestionRef.current}」</p>
                <p className="bx-dim">{holding ? "扶笔勿离——笔自运行，蓄势而动，渐近乃止。" : "笔已停驻——按住纸面，续扶此笔。"}</p>
              </div>
            )}
            {stage === "inquiry" && (
              <div className="bx-card">
                <span className="bx-kicker">问询 · 第 {CN_NUM[Math.min(askedCount, MAX_QUESTIONS - 1)]} 问</span>
                {askedCount >= MAX_QUESTIONS ? (
                  <React.Fragment>
                    <p>五问已满，问事当毕。</p>
                    <button className="bx-primary" onClick={castSendOff}>送仙回位</button>
                  </React.Fragment>
                ) : (
                  <form className="bx-ask" onSubmit={castQuestion}>
                    <input
                      value={input} onChange={(event) => setInput(event.target.value)} maxLength={40}
                      placeholder="心中所问，落于纸上" aria-label="欲问之事"
                    />
                    <div className="bx-ask-row">
                      <button type="submit" className="bx-primary" disabled={!input.trim()}>落笔发问</button>
                      {askedCount >= 1 && <button type="button" className="bx-ghost" onClick={castSendOff}>就此送仙</button>}
                    </div>
                    <small className="bx-dim">尚可问 {CN_NUM[MAX_QUESTIONS - askedCount - 1]} 问 · 纸面自答：是否、一至十、唐宋元明清、男女</small>
                  </form>
                )}
                {questions.some((item) => item.kind !== "verify") && (
                  <div className="bx-log">
                    {questions.filter((item) => item.kind !== "verify").map((item, index) => (
                      <div key={`${index}-${item.q}`}><span>问{CN_NUM[index]}</span><em>{item.q}</em><b>{item.answer}</b></div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {stage === "sendoff" && (
              <div className="bx-card">
                <span className="bx-kicker">送仙 · 口诀</span>
                <p className="bx-chant">「{CHANT_SENDOFF}」</p>
                <p className="bx-dim">{holding ? "扶笔相送——笔回纸心，停稳即回位。" : "按住纸面扶笔，随笔回位。"}</p>
              </div>
            )}
            {stage === "returned" && (
              <div className="bx-card">
                <span className="bx-kicker">回位 · 归寂</span>
                <p className="bx-chant">仙已送回，纸面归寂。</p>
                <p className="bx-dim">笔迹与问事随烟而散，不留于纸。</p>
                <div className="bx-ask-row">
                  <button className="bx-primary" onClick={beginSummon}>再请一局</button>
                  <button className="bx-ghost" onClick={onExit}>回大厅</button>
                </div>
              </div>
            )}
          </aside>
        </div>
        {drifting && !holding && <div className="bx-hint">笔已停驻 · 按住纸面续扶</div>}
      </div>
    </main>
  );
}
