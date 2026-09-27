import React, { useState } from "react";
import RpsGame from "./game-rps.jsx";
import BixianGame from "./game-bixian.jsx";
import { CONFIGS, MOVE_CN } from "../lib/rps.js";
import { readRpsStats, resetRpsStats } from "../lib/rps-stats.js";

const experiments = [
  {
    number: "01",
    emoji: "🏎️",
    color: "coral",
    title: "性格赛车大奖赛",
    description: "8 个性格完全不同的 Jev 车手同场竞技：激进型强钻内线，保守型保护轮胎，赌徒型晚刹到极限。同一赛道跑 100 圈，统计各自的胜率与碰撞率。",
    status: "原型设计中",
  },
  {
    number: "02",
    emoji: "🐺",
    color: "violet",
    title: "狼人杀",
    description: "Jev 当村民：每个白天输出一张概率板——P(A 是狼) 41%、P(B 是狼) 22%……看它能不能靠纯概率活到决赛圈。",
    status: "构想中",
  },
  {
    number: "03",
    emoji: "🃏",
    color: "lime",
    title: "德州扑克",
    description: "代码负责算牌力与底池赔率，Jev 负责读局势：fold、call、raise-small、raise-large，每次下注都是一次 Choice。",
    status: "构想中",
  },
];

const DISPLAY_ORDER = ["rock", "scissors", "paper"];

