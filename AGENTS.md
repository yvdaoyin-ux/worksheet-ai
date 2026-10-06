# AGENTS.md — WorksheetAI

> 给任何接手本项目的 AI agent / 人的**一句话导航 + 硬规矩**。
> 完整交接资料在桌面文件夹 **`C:\Users\fa'r\Desktop\worksheet-ai-交接\`**（先读 `00-先读我.md`）。
> **变现改造（v15→v19）的增量交接包在 `C:\Users\fa'r\Desktop\worksheet-ai-交接-20261005\`**（先读它的 `00-先读我.md`）——改价格/档位/收款相关的东西**必须先看这个**。

## 这是什么

面向**北美 homeschool 家长/K–5 老师**的 **AI 练习纸生成器**（网页）。主打**数学**（真实图形：数轴/分数条/十格板/竖式）。
- 线上：https://worksheet-ai-l1td.vercel.app
- 代码：本目录（`worksheet-ai/`）
- 收款：Gumroad（$19 → 折扣码 `LAUNCH30` → 实付 **$13.30**）
- AI：Groq（主）→ OpenRouter（免费备）→ **DeepSeek V4.1 Flash（付费兜底，模型名 `deepseek-flash`，2026-09-10 起；旧名 `deepseek-v4-flash` 保留为第二尝试）**。链路顺序由 `buildAttempts()` 决定，三个密钥都在 `.env` / Vercel 环境变量（`GROQ_API_KEY` / `OPENROUTER_API_KEY` / `DEEPSEEK_API_KEY`，可选 `DEEPSEEK_MODEL` 覆盖）。**没有 `DEEPSEEK_API_KEY` 时兜底不生效**（`/api/health` 的 `deepseek:false`）。链路顺序测试：`node _bench/test_fallback_chain.cjs`

## 硬规矩（改代码前必看）

1. **根目录绝不能有 `server.js`，`package.json` 不能有 `start` 脚本**——否则 Vercel 会把项目当 Node 服务器，所有页面 404。（本地服务器叫 `dev-server.js`。）
2. **改了 `app.css`/`app.js` → 必须 bump 前端版本号 `?v=N`**（当前 **v=41**；**bump 完请顺手回来把这个数字也改掉**），否则用户吃旧缓存。要同步的文件：`index.html`、`privacy.html`、`terms.html`、`scripts/gen-seo.js`（后者改完要 `node scripts/gen-seo.js` 重生成 60 页）。**用 Edit 工具改**（别用 PowerShell `Get-Content`，见第 8 条）。**bump 后必须打印每个文件的替换计数核对**——2026-10-06 发生过一次"replace 的旧号不存在 → 静默落空 → 提交信息虚报版本"的事故；另外 bump 改的是 `index.html` 等**源文件**，60 个落地页要靠重跑 `gen-seo.js` 才带上新版本号。
3. **`git push` 走代理会偶发 TLS 失败** → `git config --local http.sslBackend openssl` + **失败重试几次**。
4. **改 Vercel 环境变量 / `api/*.js` → 要 Redeploy。**
5. **别把密钥**写进代码或提交 `.env`。
6. 本地跑要带代理：`NODE_USE_ENV_PROXY=1 HTTPS_PROXY=http://127.0.0.1:7890 node dev-server.js`（`NODE_USE_ENV_PROXY` **必须在启动时设**）。
7. **不用** html2canvas/jspdf 导 PDF；**不加**具体 CCSS 代码。
8. **⚠️ 千万不要用 PowerShell 的 `Get-Content -Raw` 去读写站内文件。** PS 5.1 遇到**无 BOM 的 UTF-8 文件会按 GBK 解码**，把 `—`（U+2014）变成 `鈥?`（**第三个字节永久丢失，不可逆**）再写回 —— **整站文案被静默破坏**。2026-10-05 真实发生过一次：一次"只改版本号"的操作污染了 `index.html` / `privacy.html` / `terms.html` / `scripts/gen-seo.js`，并顺着 `gen-seo.js` 扩散到 60 个 SEO 落地页（页面标题、meta description、OG 分享卡全变乱码）。
   **唯一正确写法**：
   ```powershell
   $enc = New-Object System.Text.UTF8Encoding($false)   # 无 BOM
   $txt = [System.IO.File]::ReadAllText($path, $enc)
   $txt = $txt.Replace("old", "new")
   [System.IO.File]::WriteAllText($path, $txt, $enc)
   ```
   **改完必须字节校验**：文件里不应出现 U+9225（`鈥`）；`—` 应为字节 `E2 80 94`。
   （用编辑器/Edit 工具改文件是安全的，只有这条 PowerShell 路径有毒。）
