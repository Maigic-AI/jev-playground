# Jev Playground

一个「只会做选择的 AI 实验室」：Jev 不生成文字，只输出选择、分数与概率。这里把它的概率判断做成一系列小实验。做题室与游戏室均已开放。

由 [Maigic](https://maigic.top) 出品 · GitHub：[@Maigic-AI](https://github.com/Maigic-AI)

## 站点结构

- `/` 主页：介绍 Jev Playground 的想法、Choice / Score / Noul 三种问题类型与各房间入口
- `/quiz` 做题室：选择题库后，Jev 自动逐题选择，题库原算法负责计算最终结果，并把每题概率与运行记录保存在当前浏览器中
- `/game` 游戏室：第一个游戏「猜拳」已开放（人机对战 / Jev 对 Jev 模拟），并保留排队中的实验企划（性格赛车、狼人杀、德州扑克）

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
- 请求失败时可重试本回合、随机代打一手或结束；共享默认 API 的配额守卫与做题室一致

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
