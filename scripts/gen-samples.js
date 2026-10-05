// scripts/gen-samples.js
// Builds ONE real, print-ready sample worksheet for every programmatic-SEO
// landing page, and saves it to samples/<slug>.html.
//
// WHY: those 60 pages used to be H1 + a paragraph + a form, with the headline
// promising "Free ... Worksheets" and zero actual questions on the page. That is
// a doorway page: Google has nothing to rank and a visitor has nothing to use.
// Embedding a real sample fixes both - it is the content Google can index and
// the thing a parent can print in ten seconds without signing up.
//
// This runs ONCE. The output is committed, so builds and deploys never need an
// API key. Re-run it only when the prompt or the page list changes; existing
// files are skipped, so it is safe to re-run after a partial failure.
//
// Usage (Windows, behind a proxy):
//   NODE_USE_ENV_PROXY=1 HTTPS_PROXY=http://127.0.0.1:7890 \
//     node scripts/gen-samples.js [--force] [--only=<slug>]

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "samples");
const ENV_FILE = path.join(ROOT, ".env");

const { pages } = require("./pages");
const gen = require("../api/generate.js");

// ---- env ----
if (fs.existsSync(ENV_FILE)) {
  for (const line of fs.readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m) {
      const v = m[2].trim().replace(/^["']|["']$/g, "");
      if (v) process.env[m[1]] = v;
    }
  }
}

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const OR_URL = "https://openrouter.ai/api/v1/chat/completions";
const GROQ_MODELS = (process.env.GROQ_MODEL || "openai/gpt-oss-120b,openai/gpt-oss-20b")
  .split(",").map((s) => s.trim()).filter(Boolean);
const OR_MODELS = ["deepseek/deepseek-v4-flash"];

function attempts() {
  const a = [];
  if (process.env.GROQ_API_KEY) {
    GROQ_MODELS.forEach((m) => a.push({ url: GROQ_URL, key: process.env.GROQ_API_KEY, model: m }));
  }
  if (process.env.OPENROUTER_API_KEY) {
    OR_MODELS.forEach((m) => a.push({ url: OR_URL, key: process.env.OPENROUTER_API_KEY, model: m }));
  }
  return a;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function chat(url, key, model, prompt, timeoutMs = 60000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }] }),
      signal: ctl.signal,
    });
    const data = await r.json();
    if (!r.ok) throw new Error((data.error && data.error.message) || "HTTP " + r.status);
    return (data.choices && data.choices[0] && data.choices[0].message.content) || "";
  } finally {
    clearTimeout(timer);
  }
}

function stripFences(t) {
  return String(t).replace(/^\s*```(?:html)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
}

// A sample is only accepted / reused if it is genuinely COMPLETE.
// A weak check (just "does ws-title appear") let a response that the model cut
// off mid-tag get published, leaving a worksheet that stops halfway through
// question 2. This is the same idea as looksComplete() in api/generate.js.
//
// NOTE: writing prompts are legitimately a different shape - they have a prompt
// and ruled lines and NO answer key - so requiring an <ol> here rejected every
// writing page. Both shapes are valid; only truncation is not.
function isComplete(html) {
  if (!html || html.length < 300) return false;
  if (html.indexOf("ws-title") < 0) return false;
  const hasQuestions =
    html.indexOf("ws-questions") >= 0 && html.indexOf("</ol>") >= 0 && html.indexOf("ws-answers") >= 0;
  const isWriting =
    html.indexOf("ws-prompt") >= 0 && (html.indexOf("ws-lines") >= 0 || html.indexOf("ws-checklist") >= 0);
  if (!hasQuestions && !isWriting) return false;
  const open = (html.match(/<li[\s>]/g) || []).length;
  const close = (html.match(/<\/li>/g) || []).length;
  if (open !== close) return false;
  if (/<[^>]*$/.test(html.trim())) return false; // ends mid-tag
  return true;
}

async function buildOne(page) {
  const prompt = gen._buildPrompt(page.grade, page.subject, page.genTopic, 10, "standard", "mixed");
  let html = "";
  let usedModel = "";
  for (let round = 0; round < 2 && !html; round++) {
    for (const a of attempts()) {
      try {
        const raw = await chat(a.url, a.key, a.model, prompt);
        const h = stripFences(raw);
        if (isComplete(h)) {
          html = h;
          usedModel = a.model;
          break;
        }
      } catch (e) {
        await sleep(1200);
      }
    }
    if (!html) await sleep(3000);
  }
  if (!html) return null;

  // Same second-pass answer check the live API runs, so a published sample is
  // not the one place a wrong answer could survive.
  let checked = html;
  try {
    const r = await gen._proofread(html, page.grade, page.subject, page.genTopic);
    if (r && r.html) checked = r.html;
  } catch (e) { /* keep the unchecked sheet rather than fail */ }
  return { html: checked, model: usedModel };
}

(async () => {
  const argv = process.argv.slice(2);
  const force = argv.includes("--force");
  const onlyArg = argv.find((a) => a.startsWith("--only="));
  const only = onlyArg ? onlyArg.slice(7) : "";

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const log = [];
  let made = 0, skipped = 0, failed = 0;

  const list = only ? pages.filter((p) => p.slug === only) : pages;
  console.log(`gen-samples: ${list.length} page(s) to consider`);

  for (const p of list) {
    const file = path.join(OUT_DIR, p.slug + ".html");
    // Reuse only a COMPLETE sample; a truncated one is rebuilt automatically,
    // so re-running this script repairs previous partial failures.
    if (!force && fs.existsSync(file) && isComplete(fs.readFileSync(file, "utf8"))) {
      skipped++;
      continue;
    }
    process.stdout.write(`  [${made + failed + 1}/${list.length}] ${p.slug} ... `);
    const r = await buildOne(p);
    if (r) {
      fs.writeFileSync(file, r.html, "utf8");
      made++;
      console.log(`ok (${r.model}, ${r.html.length} bytes)`);
      log.push(`OK   ${p.slug} ${r.model} ${r.html.length}`);
    } else {
      failed++;
      console.log("FAILED");
      log.push(`FAIL ${p.slug}`);
    }
    await sleep(1500); // be polite to the free tier
  }

  fs.writeFileSync(path.join(OUT_DIR, "_log.txt"), log.join("\n") + "\n", "utf8");
  console.log(`\ngen-samples done: made=${made} skipped=${skipped} failed=${failed}`);
  console.log(`output: ${OUT_DIR}`);
})();