9. **写 `.bat` 文件必须用 CRLF 行尾。** cmd.exe 遇到 **LF-only 的批处理会让 `goto :label` 失效、脚本直接不执行** —— 现象是双击后**窗口一闪而过或毫无反应**。而编辑器 / Write 工具写文件默认是 **LF**，所以写完**必须显式转成 CRLF**：
   ```powershell
   $t = [System.Text.Encoding]::ASCII.GetString([System.IO.File]::ReadAllBytes($p))
   $t = $t.Replace("`r`n","`n").Replace("`n","`r`n")
   [System.IO.File]::WriteAllText($p, $t, (New-Object System.Text.UTF8Encoding($false)))
   ```
   **2026-10-05 真实踩过两次**：`push-to-github.bat` 和 `start-local.bat` 被写成 LF，用户双击"没有反应"，排查了很久才想到是行尾。
10. **用户自由文本入口（`Extra instructions` 文本框、🎯 单题微调指令）绝不许覆盖系统红线**——年级对齐 / 纯文本 / 不用 `$` 做定界符 / 答案键规则**永远优先**。改 `buildPrompt` / `buildTweakPrompt` 时**不许把这条"非覆盖"约束删掉**（代码里写的是"冲突时以上述规则为准"，详见「生成前偏好 / 生成后微调」一节）。

## 关键文件

`index.html` / `app.css` / `app.js`（前端）｜ `api/generate.js`（AI，按科目分发 + 多供应商 + `looksComplete` 校验 + 按 IP 限流）/ `api/gate.js`（签发 HMAC 门票）/ `api/verify-license.js` / `api/health.js`（诊断）/ `api/track.js`（埋点）/ `api/subscribe.js`（邮箱）｜ `dev-server.js`（本地）｜ `scripts/gen-seo.js`（60 落地页）｜ `vercel.json`。

## 变现规则（承诺过的，别乱动 ⚠️）

用户已对外承诺过，**以下两条不许擅自改**：
1. **免费额度 = 每天 2 份**（`app.js` 的 `FREE_MATH_DAILY = 2`）。
2. **价格 = $19，折扣码 `LAUNCH30` → 实付 $13.30**（一次性）。

> 📌 **价格变更记录（2026-10-05）**：原为 `$9.90 → 30% off → $6.93`，用户已改为 **`$19 → 30% off → $13.30`**（Gumroad 后台实际 `price_cents: 1900`）。
> **不要再把价格改回 $6.93。** 旧文档（`worksheet-ai-交接-20261005\02`、`04`、`07` 等）里写的 $6.93 是**历史记录**，以本条为准。
> 价格散落在 4 处：**Gumroad 后台** · `index.html` · `scripts/gen-seo.js`（→60 个落地页）· `terms.html`。**改价必须四处同步。**

在此之上的**档位分层（v=33 现行）**：

| | Math | 其他 7 个科目 | 水印 | 价格 |
|---|---|---|---|---|
| **Free** | 2 份/天 | 1 份/天 | 有 | $0 |
| **Basic** | **无限** | 3 份/天 | 无 | $13.30 一次性（码 LAUNCH30） |
| **Pro** | 无限 | **无限** | 无 | 月付（$4.99/月）+ 后续新功能都包含 |
| **Classroom** | 无限 | **无限** | 无 | $59 一次性——**一个老师自己班**（v=33 已上线） |

