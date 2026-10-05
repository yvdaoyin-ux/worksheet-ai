# AGENTS.md — WorksheetAI

> 给任何接手本项目的 AI agent / 人的**一句话导航 + 硬规矩**。
> 完整交接资料在桌面文件夹 **`C:\Users\fa'r\Desktop\worksheet-ai-交接\`**（先读 `00-先读我.md`）。

## 这是什么

面向**北美 homeschool 家长/K–5 老师**的 **AI 练习纸生成器**（网页）。主打**数学**（真实图形：数轴/分数条/十格板/竖式）。
- 线上：https://worksheet-ai-l1td.vercel.app
- 代码：本目录（`worksheet-ai/`）
- 收款：Gumroad（$9.90 → 折扣码 `LAUNCH30` → 实付 **$6.93**）
- AI：Groq（主）+ OpenRouter（备）；密钥在 `.env` / Vercel 环境变量

## 硬规矩（改代码前必看）

1. **根目录绝不能有 `server.js`，`package.json` 不能有 `start` 脚本**——否则 Vercel 会把项目当 Node 服务器，所有页面 404。（本地服务器叫 `dev-server.js`。）
2. **改了 `app.css`/`app.js` → 必须 bump 前端版本号 `?v=N`**（当前 v=15），否则用户吃旧缓存。改 `index.html`/`generator` 后：
   `sed -i 's|/app\.css?v=15|/app.css?v=16|g; s|/app\.js?v=15|/app.js?v=16|g' index.html privacy.html terms.html og-card.html scripts/gen-seo.js && node scripts/gen-seo.js`
3. **`git push` 走代理会偶发 TLS 失败** → `git config --local http.sslBackend openssl` + **失败重试几次**。
4. **改 Vercel 环境变量 / `api/*.js` → 要 Redeploy。**
5. **别把密钥**写进代码或提交 `.env`。
6. 本地跑要带代理：`NODE_USE_ENV_PROXY=1 HTTPS_PROXY=http://127.0.0.1:7890 node dev-server.js`（`NODE_USE_ENV_PROXY` **必须在启动时设**）。
7. **不用** html2canvas/jspdf 导 PDF；**不加**具体 CCSS 代码。

## 关键文件

`index.html` / `app.css` / `app.js`（前端）｜ `api/generate.js`（AI，按科目分发 + 多供应商 + `looksComplete` 校验 + 按 IP 限流）/ `api/verify-license.js` / `api/health.js`（诊断）/ `api/track.js`（埋点）/ `api/subscribe.js`（邮箱）｜ `dev-server.js`（本地）｜ `scripts/gen-seo.js`（60 落地页）｜ `vercel.json`。

## 变现相关常量（改前想清楚）

- 免费额度：`app.js` 的 `FREE_DAILY_LIMIT = 1`、`FREE_TOTAL_LIMIT = 3`（每日 1 份 + 终身 3 份，先到先得）。别再调回"2 份/天"——那正好覆盖家长的真实日用量，等于没有付费理由。
- 单题 🔄 重写是 **Pro 专属**（消耗 AI 成本）；✏️ 编辑免费。判断在 `makeTools()`。
- 价格数字散落在 `index.html` + `scripts/gen-seo.js`（搜 `$6.93`），Gumroad 那边是另一处，**改价必须三处同步**。

## 详细资料

桌面 `worksheet-ai-交接\`：
`00-先读我` / `01-项目总览` / `02-架构与代码` / `03-关键决策与坑`(⭐) / `04-运维手册` / `05-路线图与待办` / `06-宣发与市场` / `07-资料与对话记录位置` / `项目记忆.md` / `对话记录/`。
