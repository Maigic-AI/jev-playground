import React from "react";

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

export default function GameHome({ navigate }) {
  return (
    <main>
      <section className="hero wrap">
        <div className="hero-copy">
          <span className="eyebrow">ROOM 02 · 游戏室</span>
          <h1>让 Jev 坐进<em>驾驶舱</em></h1>
          <p>60 FPS 的物理交给代码，Jev 只当大脑：每隔约 200ms 拿到整理好的路况状态，用一次 Choice 决定晚刹、保位还是强钻内线。不总是选概率最高的那个动作，它就会跑出不一样的比赛故事。</p>
          <div className="cta-row">
            <button className="next-button" onClick={() => navigate("/quiz")}>先去做题室玩 →</button>
          </div>
        </div>
        <div className="hero-orbit" aria-hidden="true">
          <div className="orbit-card orbit-one"><strong>5<small>Hz</small></strong><span>Jev 的决策频率</span></div>
          <div className="orbit-card orbit-two"><strong>60<small>FPS</small></strong><span>物理引擎的帧率</span></div>
          <div className="spark spark-a">🏁</div><div className="spark spark-b">✦</div>
        </div>
      </section>

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