- 常量在 `app.js` 顶部：`FREE_MATH_DAILY=2`、`FREE_OTHER_DAILY=1`、`BASIC_OTHER_DAILY=3`、`PRO_MONTHLY_URL`、`PRO_MONTHLY_LABEL`、`CLASSROOM_URL`、`CLASSROOM_LABEL`。
- 档位存 `localStorage["wsai_plan"]` = `free` | `basic` | `pro`；旧的单标志 `wsai_unlocked=1` 会自动迁移为 **basic**。
- `api/verify-license.js` 现在**返回档位**：env `GUMROAD_PRODUCT_ID` = Basic 产品 id（逗号分隔多个），`GUMROAD_PRO_PRODUCT_ID` = Pro 订阅产品 id（逗号分隔多个），`GUMROAD_CLASSROOM_PRODUCT_ID` = Classroom 产品 id（逗号分隔多个）。**会先试 Pro、再试 Classroom、最后 Basic**，避免高级用户被降级。**Classroom 在后端映射为 pro 级权益**（无限+无水印），"一个老师自己班"的范围约束写在条款里（`terms.html`），不在代码里。
- `PRO_MONTHLY_URL` = `https://219809065360.gumroad.com/l/scrywy`（Pro 订阅产品）；置空则月付按钮自动隐藏（不会留死链）。价格文案 `PRO_MONTHLY_LABEL` 必须与实际一致。
- **Pro 是另一个 Gumroad 产品**（Membership/订阅型）：permalink `scrywy`，`product_id = poNRKhKHkoG_Etcw2o5F-A==`，$4.99/月；已填进 `PRO_MONTHLY_URL`。**Vercel 环境变量 `GUMROAD_PRO_PRODUCT_ID`** = 这个 product_id（**2026-10-06 已确认配好**：线上 `/api/health` 返回 `gumroadProProductId:true`；**若将来换 Gumroad 产品，必须同步改这个 env 并 Redeploy**，否则 Pro 激活不了）。
- **Classroom（v=33 已上线）**：Gumroad 产品已建——permalink `dzsahy`（https://219809065360.gumroad.com/l/dzsahy），**product_id = `sy0h5DqeDo4r5nvdh2sfKw==`**，$59 一次性、非订阅（2026-10-06 页面核实）。`app.js` 的 `CLASSROOM_URL` 已填。**Vercel 环境变量 `GUMROAD_CLASSROOM_PRODUCT_ID` = `sy0h5DqeDo4r5nvdh2sfKw==`**（**2026-10-06 已确认配好**：线上 `/api/health` 返回 `gumroadClassroomProductId:true`；将来换产品要同步改并 Redeploy）。产品内容页需放 `__license_key__` 自动激活链接（同 Basic/Pro，见下条）。
- 一个 Gumroad 产品不能既一次性又订阅，所以 Basic/Pro/Classroom 永远是不同产品。`verify-license` 已检查退订/失效字段，前端每天静默复检一次，退订后自动回落档位。
- **售后自动激活**：Gumroad 占位符是 **`__license_key__`**（双下划线，不是 `{license_key}`），只能用在**产品内容页**的链接/按钮里。填 `https://worksheet-ai-l1td.vercel.app/?license_key=__license_key__`。前端 `autoActivateFromUrl()` 会自动校验、弹框显示结果、并清掉地址栏里的 key。
- 单题 🔄 重写**免费且不耗额度**；✏️ 编辑同样免费；🎯 单题微调（v=38）**同样免费、不耗额度**。
- 价格数字散落在 `index.html` + `scripts/gen-seo.js`（搜 `$13.30`）+ `terms.html`，Gumroad 后台是第四处，**改价必须四处同步**（与上面「变现规则」一节的 4 处一致）。

## Starter Pack 与邮箱订阅（v=33）

- **`starter-pack.pdf`**（仓库根目录，静态资产，~157KB / 21 页）：封面 + 10 张真实生成的卷（Math K–4 各 1 + Reading/Grammar/Spelling/Science/Writing 各 1），每张学生卷 + 答案卷。**重建方法**：起本地服务后跑 `node _bench/build_pack.cjs`（内部用 `/api/generate` 真实生成 → 拼一页 → 无头 Edge 打印）。
- **领取路径**：订阅成功后前端直接给 `/starter-pack.pdf` 下载链接（`submitSubscribe` 成功分支），不等邮件、不依赖服务商——邮箱只是后续触达渠道。
- **邮件服务商已选 MailerLite（v=33 已配置并实测打通）**：免费档 1,000 订阅者/月发 12,000 封。分组 `worksheet-ai`（group_id `200548002003158197`）。env `MAILERLITE_API_KEY` + `MAILERLITE_GROUP_ID` 本地 `.env` 与 Vercel 均已配置；本地实测 subscribe → 入组成功（测试订阅者已删）。**配好 MailerLite 后要真的发**（先手动，量大了用 automation）。
- 同类可复用脚本在 `_bench/`：`test_frac_render.cjs`（分数/货币渲染回归）、`sweep.cjs`（全科目扫描）、`landing_check.py`（60 页完整性）、`cdp_shot.cjs`（CDP 截图）。

## 防盗用护栏（v=33，lib/guard.js）

**已经天然安全的部分**：所有 AI 密钥只在服务端环境变量里，浏览器拿不到——"密钥从网站泄露"不存在，现实风险是**接口被盗刷**（脚本批量生成烧免费额度/DeepSeek 余额）。

**三层防线（无数据库、全 stateless）**：
1. **来源校验**：POST 只接受自家页面的 Origin/Referer（白名单：生产域名 + localhost + `ALLOWED_ORIGINS` env 可加自定义域名）；
2. **门票（gate ticket）**：页面先 `GET /api/gate` 领 HMAC 签名票据（90 分钟有效），后续请求带 `x-gate` 头；票据缺失/伪造/过期 → 403。app.js 自动领票、403 自动刷新重试一次，用户无感。HMAC 密钥用 `GATE_SECRET` env，不设则从三家供应商密钥推导（零配置）；
3. **全站日预算**：`GLOBAL_DAILY_BUDGET`（默认 3000/天）封顶最坏情况的 API 花费——**配 Upstash（免费）才是全站硬顶**，不配则按实例内存近似。

