# WorksheetAI — 极简试水版（可运行代码骨架）

一个单页工具：**输入主题 → 生成可打印 worksheet → $5 买断解锁**。
零数据库、零账号、两个 serverless 函数。目标：5 天上线，收到第一笔钱。

---

## 目录结构

```
worksheet-ai/
├─ index.html            # 单页应用（表单 + 生成 + 打印 + 付费弹窗 + 免费额度）
├─ api/
│  ├─ generate.js        # 调 Gemini 生成 worksheet（key 放后端）
│  └─ verify-license.js  # 校验 Gumroad license key
├─ package.json
├─ .env.example          # 环境变量模板
└─ .gitignore
```

---

## 一、本地跑起来（推荐：一条命令，零依赖）

**方式 A（推荐）——不需要装任何东西，只要 Node 18+：**
```bash
cp .env.example .env      # 可选，先留空也能跑
node server.js
```
浏览器打开 `http://localhost:3000`。就这一条命令。

> **没有 key 也能跑**：`server.js` / `generate.js` 在没配 `GEMINI_API_KEY` 时会返回一份
> DEMO 练习纸，方便你先看完整流程。配上真 key 就出真实内容（重启服务生效）。

**方式 B——用 Vercel CLI（与线上环境完全一致）：**
```bash
npm i -g vercel
cp .env.example .env      # 编辑 .env 填入 GEMINI_API_KEY
vercel dev                # 打开它提示的地址
```

> 想换端口：`PORT=4000 node server.js`。

---

## 二、拿 AI key（推荐 OpenRouter，免绑卡免实名）

**方式 A（推荐）— OpenRouter：**
1. 打开 https://openrouter.ai/ ，用 Google 账号登录。
2. 进 https://openrouter.ai/keys ，点 **Create Key**，复制那串 `sk-or-...`。
3. 填到 `.env`：`OPENROUTER_API_KEY=sk-or-...`
4. （可选）免费模型名在 https://openrouter.ai/models?max_price=0 挑，填 `OPENROUTER_MODEL=`；
   留空则默认 `google/gemini-2.0-flash-exp:free`。

**方式 B — Google Gemini 直连（需 Google Cloud 项目，可能要求绑卡）：**
1. 打开 https://aistudio.google.com/apikey
2. 创建 API key，填到 `.env` 的 `GEMINI_API_KEY=`
3. `generate.js` 里模型名默认 `gemini-2.0-flash`；变了就替换。

> `generate.js` 会自动选：设了 `OPENROUTER_API_KEY` 就用 OpenRouter，否则用 `GEMINI_API_KEY`。

---

## 三、建 Gumroad 产品 & 收款

1. 注册 https://gumroad.com ，新建一个 **Digital product**。
2. 名称：`WorksheetAI Pro — Unlimited worksheets`，价格 **$5**（一次性）。
3. **打开 "Generate a license key"**（关键，用于发授权码）。
4. 复制产品链接，替换 `index.html` 顶部：
   ```js
   const GUMROAD_URL = "https://gumroad.com/l/REPLACE-WITH-YOUR-PRODUCT";
   ```
5. 复制产品 ID（在 Gumroad 产品设置里能找到），填到环境变量 `GUMROAD_PRODUCT_ID`。

**产品页文案**见 `../worksheet-ai-执行清单.md` 第 5 节，直接抄。

---

## 四、部署到 Vercel（免费）

1. 把本目录推到 GitHub。
2. 在 https://vercel.com 导入该仓库。
3. 在项目 **Settings → Environment Variables** 里加：
   - `GEMINI_API_KEY`
   - `GUMROAD_PRODUCT_ID`
4. Deploy。先用 Vercel 免费子域名（`xxx.vercel.app`）；**验证有收入再买域名**。

或用命令行：
```bash
vercel          # 首次部署（预览）
vercel --prod   # 上线生产
```

---

## 五、上线后自测清单

- [ ] 生成一份 worksheet，点 Print 能正确导出（只有练习纸，没有按钮/标题）
- [ ] 免费额度：同一天生成 3 次，第 3 次应弹出付费墙
- [ ] Gumroad 花 $5 真买一次，拿到 license key
- [ ] 在付费弹窗里输入 key，点 Activate → 水印消失、无限生成
- [ ] 换手机打开，确认响应式正常

---

## 六、已知取舍（试水版故意如此）

- **无账号/数据库**：解锁状态存在浏览器 localStorage，换设备要重新激活（规模小可接受）。
- **数学准确性**：目前靠提示词要求 AI 自查；等有付费用户后，数学类改成"脚本生成数字、AI 只排版"。
- **前端渲染 AI 返回的 HTML**：内容由服务端 AI 生成，风险低；后续可加白名单标签清洗。
- **不做**：账号、订阅、多语言、SEO 页面——全部等收到第一笔钱之后再说。

---

配套文档：`../worksheet-ai-项目方案.md`（方向定稿）、`../worksheet-ai-执行清单.md`（操作清单）。
