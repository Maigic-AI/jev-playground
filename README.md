# Jev Playground

一个「只会做选择的 AI 实验室」：Jev 不生成文字，只输出选择、分数与概率。这里把它的概率判断做成一系列小实验。做题室与游戏室均已开放。

由 [Maigic](https://maigic.top) 出品 · GitHub：[@Maigic-AI](https://github.com/Maigic-AI)

## 站点结构

- `/` 主页：介绍 Jev Playground 的想法、Choice / Score / Noul 三种问题类型与各房间入口
- `/quiz` 做题室：选择题库后，Jev 自动逐题选择，题库原算法负责计算最终结果，并把每题概率与运行记录保存在当前浏览器中
- `/game` 游戏室：已开放「猜拳」（人机对战 / Jev 对 Jev 模拟）与「笔仙」（请仙问答，完整仪式闭环），并保留排队中的实验企划（性格赛车、狼人杀、德州扑克）

前端为 React SPA，使用 History API 路由（无路由依赖），生产环境由 Express 提供 SPA fallback。

## 做题室功能

- SBTI：30 题、27 种娱乐性人格
- 16 型人格：40 题或 93 题，中英双语，可分别保存结果观察语言差异
- 8values：70 题，中英双语
- 一键让 Jev 自动完成整套题；大题库自动分批并行请求
- 保存每题选择、完整概率、置信度、耗时、模型版本与 token 用量
- 可以重复运行同一题库，或分别运行中英文题库观察差异
- 标准计分在浏览器本地完成
- 人工作答模式保留为可选对照
- 测试草稿和结果保存在 `localStorage`
- 不填 key 可直接使用站方共享的默认 API（每日全站共享限额，页面会显示当日剩余次数）；自己的 API key 仅保存在页面内存，通过同源代理发送，不进入本地记录
- 响应式手机界面

## 游戏室功能

### 猜拳（✊✋✌️）

- 三种 Jev 选手配置：**随机**（本地均匀随机，不调用 API、不耗配额，作为基线）、**近3回合** / **近5回合**（把双方最近 N 回合的出招与预计算频次放进 state，由 Jev 一次 Choice 决策）
- 人机对战：点击出招后播放摇拳动画并揭晓，展示 Jev 本回合的完整概率分布、首选与置信度
- Jev 对 Jev 模拟：任选两个配置对决，局次可选（预设 10/20/50/100，自定义最多 200），播放速度可调，可随时停止
- 出招策略可切换：**按概率抽样**（默认，同一局面也会出不同的招）或**总取最优**（argmax）
- 两个 Jev 对战时，每回合的两个决策合并为**一次 API 调用**（两个问题共享同一份 state），配额消耗减半
- 战绩板：每种配置的出招比例、胜负平与胜率在 `localStorage` 跨会话累计（key `jev-pop-lab:rps-stats:v1`），配置战绩跨人机与模拟两种模式合并统计，可两步确认清零
- 请求失败时：人机对战可重试本回合、随机代打一手或结束回大厅；模拟会暂停，可重试本轮或停止，连续 3 次失败自动停止；共享默认 API 的配额守卫与做题室一致

### 笔仙（🕯️）

- 完整的传统仪式闭环：**请仙**（口诀字幕代念、笔杆微颤）→ **验笔**（固定一问「你是笔仙吗」，笔落「勾」即仙至）→ **问询**（每局 1–5 问）→ **送仙**（口诀、笔回纸心）→ **回位**归寂（笔在纸心 3.5u 内停稳即回位，与落定同为**停留式**判定，因此送仙的回程耗时是有界的）
- 笔的漂移按观念运动效应的物理结构模拟：低阻尼、环行吸引子、双向噪声、蓄势、渐近与收势；蓄势期先无目的画圈，末段减速收圈方才落定。**笔位从不跟随指针**，扶笔只是闸门——「不是我在控制笔」是体验核心
- **漂移性格**：请仙时随机择一档（一问落定的中位耗时约 6s 的急躁 / 约 8s 的沉稳 / 约 9s 的飘忽，含最躁的笔势实测最坏 9.6s、不过 10s——三档的耗时窗由测试守着），一局之内不变、重开新局重新随机。三档的差别在笔的行为而不在文案——起速、环心游走、噪声、迟迟不落——**永不点名，界面无任何提示文案**
- **扶笔两式**：**严格**（默认，指尖离笔逾 15u 即脱手、随笔而行）与**宽松**（按压即扶，易用 / 无障碍开关）；脱手则笔停驻、全部计时冻结，重扶从停点无缝继续。**共振放大**（指尖偏移成为笔的扰动力）可选、默认关
- 落定判定为**停留式**（笔在某字上停留满 1.0s——随漂移性格略有长短：急躁 0.8s / 沉稳 1.0s / 飘忽 1.2s）；答案按传统四边布局：勾叉是否、数字一至十、唐宋元明清、男女
- **笔势**（静 / 躁 / 怒）叠在漂移性格之上：问审越界转躁、触禁忌问法升怒，随局持续、回位或再请一局才归静；只叠扰动增量，不换当局性格
- **回答器只裁决类别、不生成言语**（见 [ADR-0001](./docs/adr/0001-bixian-responder-classifies-only.md)）：一次调用含两个 choice（问审可否答 + 落定何字）；伦理越界与禁忌问法一律**迷走**（约 7s 的失准乱笔）且不占本局问数，同一局内同问同答
- 仙力（全站共享的每日配额）竭尽或调用失败时退回**随机天意**，以灵异文案明示「灵力不济、笔迹失准」，仪式仍可完整走完；自带 key 优先用自己的灵力
- **问事录**仅内存态：问询中随时可展开回看，回位即焚、不留任何落盘痕迹；未回位而离场只留一个会话级「仙未离去」记号（不含问事录内容、不写持久存储），重进时警示并可**补行送仙**
- 扰动以「克制的神秘」为界：常驻微晃、落定爆发与烛光骤暗；震动仅在扶笔时发出，无 Vibration API 的机器以同步脉冲环补偿；系统「减弱动态效果」下全档降级为静态氛围
- 局终呈现**观念运动效应科普**折叠块与「本游戏纯属娱乐」免责声明；局内文案全用仪式语汇，不出现 Jev / AI / 模型 / 配额等现代词汇

## 项目结构

```
src/
  lib/      纯逻辑：猜拳规则与战绩统计、笔仙漂移引擎 / 回答器 / 笔迹 / 扰动 / 纸面 / 会话记号
            （全部无 DOM、无计时器，node --test 直接可测）
  pages/    页面组件：主页 / 做题室 / 游戏室大厅与猜拳、笔仙
shared/     Express 与 Worker 共用的请求校验、TypeSafe SDK 调用与默认 key 配额策略
server/     本地 Express 开发与生产服务（SPA fallback）
worker/     Cloudflare Worker（/api/system-one、/api/quota，配额存 Durable Object）
test/       node:test 单测（130 项，npm test）
```

统计记录函数（`src/lib/rps-stats.js`）设计为纯函数：它们会被当作 `setState(prev => …)` 的 updater 调用，React StrictMode 在开发模式下会重复调用 updater，不纯的写入会被记双倍。

## 开发

需要 Node.js 20 或更高版本。

```bash
npm install
npm run dev
```

打开 <http://127.0.0.1:5173>。

## 构建与生产运行

```bash
npm run build
npm start
```

`dist/` 为构建产物，已加入 `.gitignore` 不入库；`npm run deploy` 部署前会重新构建。

生产服务默认监听 `127.0.0.1:5173`，可通过 `PORT` 修改端口。

## 部署到 Cloudflare

站点部署为 Cloudflare Workers + 静态资源（`wrangler.jsonc`）：`dist/` 由资源绑定直接下发（未命中的路由回落到 `index.html`，SPA 路由可用），`/api/system-one` 与 `/api/quota` 由 `worker/index.mjs` 处理，与本地 Express 服务共享 `shared/` 下的校验、TypeSafe SDK 调用与默认 key 配额策略。

访客不填 key 时，代理会改用站方共享的默认 API key（`JEV_API` secret，只存在于服务端，前端与仓库中均不可见），并施加**每日全站共享的调用限额**（`JEV_DAILY_LIMIT`，默认 500，北京时间每日 0 点重置，只有成功调用才计数；配额计数存放在 Durable Object 中，改限额无需迁移）。访客自带 key 的请求不受配额限制。

```bash
npx wrangler login            # 首次需要，浏览器授权
npx wrangler secret put JEV_API   # 配置站方默认 key（只存服务端，不进仓库）
npm run deploy                # 构建 + wrangler deploy
```

修改每日限额：改 `wrangler.jsonc` 中 `vars.JEV_DAILY_LIMIT` 后重新 `npm run deploy`（或在 Cloudflare Dashboard → Worker → Settings → Variables 中直接改，即时生效）。

本地按 Worker 方式预览（端口 8787；secret 与变量从 `.dev.vars` 读取，模板见 `.dev.vars.example`，已被 .gitignore 忽略）：

```bash
cp .dev.vars.example .dev.vars   # 填入 JEV_API，可把 JEV_DAILY_LIMIT 调小便于测试
npm run cf:dev
```

本地 Express（`npm run dev`）走同样的策略：从 `.env` 读取 `JEV_API` / `JEV_DAILY_LIMIT`，配额为进程内计数（重启即重置；生产以 Worker 的 Durable Object 为准）。

## 测试

```bash
npm test
npm run build
```

原有的命令行 Jev 样例仍然保留：

```bash
npm run test:api
npm run personality
npm run demo
```

## 许可证

本项目代码采用 [MIT License](./LICENSE) 开源。第三方题库的来源与许可证单独见 [THIRD_PARTY.md](./THIRD_PARTY.md)。

测试结果仅供娱乐，不是心理测量、医学诊断、招聘建议或政治身份判断。