接线范围：generate/relevel/rewrite/subscribe 全要票；verify-license 只查来源（购买后激活时页面还没领票）。`GATE_OFF=1` 一键关闭。topic 限长 120 字符。vercel.json 加了 X-Frame-Options/nosniff/Referrer-Policy。

**给站长（用户）的建议**：① 去 upstash.com 免费建一个 Redis，把 `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` 加进 Vercel → 全局限流和预算才真正全局生效（`/api/health` 的 `rateLimit: memory` 表示还是按实例近似）；② 有人滥用时看 Vercel 日志里的 403/429。

测试：`node _bench/test_guard.cjs`（16 项）；裸 curl 必须 403、带票 200 已实测。**注意：dev-server 的路由是手工映射表，新增 api 端点要同步登记**（api/gate 这次就踩过）。

## 我的卷子库 / 收藏 / 打印开关（v=33 新功能）

- **历史 = 重印库**：`wsai_hist`（localStorage，最多 20 条）每条存完整 `html`，点即重印（复用旧 `renderHist` 的 lastSheetHtml 机制）；Pack 的每一张、relevel 的结果都会入历史。旧版"只存主题"的 5 条记录无法重印，加载时被过滤掉。
- **收藏（Pin）**：`wsai_favs`，结果页工具栏 ☆ Pin 按钮；**免费 3 枚，Basic/Pro 无限**——第 4 枚在免费计划触发付费弹窗（同行调研里"微型配额撞墙转化"的正面用法，额度承诺未动）。清理历史时不清理收藏。
- **答案键打印开关**：工具栏 "Answer key" 复选框（默认开，`wsai_print_key` 记忆）。关 → `body.print-no-key`，打印 CSS 隐藏 `.ws-answers-title/.ws-answers/.ws-pack-keys` 和最后一个 `.ws-pagebreak`（不藏会印出空白页）。屏幕上答案照常显示。
- **季节标签**：`SEASONAL` 表按月给每个科目一条应景话题（10 月=🎃 halloween candy math / pumpkin life cycle…），`renderChips` 置顶展示。
- **生成进度条（v=33）**：`/api/generate` 支持 `stream:1` → SSE 真实阶段（`writing` → `checking` → `done`），客户端 `startProgress()` 把阶段映射到百分比并在阶段内平滑推进（显示"Writing your questions… 37% · 6s"），完成/失败自动隐藏。**客户端有看门狗**（60s 无数据或 300s 总时长 → 取消并提示）——注意兜底链最坏可跑 4 分钟以上，看门狗总时长不能调小。**部署竞态保护**：服务端返回 JSON 而非 SSE 时（旧实例），客户端会直接采用其中的 `html`。
- 功能测试：`node _bench/lib_check.cjs`（真实生成 2 张 + 14 项断言，CDP）；打印页数矩阵 + 落地页联动：`_bench/defect_hunt_a.cjs / a2.cjs`（脚本读页数的实现是 `/Count` 正则 + zlib 解压兜底；**手工核对单份 PDF 时改用 `pypdf`**，裸 `/Count` 正则不可靠）；移动端 390px：`_bench/defect_hunt_b.cjs`；进度条：`_bench/progress_check.cjs`；**纯前端显示/体验 + 单题编辑的答案同步：`_bench/ux_check.cjs`（24 项，自带静态服务 + 打桩 `/api/gate|generate|track|subscribe`，不需要 dev-server、网络或密钥，`node _bench/ux_check.cjs` 直接跑。打桩会记下每次 `/api/generate` 的请求体，所以能断言"前端到底发了什么"）**；**双实现一致性：`_bench/test_visual_parity.cjs`（8 个图形构造器，`app.js` vs `scripts/visuals.js` 必须逐字节相同）**。
- **已知限制（2026-10-06 实测）**：个别图形多的卷子学生页会溢出到第 2 页（约多 1 题），套装因此 5 张可能印 9 页而非 6 页——内容高度差异，不是套装分页逻辑问题（每张都从新页开始、答案键开关在套装下正常：关=0 页答案）。（原「填空分数（½ = ▢/4）的空位渲染为纯空白」这条限制**已在 v=34 修掉**，见下节。）

## 生成前偏好 / 生成后微调（v=37–v=38 新功能）

两个入口都**免费、不耗额度**、都走护栏（`x-gate`），且都是**用户自由文本输入，各限 200 字符**。

