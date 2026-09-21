import React from "react";

export default function PlaygroundHome({ navigate }) {
  return (
    <main>
      <section className="hero wrap">
        <div className="hero-copy">
          <span className="eyebrow">JEV PLAYGROUND · 只会做选择的 AI 实验室</span>
          <h1>一个<em>不会说话</em>的 AI，<br />能玩出什么？</h1>
          <p>Jev 是 TypeSafe 的 System One 模型：它不生成文字，而是针对一段状态同时回答成组的固定问题，输出选择、分数、判断——以及每一项的概率。这里是把它当玩具的实验场。</p>
          <div className="cta-row">
            <button className="next-button" onClick={() => navigate("/quiz")}>进入做题室 →</button>
            <button className="back-button" onClick={() => navigate("/game")}>逛逛游戏室</button>
          </div>
        </div>
        <div className="hero-orbit" aria-hidden="true">
          <div className="orbit-card orbit-one"><strong>81<small>%</small></strong><span>它对答案的确定程度</span></div>
          <div className="orbit-card orbit-two"><strong>70<small>ms</small></strong><span>一次判断的延迟</span></div>
          <div className="spark spark-a">✦</div><div className="spark spark-b">✿</div>
        </div>
      </section>

      <section className="wrap section-block">
        <div className="section-heading">
          <div><span className="eyebrow">HOW IT WORKS</span><h2>它只会三件事</h2></div>
          <span className="count-pill">Choice · Score · Noul</span>
        </div>
        <div className="test-grid">
          <article className="test-card coral">
            <div className="card-top"><span className="card-number">01</span><span className="card-emoji">🎯</span></div>
            <div><h3>Choice</h3><p>在你给定的选项里挑一个，同时为每个选项给出概率。</p></div>
            <div className="choice-demo" aria-hidden="true">
              <div><span>A</span><i><b style={{ width: "3%" }} /></i><em>3%</em></div>
              <div><span>B</span><i><b style={{ width: "81%" }} /></i><em>81%</em></div>
              <div><span>C</span><i><b style={{ width: "12%" }} /></i><em>12%</em></div>
              <div><span>D</span><i><b style={{ width: "4%" }} /></i><em>4%</em></div>
            </div>
          </article>
          <article className="test-card violet">
            <div className="card-top"><span className="card-number">02</span><span className="card-emoji">📏</span></div>
            <div><h3>Score</h3><p>在一条有序标尺上打分，适合程度、强度与倾向。</p></div>
            <div className="scale-demo" aria-hidden="true">
              <div className="scale-track"><i style={{ left: "70%" }} /></div>
              <div className="scale-marks"><span>1</span><span>2</span><span>3</span><span>4</span><span>5</span></div>
              <em>3.8 / 5 · 置信度 76%</em>
            </div>
          </article>
          <article className="test-card lime">
            <div className="card-top"><span className="card-number">03</span><span className="card-emoji">⚖️</span></div>
            <div><h3>Noul</h3><p>把任何问题压成一个是 / 否的概率判断。</p></div>
            <div className="noul-demo" aria-hidden="true">
              <div className="noul-split"><i style={{ width: "72%" }}>是 72%</i><b>否 28%</b></div>
              <em>「这段文字在讲反话吗？」</em>
            </div>
          </article>
        </div>
      </section>

      <section className="wrap section-block">
        <div className="section-heading">
          <div><span className="eyebrow">THE ROOMS</span><h2>实验室的房间</h2></div>
        </div>
        <div className="test-grid">
          <article className="test-card coral" style={{ "--delay": "0ms" }}>
            <div className="card-top"><span className="card-number">ROOM 01</span><span className="card-emoji">📝</span></div>
            <div><h3>做题室</h3><p>让 Jev 独自做完 MBTI、8values、SBTI，逐题记录选择、概率与置信度；也可以自己作答对照。</p></div>
            <div className="card-bottom"><span className="status-pill open">● 开放中</span></div>
            <div className="card-actions">
              <button className="auto-action" onClick={() => navigate("/quiz")}>进去做题 <span>→</span></button>
            </div>
          </article>
          <article className="test-card violet" style={{ "--delay": "70ms" }}>
            <div className="card-top"><span className="card-number">ROOM 02</span><span className="card-emoji">🕹️</span></div>
            <div><h3>游戏室</h3><p>给 Jev 一个方向盘、一手牌或一个狼人身份——物理交给代码，判断交给它。</p></div>
            <div className="card-bottom"><span className="status-pill soon">◌ 规划中</span></div>
            <div className="card-actions">
              <button className="auto-action" onClick={() => navigate("/game")}>看看企划 <span>→</span></button>
            </div>
          </article>
          <article className="test-card lime" style={{ "--delay": "140ms" }}>
            <div className="card-top"><span className="card-number">SOON</span><span className="card-emoji">💡</span></div>
            <div><h3>点子间</h3><p>把聊天记录丢给 Jev 看它怎么看你、只回概率的恋爱军师、AI 能力雷达图……持续孵化中。</p></div>
            <div className="card-bottom"><span className="status-pill soon">◌ 孵化中</span></div>
            <div className="card-actions">
              <button className="auto-action" disabled>敬请期待 <span>⌛</span></button>
            </div>
          </article>
        </div>
      </section>

      <section className="wrap section-block manifesto-block">
        <blockquote className="manifest">
          <span className="mini-label">PLAYGROUND MANIFESTO</span>
          <p>它不是告诉你一个答案，<br /><em>而是给你看它到底有多确定。</em></p>
        </blockquote>
      </section>
    </main>
  );
}