export default function GameHome({ navigate, apiKey, onKey, quota, onQuota }) {
  const [view, setView] = useState("hub");
  const [mode, setMode] = useState("human");
  const [stats, setStats] = useState(readRpsStats);

  if (view === "rps") {
    return (
      <RpsGame
        mode={mode}
        onMode={setMode}
        apiKey={apiKey}
        onKey={onKey}
        quota={quota}
        onQuota={onQuota}
        onStats={setStats}
        onExit={() => setView("hub")}
      />
    );
  }

  if (view === "bixian") {
    return (
      <BixianGame
        apiKey={apiKey}
        onKey={onKey}
        quota={quota}
        onQuota={onQuota}
        onExit={() => setView("hub")}
      />
    );
  }

  return (
    <main>
      <section className="hero wrap">
        <div className="hero-copy">
          <span className="eyebrow">ROOM 02 · 游戏室</span>
          <h1>开赛第一局，<br /><em>猜拳</em></h1>
          <p>精确的计数交给代码：双方最近几回合出了什么、频率多少，全部预先算好放进 state。Jev 只做一件事——用一次 Choice 决定下一掷，而我们按它给的概率抽样，不总选最高的那个。</p>
          <div className="cta-row">
            <button className="next-button" onClick={() => { setMode("human"); setView("rps"); }}>和人机猜拳 →</button>
            <button className="back-button" onClick={() => { setMode("sim"); setView("rps"); }}>看 Jev 对 Jev 模拟</button>
          </div>
        </div>
        <div className="hero-orbit" aria-hidden="true">
          <div className="orbit-card orbit-one"><strong>3<small>种</small></strong><span>Jev 选手配置</span></div>
          <div className="orbit-card orbit-two"><strong>1<small>次</small></strong><span>Choice 决定一掷</span></div>
          <div className="spark spark-a">✊</div><div className="spark spark-b">✦</div>
        </div>
      </section>

      <section className="wrap section-block">
        <div className="section-heading">
          <div><span className="eyebrow">NOW PLAYING</span><h2>正在开放</h2></div>
          <span className="count-pill">2 个游戏</span>
        </div>
        <article className="rps-feature lime">
          <div className="card-top"><span className="card-number">RPS</span><span className="card-emoji">✌️</span></div>
          <div>
            <h3>猜拳 Rock · Paper · Scissors</h3>
            <p>三种 Jev 配置任选对决：随机基线、只看最近 3 回合、看最近 5 回合。可以亲自上手，也可以让两个配置打一场几百回合的模拟，看谁的概率更能抓住对方的规律。</p>
            <div className="rps-feature-chips">
              {CONFIGS.map((config) => <span key={config.id} className="detail-pill">{config.emoji} {config.name}：{config.note}</span>)}
            </div>
          </div>
          <div className="card-actions">
            <button className="auto-action" onClick={() => { setMode("human"); setView("rps"); }}>人机对战 <span>✊</span></button>
            <button className="manual-action" onClick={() => { setMode("sim"); setView("rps"); }}>Jev 对 Jev</button>
          </div>
        </article>
        <article className="rps-feature bx-feature" style={{ marginTop: "20px" }}>
          <div className="card-top"><span className="card-number">夜半 · 笔仙</span><span className="bx-feature-seal" aria-hidden="true">问<br />事</span></div>
          <div>
            <h3><span className="bx-feature-title">笔仙</span> · 烛下问事</h3>
            <p>灯花未落，纸上已有回音。铺一张旧纸，扶一支墨笔，请仙问事。至多五问，扶而不引，问毕必送。</p>
          </div>
          <div className="card-actions">
            <button className="auto-action" onClick={() => setView("bixian")}>入局请仙 <span>↗</span></button>
          </div>
        </article>
      </section>

      <StatsBoard stats={stats} onReset={() => setStats(resetRpsStats())} />

      <section className="wrap section-block">
        <div className="section-heading">
          <div><span className="eyebrow">EXPERIMENTS</span><h2>排队中的实验</h2></div>
          <span className="count-pill">{experiments.length} 个企划</span>
        </div>
        <div className="test-grid">
          {experiments.map((item, index) => (
            <article className={`test-card ${item.color}`} key={item.title} style={{ "--delay": `${index * 70}ms` }}>
              <div className="card-top"><span className="card-number">{item.number}</span><span className="card-emoji">{item.emoji}</span></div>
              <div><h3>{item.title}</h3><p>{item.description}</p></div>
              <div className="card-bottom"><span className="status-pill soon">◌ {item.status}</span></div>
              <div className="card-actions">
                <button className="auto-action" disabled>敬请期待 <span>⌛</span></button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="wrap section-block manifesto-block">
        <blockquote className="manifest tint-lime">
          <span className="mini-label">WHY GAMES</span>
          <p>精确的交给代码，<br /><em>模糊的才交给判断。</em></p>
        </blockquote>
      </section>
    </main>
  );
}

function sideTotal(side) {
  return side.win + side.lose + side.draw;
}

function StatsBoard({ stats, onReset }) {
  const [confirming, setConfirming] = useState(false);
  const rows = [{ id: "human", name: "你（人机对战）", side: stats.human }, ...CONFIGS.map((config) => ({ id: config.id, name: `${config.emoji} ${config.name}`, side: stats.configs[config.id] }))];
  const played = rows.reduce((sum, row) => sum + sideTotal(row.side), 0);
  const matchups = Object.entries(stats.matchups).filter(([, matchup]) => matchup.rounds > 0);
  const configName = (id) => CONFIGS.find((config) => config.id === id)?.name || id;

  function reset() {
    if (!confirming) {
      setConfirming(true);
      setTimeout(() => setConfirming(false), 3000);
      return;
    }
    setConfirming(false);
    onReset();
  }

  return (
    <section className="wrap section-block">
      <div className="section-heading">
        <div><span className="eyebrow">RPS RECORDS</span><h2>战绩板</h2></div>
        {played > 0 ? (
          <button className={`back-button stats-reset ${confirming ? "confirming" : ""}`} onClick={reset}>{confirming ? "确认清空？" : "重置战绩"}</button>
        ) : <span className="count-pill">累计 {played} 回合</span>}
      </div>
      {played === 0 ? (
        <div className="empty-state"><span>✊</span><p>还没有出过手。战绩会在浏览器本地累计，跨模式统计每种配置的出招比例与胜率。</p></div>
      ) : (
        <div className="rps-stats-board">
          {rows.map((row) => {
            const total = sideTotal(row.side);
            return (
              <article key={row.id} className="rps-stats-row">
                <strong className="rps-stats-name">{row.name}</strong>
                <div className="rps-stats-bars">
                  {DISPLAY_ORDER.map((move) => (
                    <div key={move} className="rps-stats-bar">
                      <span>{MOVE_CN[move]}</span>
                      <i><b style={{ width: `${total ? Math.round(row.side.moves[move] / total * 100) : 0}%` }} /></i>
                      <em>{total ? `${Math.round(row.side.moves[move] / total * 100)}%` : "—"}<small> ({row.side.moves[move]})</small></em>
                    </div>
                  ))}
                </div>
                <div className="rps-stats-record">
                  <span>胜 {row.side.win} · 负 {row.side.lose} · 平 {row.side.draw}</span>
                  <b>{total ? `${Math.round(row.side.win / total * 100)}%` : "—"}<small> 胜率</small></b>
                </div>
              </article>
            );
          })}
          {matchups.length > 0 && (
            <div className="rps-matchups">
              {matchups.map(([key, matchup]) => {
                const [aId, bId] = key.split(":");
                return <span key={key} className="round-chip">{configName(aId)} {matchup.aWin} : {matchup.bWin} {configName(bId)} · 平 {matchup.draw} · 共 {matchup.rounds} 回合</span>;
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