- **`Extra instructions`（v=37，生成前）**：首页 + 60 个落地页的表单里都有 `<textarea id="extra" maxlength="200">`（`index.html` 与 `scripts/gen-seo.js` 模板），随其它偏好一起记忆（`savePref/readPref` 的 `extra`）。`app.js` 发请求时带上 `notes`（`.slice(0,200)`）；`api/generate.js` 清洗控制字符 + `slice(0,200)`，在 `buildPrompt` 的 `GENERAL RULES` 里追加一条**非覆盖**规则：
  `EXTRA REQUIREMENTS (… honor them whenever they do NOT conflict with the rules above. If a note conflicts with the grade level, the subject, the text-only rule, or the answer-key rules, the rules above ALWAYS win)`
  - ⚠️ **它是「偏好级软约束」，不是硬保证**：2026-10-06 线上实测（要求"每题都是买零食的钱应用题"）——标题和部分题确实被带动，但不保证每一题都遵守。**不要把它描述成"必定遵守"。**
- **🎯 单题微调（v=38，生成后）**：单题工具栏在 `✏️ Edit` / `🔄 Rewrite` 之外多了 `🎯` 按钮 → `window.prompt()` 收一句要求（≤200）→ `mode:"tweak"`，**只重做这一题**。
  - 后端 `buildTweakPrompt()` 要求"只改这一次、保留技能/题型/结构、Do NOT replace"，模型返回 minified JSON `{question, answer}`，由 `parseItemEdit()` 解析（取**首个 `{` 到末个 `}`** 再 `JSON.parse`，所以模型包上代码围栏或散文也能容忍；解析失败就换下一个模型）。

三个单题入口的区别（**别弄重**）：

| 入口 | 作用 | 是否同步答案键 |
|---|---|---|
| `✏️ Edit` | 手动 `contentEditable` 改题 | 手动 |
| `🔄 Rewrite` | 换一道**全新**同技能题 | **同步更新**（v=41 修好） |
| `🎯 Tweak` | **保留原题**只按指令改一处 | **同步更新** |

> ✅ **v=41 已修**：`🔄 Rewrite` 原来只换题目、**不更新答案键**——换题后答案键那条还描述着**旧题**，家长照它批改会把做对的孩子判错。
> **实现方式（改这块前必读）**：`rewrite` 和 `tweak` 现在**共用一个协议和一个收口** ——
> - 后端两个分支都用 `parseItemEdit()` 解 `{question, answer}`；`buildRewritePrompt(…, answer)` 也会把**旧答案**一起发过去，要求模型返回配套的新答案。
> - **`rewrite` 分支刻意不做"解析失败就把原文当 HTML 用"的兜底**——那正是原来那个静默错位的来源。模型不守 JSON 契约就换下一个模型。
> - 前端两个按钮都走 `runItemEdit()`，共用 `itemContext()`（拿 `li` 的序号 + 对应答案键文本）和 `applyAnswerEdit()`（写回**同一序号**的答案项）。**要改索引/答案逻辑，只改这两处**，别再在按钮里各写一份（当初就是这么分叉出 bug 的）。
> - 没有答案键的卷子（写作提示）在 `aItems[idx]` 处为空 → `applyAnswerEdit` 自动空转，不算错。
> - 回归：`_bench/ux_check.cjs` 里"rewrite updated the answer key"三连（打桩 `/api/generate` 返回 `{html, answer}`，真的点 🔄 按钮）——**这是唯一能锁住这个 bug 的测试**。

### v=34–v=41 修掉的 bug（都已在线上）

1. **v=34 填空分数的空位渲染成空白**：`\frac{\square}{4}` 这类填空，分子原会被"删未知宏"规则 `\\[a-zA-Z]+` 删掉，只剩分数横线。修法：frac 正则 `[^{}]+` → `[^{}]*`（**接受空花括号**）+ `fracSpan()` 对空/`\square`/`\Box`/`\blacksquare`/`\filledsquare` 渲染成 `<span class="fill">`，`app.css` 加 `.worksheet .frac .fill`（浅色框，打印保留）。**双实现同步**：`app.js` + `scripts/visuals.js`。
2. **v=35 模型输出的 LaTeX 转义标点泄漏**：`\_\_\_`（转义下划线）、`\%`、`\&`、`\#`、`\ `（转义空格）原来会**带着反斜杠原样印出**（用户报的"奇怪斜杠"）。修法：在 `renderMathString()` 早期加解包 —— `t.replace(/\\([_%&#])/g, "$1")` + `t.replace(/\\[ ,;:]/g, " ")`。**双实现同步**（`app.js:395` / `scripts/visuals.js:166`）。
3. **v=36 首次生成看不到进度条**：`#genProgress` 原本被插在 `#note` 之后，而 `#note` 位于初始 `hidden` 的 `#resultWrap` **内部** → 第一次生成时祖先 `display:none`，进度条不可见；生成完 `#resultWrap` 才显示，而进度条已 `done` 隐藏。修法：挂载点改成 `$("genBtn") || $("note")`（落在**始终可见**的表单里）。
   - **测试盲区一并补上**：`_bench/progress_check.cjs` 原来只查元素自身 `hidden`，抓不到"祖先隐藏"；现在加了 `getBoundingClientRect` / `offsetParent` 可见性断言。
