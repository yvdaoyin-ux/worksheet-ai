# AGENTS.md — WorksheetAI

> 给任何接手本项目的 AI agent / 人的**一句话导航 + 硬规矩**。
> 完整交接资料在桌面文件夹 **`C:\Users\fa'r\Desktop\worksheet-ai-交接\`**（先读 `00-先读我.md`）。
> **变现改造（v15→v19）的增量交接包在 `C:\Users\fa'r\Desktop\worksheet-ai-交接-20261005\`**（先读它的 `00-先读我.md`）——改价格/档位/收款相关的东西**必须先看这个**。

## 这是什么

面向**北美 homeschool 家长/K–5 老师**的 **AI 练习纸生成器**（网页）。主打**数学**（真实图形：数轴/分数条/十格板/竖式）。
- 线上：https://worksheet-ai-l1td.vercel.app
- 代码：本目录（`worksheet-ai/`）
- 收款：Gumroad（$19 → 折扣码 `LAUNCH30` → 实付 **$13.30**）
- AI：Groq（主）+ OpenRouter（备）；密钥在 `.env` / Vercel 环境变量

## 硬规矩（改代码前必看）

1. **根目录绝不能有 `server.js`，`package.json` 不能有 `start` 脚本**——否则 Vercel 会把项目当 Node 服务器，所有页面 404。（本地服务器叫 `dev-server.js`。）
2. **改了 `app.css`/`app.js` → 必须 bump 前端版本号 `?v=N`**（当前 **v=28**），否则用户吃旧缓存。要同步的文件：`index.html`、`privacy.html`、`terms.html`、`scripts/gen-seo.js`（后者改完要 `node scripts/gen-seo.js` 重生成 60 页）。**用 Edit 工具改**（别用 PowerShell `Get-Content`，见第 8 条）。
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

## 关键文件

`index.html` / `app.css` / `app.js`（前端）｜ `api/generate.js`（AI，按科目分发 + 多供应商 + `looksComplete` 校验 + 按 IP 限流）/ `api/verify-license.js` / `api/health.js`（诊断）/ `api/track.js`（埋点）/ `api/subscribe.js`（邮箱）｜ `dev-server.js`（本地）｜ `scripts/gen-seo.js`（60 落地页）｜ `vercel.json`。

## 变现规则（承诺过的，别乱动 ⚠️）

用户已对外承诺过，**以下两条不许擅自改**：
1. **免费额度 = 每天 2 份**（`app.js` 的 `FREE_MATH_DAILY = 2`）。
2. **价格 = $19，折扣码 `LAUNCH30` → 实付 $13.30**（一次性）。

> 📌 **价格变更记录（2026-10-05）**：原为 `$9.90 → 30% off → $6.93`，用户已改为 **`$19 → 30% off → $13.30`**（Gumroad 后台实际 `price_cents: 1900`）。
> **不要再把价格改回 $6.93。** 旧文档（`worksheet-ai-交接-20261005\02`、`04`、`07` 等）里写的 $6.93 是**历史记录**，以本条为准。
> 价格散落在 4 处：**Gumroad 后台** · `index.html` · `scripts/gen-seo.js`（→60 个落地页）· `terms.html`。**改价必须四处同步。**

在此之上的**三档分层（v=17 现行）**：

| | Math | 其他 7 个科目 | 水印 | 价格 |
|---|---|---|---|---|
| **Free** | 2 份/天 | 1 份/天 | 有 | $0 |
| **Basic** | **无限** | 3 份/天 | 无 | $13.30 一次性（码 LAUNCH30） |
| **Pro** | 无限 | **无限** | 无 | 月付（$4.99/月）+ 后续新功能都包含 |

