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

## 变现规则（承诺过的，别乱动 ⚠️）

用户已对外承诺过，**以下两条不许擅自改**：
1. **免费额度 = 每天 2 份**（`app.js` 的 `FREE_DAILY_LIMIT = 2`）。
2. **价格 = $9.90，折扣码 `LAUNCH30` → 实付 $6.93**（一次性）。

在此之上的分层（当前实现）：
- **免费**：每天 2 份 **Math** + 每天 **1 次**其他科目的"体验"（`FREE_OTHER_DAILY = 1`）。非 Math 科目在下拉里标 `(Pro)`。
- **Pro**：8 个科目全开、无数量限制、无水印 —— $6.93 买断（现有 Gumroad 产品）。
- **Pro 月付**（用户已同意做）：`app.js` 的 `PRO_MONTHLY_URL`（**当前是占位店铺首页，拿到 Gumroad 订阅产品链接后替换；置空则按钮自动隐藏**）与 `PRO_MONTHLY_LABEL`（价格文案，默认 `$4.99/month`，**必须与实际一致**）。
- 单题 🔄 重写**免费且不耗额度**（已恢复，别再改成 Pro 专属）；✏️ 编辑同样免费。
- 价格数字散落在 `index.html` + `scripts/gen-seo.js`（搜 `$6.93`），Gumroad 是第三处，**改价必须三处同步**。
- 订阅产品开好后：把它的 `product_id` 追加进 Vercel 环境变量 `GUMROAD_PRODUCT_ID`（**支持逗号分隔多个**，见 `api/verify-license.js`），否则月付用户的 key 校验不过。

## 详细资料

桌面 `worksheet-ai-交接\`：
`00-先读我` / `01-项目总览` / `02-架构与代码` / `03-关键决策与坑`(⭐) / `04-运维手册` / `05-路线图与待办` / `06-宣发与市场` / `07-资料与对话记录位置` / `项目记忆.md` / `对话记录/`。