4. **v=39 四处显示/体验修复**（回归测试：`node _bench/ux_check.cjs`，13 项，纯前端、打桩 `/api`、无需网络与密钥）：
   - **未选科目时额度文案是坏的**：首页首屏 `#subject` 默认是「— Choose a subject —」，`updateQuotaBase()` 的 else 分支直接拼 `subj` → 渲染成 `Free plan: 1 of 1  worksheet left today`（多一个空格、科目名是空的）。修法：`!subj` 时改说整份免费额度。**改额度文案时别忘了这个分支。**
   - **Basic 付费用户被标成 "Pro"**：`renderResult` 里原来是 `isUnlocked() ? "Pro — watermark removed" : ...`，而 `isUnlocked()` 对 Basic 也为真 → 花了 $13.30 的人被告知自己是 Pro。修法：新增 `planLabel()` 按真实档位取名。
   - **单题工具在触屏上完全看不见**：`.li-tools` 是 `opacity:0`，只由 `li:hover` / `li:focus` 揭示。触屏没有 hover，而 `<li>` 本身不可聚焦（`li:focus` 永远不匹配）→ 按钮**不可见但可点**，误触会触发一次看不见的重写。修法：加 `li:focus-within`，并加 `@media (hover: none), (pointer: coarse) { .li-tools { position: static; opacity: 1 } }` 让它在触屏上进流排布。**删这条媒体查询会让平板重新坏掉。**
   - **`parseInt` 返回 NaN 时额度显示 "NaN of 2"**：`getCount`/`getCountOther` 的 `parseInt(...)` 外面补了 `|| 0`。
5. **v=40 三项修复**：
   - **"Questions" 下拉框对 Spelling / Vocabulary / Writing 是空的**（**真 bug**）：`api/generate.js` 里 `spellingBlock` 把词表钉死 10 词（+2 句）、`vocabBlock` 钉死 8 定义 + 5 填空 + 2 句、`writingBlock(grade)` 连 `count` 都不收——只有 Math/Reading/Grammar/Science/Social 会插 `${count}`。也就是说选了"5 题"也会拿到 15 个活动。修法：`app.js` 的 `COUNT_IGNORED = ["spelling","vocab","writ"]` + `syncSubjectFields()` 里把 `#countField` 隐藏（**改了这些科目 prompt 里的数量，记得同步改这个数组**）。
   - **`app.js` 与 `scripts/visuals.js` 的图形构造器曾经不同步**：`fractionCircleHTML` 少了 `visuals.js` 的 `role="img" aria-label="Fraction circle"`。修法：补齐对齐，并**新增 `_bench/test_visual_parity.cjs`**——把 8 个图形构造器从两个文件里各抓一份，逐条比对输出必须**逐字节相同**（有防"空对空假通过"的断言；已做变异测试确认它真的会 FAIL）。
   - **`api/generate.js` 三个数字型 env 一旦被写成非数字，会把整站限流打死**：`DAILY_LIMIT_PER_IP` / `GLOBAL_DAILY_BUDGET` / `MEM_LIMIT_PER_IP_DAY` 的 `parseInt` 会返回 NaN，而 `count <= NaN` 恒为 false → **全站 429**。修法：三处都补 `|| 默认值`。
   - **订阅框（`#subBox`）原来只在单张生成后出现**，做套装/三档难度/难度切换都不出现。修法：调用点从 `runGenerate()` 移到 `paintWorksheet()`——所有让新卷子上屏的路径都会走到。
   - **`_bench/test_guard.cjs` 有一条会随机报假失败的断言**（**教训**）：`tampered payload invalid` 那行原来用 `new Date()` 现造一个"被篡改"的 payload，但 `issueTicket()` 内部也是 `Date.now()` —— 两者**大概率落在同一毫秒**，于是"篡改后"的字符串和原字符串**逐字节相同**，签名当然验证通过，断言就红了。实测 **20 次跑挂 2 次**（紧循环里 3000 次有 2972 次是相同的）。修法：把时间戳写成 `Date.now() - 60000`，保证 payload 一定不同。修完连跑 **30/30 全过**。
     ⚠️ **看到测试红了，先确认它是不是在测真东西**——这条假红很容易把人骗去"修"完全正确的 `lib/guard.js`（我实测真篡改 500/500 都被正确拒绝）。