- 常量在 `app.js` 顶部：`FREE_MATH_DAILY=2`、`FREE_OTHER_DAILY=1`、`BASIC_OTHER_DAILY=3`、`PRO_MONTHLY_URL`、`PRO_MONTHLY_LABEL`。
- 档位存 `localStorage["wsai_plan"]` = `free` | `basic` | `pro`；旧的单标志 `wsai_unlocked=1` 会自动迁移为 **basic**。
- `api/verify-license.js` 现在**返回档位**：env `GUMROAD_PRODUCT_ID` = Basic 产品 id（逗号分隔多个），`GUMROAD_PRO_PRODUCT_ID` = Pro 订阅产品 id（逗号分隔多个）。**会先试 Pro 再试 Basic**，避免 Pro 用户被降级。
- `PRO_MONTHLY_URL` = `https://219809065360.gumroad.com/l/scrywy`（Pro 订阅产品）；置空则月付按钮自动隐藏（不会留死链）。价格文案 `PRO_MONTHLY_LABEL` 必须与实际一致。
- **Pro 是另一个 Gumroad 产品**（Membership/订阅型）：permalink `scrywy`，`product_id = poNRKhKHkoG_Etcw2o5F-A==`，$4.99/月；已填进 `PRO_MONTHLY_URL`。**Vercel 环境变量 `GUMROAD_PRO_PRODUCT_ID` 必须补上这个值并 Redeploy**，否则 Pro 激活不了（我改不了线上 env）。
- 一个 Gumroad 产品不能既一次性又订阅，所以 Basic/Pro 永远是两个产品。`verify-license` 已检查退订/失效字段，前端每天静默复检一次，退订后自动回落档位。
- **售后自动激活**：Gumroad 占位符是 **`__license_key__`**（双下划线，不是 `{license_key}`），只能用在**产品内容页**的链接/按钮里。填 `https://worksheet-ai-l1td.vercel.app/?license_key=__license_key__`。前端 `autoActivateFromUrl()` 会自动校验、弹框显示结果、并清掉地址栏里的 key。
- 单题 🔄 重写**免费且不耗额度**；✏️ 编辑同样免费。
- 价格数字散落在 `index.html` + `scripts/gen-seo.js`（搜 `$13.30`），Gumroad 是第三处，**改价必须三处同步**。

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

## 答案校对（两层）

`proofread()` 是生成的第二道关，**失败即放行**（绝不让检查本身把产品变差）：
1. `checkMath()` —— 确定性。解析纯计算题、用整数/分数算术重算、不一致就标注。**解析不明确就跳过，绝不猜测**（文字题一律不碰）。
2. 模型复检 —— 把题目+答案+**原文/词表**回喂，以"校对员"口吻要求逐题复核并只返回 JSON。

**踩过的坑**：第一版忘了把 `ws-passage` 原文一起送过去，导致阅读答案"用短文里没有的词"这种错误完全检不出（proofreader 看不到原文，没法核对）。现在 `extractPassage / extractWordlist` 会一起带上。
- 关闭开关：环境变量 `SKIP_ANSWER_CHECK=1`；`/api/health` 的 `answerCheck` 字段可确认状态。
- 单题重写（`mode:"rewrite"`）目前**不走**校对。

## 本地验证方法（改动后必做）

`api/generate.js` 末尾导出了 `_buildPrompt / _checkMath / _proofread / _applyFixes / _parseWrong`，**仅供本地脚本复用真实逻辑**（Vercel 只用默认导出）。

**1) 单元测试**（19 个断言：超纲、算错、跳过文字题、容错）
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
页数读 PDF 里的 `/Count N`。**目标：学生卷 1 页 + 答案页 1 页 = 2 页**（10 题、12 题、阅读+答题横线均已实测为 2 页）。⚠️ **必须加 `--user-data-dir`**，否则 PDF 不会生成。

## 详细资料

桌面 `worksheet-ai-交接\`：
`00-先读我` / `01-项目总览` / `02-架构与代码` / `03-关键决策与坑`(⭐) / `04-运维手册` / `05-路线图与待办` / `06-宣发与市场` / `07-资料与对话记录位置` / `项目记忆.md` / `对话记录/`。

桌面 `worksheet-ai-交接-20261005\`（**变现改造增量包，v15→v19**）：
`00-先读我` / `01-今天做了什么` / `02-三档变现规则` / `03-代码改动清单` / `04-Gumroad与收款` / `05-部署运维` / `06-坑与教训` / `07-待办与风险` / `08-对话纪要` / `WorksheetAI盈利分析报告.md` / `对话与决策/`。