6. **v=41：`🔄 Rewrite` 换题不同步答案键**（**正确性 bug，已修**）。详见上面「三个单题入口的区别」那一段——那里写清了新协议、为什么 `rewrite` 分支**故意不做** HTML 兜底、以及前端 `itemContext()/applyAnswerEdit()/runItemEdit()` 三个必须共用的收口。回归锁在 `_bench/ux_check.cjs`。

## 本地测试的三个硬坑（2026-10-06 全部踩过）

1. **dev-server 在启动时 `require()` 了所有 api 模块**——改 `api/*.js` 后**必须重启 dev-server** 才生效（静态文件是每次请求读盘，无需重启）。今天因此两次误判"SSE 没生效"。
2. **dev-server 的 response 包装器**要支持 SSE 的 `setHeader/write/end`（已在 `dev-server.js` 实现，含惰性 `writeHead`——**没有它 SSE 响应会丢 Content-Type，浏览器把事件流当 JSON 解析→"Request failed"**）。线上 Vercel 用原生对象，无此问题。
3. **`alert()` 会阻塞无头 CDP 测试**——测试脚本必须 `window.alert = function(){}` 之后再触发生成。另外测试残留的 Edge 进程会锁住 `_ep*` profile 目录，清理时用 `Get-CimInstance Win32_Process` 按命令行匹配 `_ep` 只杀测试进程（别全杀，会误伤用户的 Edge）。

## 落地页样例（60 页的真实内容）

`scripts/gen-samples.js` 生成 `samples/<slug>.html`（一张真实练习纸）；`scripts/gen-seo.js` 通过 `scripts/visuals.js` 的 `hydrate()` 在**构建期**把它烘焙进 60 个 `/worksheets/` 页。
- **`visuals.js` 与 `app.js` 是重复实现**（app.js 是浏览器 IIFE，无法 `require`）——**改一个必须同步另一个**。`hydrate()` 除了渲染 `data-visual` 图形，现在还会调 `renderMathString()` 把 `\frac` 等 LaTeX 变成 `<span class="frac">`，并**剥除渲染器不认识的宏**（如 `\underline{\hspace{1cm}}` → 空格）。**不加这个，落地页会原样印出 `\frac{1}{2}`**（2026-10-05 修，当时 60 页全中）。
- 落地页**打印只输出那张练习纸**：装饰元素带 `no-print`，`@media print` 用 `.sample-block .sample-worksheet …` 覆盖（**特异性高于 app 的 `.worksheet` 规则，不再依赖 `<style>`/`<link>` 的先后顺序**）。实测 60 页里 **57 页 = 1 页**，3 个超长阅读/词汇页 = 2 页（内容确实超过一页，接受）。
- 结果页会显示 **✔ Answer key checked** 徽标（`renderResult(…, checked)`，样式 `.ws-checked`），把“答案已校对”这个隐形卖点变成可见的信任信号。

## 课标锚点（年级对齐）

`lib/curriculum.js` 存 K–5 数学的 `range / covers / notYet`，由 `api/generate.js` 的 math 分支注入 prompt（`mathScope(grade)`）。
**为什么必须有**：2026-10-05 实测三个模型（gpt-oss-120b / deepseek-v4-flash / qwen3.8-27b）答案都 10/10 正确，但**年级全都不对**（Grade 3 分数卷混进四年级的分数加减乘）。加锚点后同样三个模型 **30/30 题全部年级对齐**。
- 只写内容描述，**不写 CCSS 标准代码**（会编错）。
- **放在 `lib/` 而不是 `api/`** —— `api/` 下每个文件都会被 Vercel 当成一个端点。
- 新增科目时，`notYet` 清单是比 `covers` 更关键的杠杆。

## 非数学科目的内容质量（v=33 起）

7 个非数学科目各自有**逐年级锚点**（写在 `buildPrompt` 的科目模板里，与数学的 `lib/curriculum.js` 同思路）：Spelling 逐年级拼读模式菜单（3–5 年级禁止 CVC/元音组合，用同音词/词根，Part B 用语境句挖空）、Vocabulary 逐年级词汇难度、Grammar 逐年级技能菜单、Science 的 NGSS 主题按年级、Writing 的体裁按年级、Reading 按年级篇幅 + K 段"一两个词作答"、Social Studies 主题 + 史实不简化的约束。

**三道确定性安检**（`looksComplete` + `answerKeyIsSound`，不合规 → 换下一个模型重试，全部失败才按旧方式放行）：
1. 答案数量必须覆盖题目（词表科目按设计允许 ~15% 缺口；抓过 15 题只有 4 答的截断卷）；
2. 模型半途截断（答案键标题存在但 `<ol>` 没闭合 / 片段没以 `>` 结尾）→ 判废；
3. `answerKeyIsSound`：答案里出现"文章没有提到"类元话语（= 题目超出课文范围，抓过 8 题里 4 题）、或题目里印着 "(answer: …)" → 判废。

历史实锤案例（全部来自 2026-10-06 的 21 张审计卷）：love 被当成 silent-e 长音词、chair 混进 ai 词表、"Fan sat mat" 病句、答案键截断、"(answer: cloud)" 印进题目、4/8 题不可答、Rosa Parks 被写成 young girl。审计工具：`node _bench/audit_gen.cjs`（7 科目 × 3 年级真实生成 + 转纯文本供人读）。

## 答案校对（两层）

`proofread()` 是生成的第二道关，**失败即放行**（绝不让检查本身把产品变差）：
1. `checkMath()` —— 确定性。解析纯计算题、用整数/分数算术重算、不一致就标注。**解析不明确就跳过，绝不猜测**（文字题一律不碰）。
2. 模型复检 —— 把题目+答案+**原文/词表**回喂，以"校对员"口吻要求逐题复核并只返回 JSON。

**踩过的坑**：第一版忘了把 `ws-passage` 原文一起送过去，导致阅读答案"用短文里没有的词"这种错误完全检不出（proofreader 看不到原文，没法核对）。现在 `extractPassage / extractWordlist` 会一起带上。
- 关闭开关：环境变量 `SKIP_ANSWER_CHECK=1`；`/api/health` 的 `answerCheck` 字段可确认状态。
- 单题重写（`mode:"rewrite"`）目前**不走**校对。

## 本地验证方法（改动后必做）

`api/generate.js` 末尾导出了 `_buildPrompt / _buildRelevelPrompt / _checkMath / _proofread / _applyFixes / _parseWrong / _buildAttempts / _buildTweakPrompt`，**仅供本地脚本复用真实逻辑**（Vercel 只用默认导出）。

**1) 单元测试**（27 个断言：算对不误报、算错报出正确值、跳过文字/主题计算题、容错不崩、`Extra instructions` 注入与非覆盖、`buildTweakPrompt` 4 项）
```
node "<工作区>/_bench/test_check.cjs"
```
⚠️ 用 `.cjs` 不用 `.mjs` —— `.mjs` 里没有 `require`。

**2) 换模型 / 改 prompt 的质量对比** —— 别靠感觉，跑同一道题人工核对"年级对齐 + 答案正确率"。
⚠️ **不要用 PowerShell 的 `Invoke-RestMethod` 发 JSON body**：含 `–` `—` 等字符时会稳定 400（`messages.0.content: Invalid input`）。**用 Node + `fetch`**。
走代理：`NODE_USE_ENV_PROXY=1 HTTPS_PROXY=http://127.0.0.1:7890`，并用**系统 Node 24**（`C:\Program Files\nodejs\node.exe`）。
已知限制：本机直连 OpenRouter 时 Gemini / GPT-5.x 会被区域拦截；OpenRouter 账号余额也需充足，否则付费模型全部 402。

**3) 打印版式（数页数）** —— 把 `.worksheet` 写成静态 HTML（`<link rel="stylesheet" href="app.css?v=N">`，**相对路径**），用无头 Edge 转 PDF：
```powershell
& "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --headless=new --no-sandbox `
  --no-pdf-header-footer --user-data-dir="$env:TEMP\edgeprof" `
  --print-to-pdf="$env:TEMP\t.pdf" "file:///C:/path/to/_pt.html"
```
页数用 `pypdf` 读（裸 `/Count N` 正则不可靠；`_bench/defect_hunt_a*.cjs` 里的实现是 `/Count` + zlib 解压兜底）。**目标：学生卷 1 页 + 答案页 1 页 = 2 页**（10 题、12 题、阅读+答题横线均已实测为 2 页）。⚠️ **必须加 `--user-data-dir`**，否则 PDF 不会生成。

## 详细资料

桌面 `worksheet-ai-交接\`：
`00-先读我` / `01-项目总览` / `02-架构与代码` / `03-关键决策与坑`(⭐) / `04-运维手册` / `05-路线图与待办` / `06-宣发与市场` / `07-资料与对话记录位置` / `项目记忆.md` / `对话记录/`。

桌面 `worksheet-ai-交接-20261005\`（**变现改造增量包，v15→v19**）：
`00-先读我` / `01-今天做了什么` / `02-三档变现规则` / `03-代码改动清单` / `04-Gumroad与收款` / `05-部署运维` / `06-坑与教训` / `07-待办与风险` / `08-对话纪要` / `WorksheetAI盈利分析报告.md` / `对话与决策/`。
