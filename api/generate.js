// api/generate.js
// Vercel Serverless Function (Node.js). Keeps AI keys on the server.
// POST { grade, subject, topic, count, level, size } -> { html }
//
// Providers (tries in order, first success wins):
//   1) Groq        (if GROQ_API_KEY)      — fast, generous free tier, OpenAI-compatible
//   2) OpenRouter  (if OPENROUTER_API_KEY)
//   3) DeepSeek    (if DEEPSEEK_API_KEY)  — cheap PAID fallback, so the product
//                                            keeps working when a free tier
//                                            hits its rate limit.
// The model writes CONTENT; the client renders it. Each subject gets its own
// output structure, aligned to US Common Core ELA / NGSS.

const { mathScope } = require("../lib/curriculum");
const { blocked } = require("../lib/guard");

const PER_REQUEST_TIMEOUT_MS = 45000;

const GROQ_MODELS = (process.env.GROQ_MODEL || "openai/gpt-oss-120b,openai/gpt-oss-20b")
  .split(",").map((s) => s.trim()).filter(Boolean);
const OPENROUTER_MODELS = ["nvidia/nemotron-3-super-120b-a12b:free", "openrouter/free"];
// DeepSeek fallback: the official API name for V4.1 Flash (2026-09-10+) is
// "deepseek-flash" — there is no model id literally called "deepseek-v4.1".
// The retired V4 name "deepseek-v4-flash" stays as a second attempt in case
// the transition keeps it alive; a wrong name just fails over to the next.
const DEEPSEEK_MODELS = (process.env.DEEPSEEK_MODEL || "deepseek-flash,deepseek-v4-flash")
  .split(",").map((s) => s.trim()).filter(Boolean);

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  // Origin + gate-ticket check (see lib/guard.js): the site's own pages fetch a
  // signed ticket from /api/gate; bare scripts get 403 before touching the AI.
  if (blocked(req, res)) return;

  const { grade = "", subject = "", topic: topicRaw = "", count = 10, level = "standard", style = "mixed", student = "", notes = "" } = req.body || {};
  // Optional "personalize for my child" first name. Sanitized to letters / space /
  // apostrophe / hyphen and capped, so it can never become a prompt-injection or
  // markup vector (it is interpolated into the prompt below).
  const studentName = String(student || "").replace(/[^A-Za-z '-]/g, "").replace(/\s+/g, " ").trim().slice(0, 24);
  // Topic is capped so one request can never bloat the prompt (or the cost).
  const topic = String(topicRaw || "").replace(/[\u0000-\u001f]+/g, " ").trim().slice(0, 120);
  // Optional parent's own notes/preferences for THIS sheet. Same sanitation + a
  // hard 200-char cap (short, so it can never bloat the prompt or become an abuse
  // vector); injected as a NON-OVERRIDING rules layer in buildPrompt below.
  const extra = String(notes || "").replace(/[\u0000-\u001f]+/g, " ").trim().slice(0, 200);
  if (!topic) {
    res.status(400).json({ error: "Please enter a topic." });
    return;
  }

  if (req.body.mode === "relevel") {
    // Re-level an EXISTING worksheet: same skills, same question count, same
    // order - only the numbers, scaffolding and wording change. This is the
    // feature a worksheet library structurally cannot offer: a library sells
    // you three DIFFERENT worksheets, not one worksheet at three levels.
    const lvl = req.body.level === "challenge" ? "challenge" : "easier";
    const source = String(req.body.source || "").slice(0, 14000);
    if (!source || source.indexOf("ws-questions") < 0) {
      res.status(400).json({ error: "Nothing to re-level." });
      return;
    }
    const rl2 = await rateLimit(getClientIp(req));
    if (!rl2.ok) {
      res.status(429).json({ error: "You've reached today's limit. Please try again tomorrow." });
      return;
    }
    const rp = buildRelevelPrompt(grade, subject, topic, lvl, source);
    for (const a of buildAttempts()) {
      try {
        const raw = await callChat(a.url, a.key, a.model, rp);
        const html = stripCodeFences(raw);
        if (html && looksComplete(html)) {
          const checked = await proofread(html, grade, subject, topic);
          res.status(200).json({ html: checked.html, model: a.model, checked: checked.ran, level: lvl });
          return;
        }
      } catch (e) { /* try next */ }
    }
    res.status(502).json({ error: "Could not build that version. Please try again." });
    return;
  }

  if (req.body.mode === "rewrite") {
    const item = String(req.body.item || "").slice(0, 800);
    if (!item) { res.status(400).json({ error: "Nothing to rewrite." }); return; }
    const rrl = await rateLimit(getClientIp(req));
    if (!rrl.ok) {
      res.status(429).json({ error: "You've reached today's limit. Please try again tomorrow." });
      return;
    }
    const rPrompt = buildRewritePrompt(grade, subject, topic, item);
    for (const a of buildAttempts()) {
      try {
        const raw = await callChat(a.url, a.key, a.model, rPrompt);
        const html = stripCodeFences(raw);
        if (html) { res.status(200).json({ html, model: a.model }); return; }
      } catch (e) { /* try next */ }
    }
    res.status(502).json({ error: "Could not regenerate that question. Please try again." });
    return;
  }

  if (req.body.mode === "tweak") {
    // Adjust ONE existing question in place (free, like rewrite). The matching
    // answer-key entry is sent along and updated with it so tweaking the numbers
    // can never desync the key a parent marks from.
    const item = String(req.body.item || "").slice(0, 800);
    if (!item) { res.status(400).json({ error: "Nothing to adjust." }); return; }
    const instruction = String(req.body.instruction || "").replace(/[\u0000-\u001f]+/g, " ").trim().slice(0, 200);
    if (!instruction) { res.status(400).json({ error: "Please describe the change you want." }); return; }
    const answer = String(req.body.answer || "").slice(0, 400);
    const rtl = await rateLimit(getClientIp(req));
    if (!rtl.ok) {
      res.status(429).json({ error: "You've reached today's limit. Please try again tomorrow." });
      return;
    }
    const tPrompt = buildTweakPrompt(grade, subject, topic, item, answer, instruction);
    for (const a of buildAttempts()) {
      try {
        const raw = await callChat(a.url, a.key, a.model, tPrompt);
        const parsed = parseTweak(raw);
        if (parsed) { res.status(200).json({ html: parsed.question, answer: parsed.answer, model: a.model }); return; }
      } catch (e) { /* try next */ }
    }
    res.status(502).json({ error: "Could not adjust that question. Please try again." });
    return;
  }

  // The form offers 1 sheet-question; honor it (20 = Vercel 60s safety cap).
  const qCount = Math.min(20, Math.max(1, parseInt(count, 10) || 10));
  const prompt = buildPrompt(grade, subject, topic, qCount, level, style, studentName, extra);
  const attempts = buildAttempts();

  // Streaming mode: the page asks for real pipeline stages as SSE events
  // (writing -> checking) so the progress bar shows where the request ACTUALLY
  // is, then the final payload arrives as the last event.
  const wantsStream = req.body && req.body.stream === 1;
  let sseOpen = false;
  const emit = (obj) => {
    if (!wantsStream) return;
    if (!sseOpen) {
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache");
      sseOpen = true;
    }
    res.write("data: " + JSON.stringify(obj) + "\n\n");
  };
  const finish = (payload, status) => {
    if (wantsStream) {
      emit(Object.assign({ done: true }, payload));
      if (!res.writableEnded) res.end();
      return;
    }
    res.status(status || 200).json(payload);
  };

  if (!attempts.length) {
    finish({ html: demoSample(grade, subject, topic), demo: true });
    return;
  }

  const rl = await rateLimit(getClientIp(req));
  if (!rl.ok) {
    finish({ error: "You've reached today's worksheet limit. Please try again tomorrow." }, 429);
    return;
  }

  let lastError = "";
  emit({ stage: "writing" });
  for (const a of attempts) {
    try {
      const raw = await callChat(a.url, a.key, a.model, prompt);
      const html = stripCodeFences(raw);
      if (html && looksComplete(html)) {
        // Second pass: proofread the answer key before the sheet reaches a paying
        // customer. Parents grade WITH this answer key, so a wrong answer is the
        // most expensive kind of defect. Fail-open: if the check cannot run, we
        // still return the worksheet rather than an error.
        emit({ stage: "checking" });
        const checked = await proofread(html, grade, subject, topic);
        // Soundness gate: a sheet whose answer key admits the passage never
        // supported its questions (or leaks answers into questions) is worse
        // than no sheet — retry with the next model. If EVERY model misbehaves,
        // ship the last attempt (fail-open, same as before this gate existed).
        if (answerKeyIsSound(checked.html) || a === attempts[attempts.length - 1]) {
          finish({ html: checked.html, model: a.model, checked: checked.ran });
          return;
        }
        lastError = "Answer key was incomplete or off-passage; retrying with the next model.";
        emit({ stage: "writing" });
        continue;
      }
      lastError = html ? "Model returned an incomplete worksheet." : "Model returned an empty response.";
    } catch (err) {
      lastError = String(err && err.message ? err.message : err);
    }
  }

  const friendly = /rate limit|quota|429|per-day|exceeded/i.test(lastError)
    ? "The AI is at its daily/usage limit right now. Please try again later."
    : "AI request failed. Please try again in a moment.";
  finish({ error: friendly, detail: lastError }, 502);
};

function looksComplete(html) {
  if (!html || html.length < 150) return false;
  if (html.indexOf("ws-title") < 0) return false;
  if (html.indexOf("ws-questions") < 0 && html.indexOf("ws-prompt") < 0) return false;
  if (html.indexOf("</ol>") < 0 && html.indexOf("</div>") < 0) return false;
  // Meta-commentary in the answer key means the model could not do the task.
  // Seen live: "Answer cannot be verified; problem statement incomplete."
  // Restrict to the answers block — questions may legitimately say "incomplete".
  const a = String(html).match(/class="ws-answers"[\s\S]*?<\/ol>/i);
  if (a && /cannot be verified|problem statement (is )?incomplete|as an AI\b|I cannot/i.test(a[0])) return false;
  // The answer key must actually COVER the questions. Word-list subjects
  // intentionally have a couple fewer answers (sentences are "accept
  // reasonable"), so allow ~15% slack. Caught live: 4 answers for 15 questions.
  const qs = countListItems(String(html).match(/<ol[^>]*class="ws-questions"[\s\S]*?<\/ol>/i));
  const ans = countListItems(String(html).match(/<ol[^>]*class="ws-answers"[\s\S]*?<\/ol>/i));
  if (qs > 0 && ans > 0 && ans < qs * 0.85) return false;
  // A truncated response (model ran out of tokens) ends mid-tag: the answer-key
  // title exists but the <ol> never closes. Caught live: a vocabulary key cut
  // off mid "</li", shipped with half an answer key.
  if (/<h3[^>]*class="ws-answers-title"/i.test(html) && !/<ol[^>]*class="ws-answers"[\s\S]*?<\/ol>/i.test(html)) return false;
  if (!String(html).trim().endsWith(">")) return false;
  return true;
}

function countListItems(olMatch) {
  return olMatch ? (olMatch[0].match(/<li/gi) || []).length : 0;
}

// Second-stage soundness, run AFTER proofread: rejects sheets that are structurally
// complete but broken in content.
//  1. Answers leaked into questions — seen live: "…suspended in the air. (answer: cloud)"
//  2. Unanswerable questions shipped anyway — seen live: 4 of 8 answers said
//     "The source does not give a reason / does not mention …" for questions the
//     passage never supported. An honest answer key is still a broken worksheet.
function answerKeyIsSound(html) {
  const h = String(html || "");
  if (!h) return false;
  const q = (h.match(/<ol[^>]*class="ws-questions"[\s\S]*?<\/ol>/i) || [""])[0];
  if (/\(\s*answer\s*[:=]/i.test(q)) return false;
  const aMatch = h.match(/<ol[^>]*class="ws-answers"[\s\S]*?<\/ol>/i);
  if (/<h3[^>]*class="ws-answers-title"/i.test(h) && !aMatch) return false; // truncated key
  const a = aMatch ? aMatch[0] : "";
  if (a && /(passage|source|text|story)\s+(does not|doesn't|did not)\s|(not|never)\s+(mentioned|stated|described|named|given|listed|explained)\s+in\s+the\s+(passage|source|text|story)/i.test(a)) return false;
  return true;
}

// ===========================================================================
// ANSWER-KEY PROOFREADING (second pass)
// ===========================================================================
// WHY THIS EXISTS
// A 2026-10-05 audit of live output found the answer key can be flatly wrong.
// Real example: a Grade 2 reading sheet whose answer key said the water cycle
// has three steps "evaporation, condensation, precipitation" — but the passage
// never used the word "precipitation" and it is far above Grade 2 vocabulary.
// Parents grade their children WITH this key, so a wrong answer is the most
// expensive defect the product can ship. Before this there was no check at all:
// the only guard was one line in the prompt ("Double-check every answer").
//
// TWO LAYERS
//  1. checkMath() — deterministic. Parses pure-computation items, recomputes
//     them in integer/fraction arithmetic and flags mismatches. Exact, but only
//     covers questions it can parse unambiguously.
//  2. proofread() — asks the model to re-check every question/answer pair with
//     a proofreader framing, and patch what it finds. Broad, but a safety net
//     rather than a proof.
// Both fail open: if anything goes wrong we return the original worksheet
// rather than an error, so the product never gets worse because of a check.

const SKIP_CHECK = () => !!process.env.SKIP_ANSWER_CHECK;

async function proofread(html, grade, subject, topic) {
  if (SKIP_CHECK()) return { html, ran: false };
  try {
    const calc = checkMath(html); // deterministic arithmetic pass (no network)

    const pairs = extractQA(calc.html);
    if (pairs.length < 2) return { html: calc.html, ran: calc.wrong.length > 0 };

    const source = extractPassage(calc.html) || extractWordlist(calc.html);
    const prompt = buildProofreadPrompt(grade, subject, topic, pairs, calc.wrong, source);
    for (const a of buildAttempts()) {
      try {
        const raw = await callChat(a.url, a.key, a.model, prompt);
        const wrong = parseWrong(raw);
        if (wrong) {
          return { html: applyFixes(calc.html, mergeWrong(calc.wrong, wrong)), ran: true };
        }
      } catch (e) { /* try the next provider */ }
    }
    // Model pass unavailable — still apply what arithmetic proved for certain.
    return { html: applyFixes(calc.html, calc.wrong), ran: true };
  } catch (e) {
    return { html, ran: false };
  }
}

// Deterministic check for pure-computation items. Never touches word problems:
// if either operand cannot be parsed exactly, the question is skipped.
function checkMath(html) {
  const wrong = [];
  try {
    const qBlock = olInner(html, "ws-questions");
    const aBlock = olInner(html, "ws-answers");
    if (!qBlock || !aBlock) return { html, wrong };

    const qs = listItems(qBlock);
    const as = listItems(aBlock);
    const n = Math.min(qs.length, as.length);

    for (let i = 0; i < n; i++) {
      const val = computeFromQuestion(plainText(qs[i]));
      if (!val) continue;
      const shown = leadingValue(plainText(as[i]));
      if (!shown) continue;
      if (!numEq(fSimp(val), fSimp(shown))) {
        wrong.push({ n: i + 1, answer: fracTex(fSimp(val)) });
      }
    }
  } catch (e) { /* fail open */ }
  return { html, wrong };
}

function normMath(s) {
  return String(s == null ? "" : s)
    .replace(/\u2212/g, "-")
    .replace(/\u00d7/g, "\\times")
    .replace(/\u00f7/g, "\\div");
}

// Returns {n,d} or null. Accepts \frac{a}{b}, mixed a\frac{b}{c}, a/b, and integers.
function parseNum(s) {
  const t = normMath(s).replace(/\s+/g, " ").trim();
  let m = t.match(/^(-?\d+)\s*\\frac\{(-?\d+)\}\{(-?\d+)\}$/);
  if (m && +m[3]) return { n: +m[1] * +m[3] + +m[2], d: +m[3] };
  m = t.match(/^\\frac\{(-?\d+)\}\{(-?\d+)\}$/);
  if (m && +m[2]) return { n: +m[1], d: +m[2] };
  m = t.match(/^(-?\d+)\s*\/\s*(-?\d+)$/);
  if (m && +m[2]) return { n: +m[1], d: +m[2] };
  m = t.match(/^(-?\d+)$/);
  if (m) return { n: +m[1], d: 1 };
  return null;
}

function gcdInt(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) { const t = a % b; a = b; b = t; } return a; }

function fSimp(f) {
  if (!f || !f.d) return f;
  const g = gcdInt(f.n, f.d) || 1;
  let n = f.n / g, d = f.d / g;
  if (d < 0) { n = -n; d = -d; }
  return { n, d };
}
function fAdd(x, y) { return { n: x.n * y.d + y.n * x.d, d: x.d * y.d }; }
function fSub(x, y) { return { n: x.n * y.d - y.n * x.d, d: x.d * y.d }; }
function fMul(x, y) { return { n: x.n * y.n, d: x.d * y.d }; }
function fDiv(x, y) { return y.n === 0 ? null : { n: x.n * y.d, d: x.d * y.n }; }
function numEq(a, b) { return !!a && !!b && a.n * b.d === b.n * a.d; }
function fracTex(f) { return !f || f.d === 1 ? String(f ? f.n : "") : "\\frac{" + f.n + "}{" + f.d + "}"; }

// Only returns a value when the item is UNAMBIGUOUSLY a bare computation:
// the right-hand side of "=" must be blank (or absent) and both operands must
// parse exactly. Anything wordy is skipped rather than guessed at.
function computeFromQuestion(q) {
  const t = normMath(q).replace(/\s+/g, " ").trim();
  const eq = t.indexOf("=");
  const left = eq < 0 ? t : t.slice(0, eq);
  if (eq >= 0) {
    // strip answer-slot markup, then reject if a real word follows the "="
    const right = t.slice(eq + 1)
      .replace(/\\[a-zA-Z]+\{[^{}]*\}/g, "")
      .replace(/[\\{}_?.!]/g, "")
      .replace(/\s+/g, "");
    if (/[a-zA-Z]/.test(right)) return null;
  }
  return computeFromLeft(left);
}

function computeFromLeft(leftRaw) {
  let s = normMath(leftRaw).replace(/\s+/g, " ").trim();
  s = s.replace(/^(solve|compute|calculate|find|add|subtract|multiply|divide)\s*[:.]?\s*/i, "");
  s = s.replace(/^[^0-9\\-]+/, "");
  s = s.replace(/[?.]+\s*$/, "");
  if (!s) return null;

  const ops = [
    [/\\times/, fMul],
    [/\\div/, fDiv],
    [/\+/, fAdd],
    [/[-]/, fSub],
  ];
  for (const [sep, fn] of ops) {
    const m = s.match(sep);
    if (!m || m.index === 0) continue;
    const x = parseNum(s.slice(0, m.index));
    const y = parseNum(s.slice(m.index + m[0].length));
    if (x && y) {
      const r = fn(x, y);
      if (r && r.d) return r;
    }
  }
  return null;
}

// Leading numeric value of an answer, e.g. "\frac{3}{5} - add the numerators" -> 3/5
function leadingValue(t) {
  const s = normMath(t).replace(/\s+/g, " ").trim();
  const m = s.match(/^(-?\d+\s*\\frac\{-?\d+\}\{-?\d+\}|\\frac\{-?\d+\}\{-?\d+\}|-?\d+\s*\/\s*-?\d+|-?\d+)/);
  return m ? parseNum(m[1]) : null;
}

function olInner(html, cls) {
  const re = new RegExp('<ol[^>]*class="' + cls + '"[^>]*>([\\s\\S]*?)</ol>', "i");
  const m = String(html).match(re);
  return m ? m[1] : "";
}

function listItems(block) {
  const out = [];
  const re = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  let m;
  while ((m = re.exec(block))) out.push(m[1]);
  return out;
}

function plainText(html) {
  return String(html == null ? "" : html)
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function extractQA(html) {
  const qs = listItems(olInner(html, "ws-questions"));
  const as = listItems(olInner(html, "ws-answers"));
  const n = Math.min(qs.length, as.length);
  const pairs = [];
  for (let i = 0; i < n; i++) pairs.push({ n: i + 1, q: plainText(qs[i]), a: plainText(as[i]) });
  return pairs;
}

// Reading / science / social answers can only be checked against the source
// text, so the passage must travel with the question list. (First version of
// this code forgot to send it, and the proofreader silently passed a reading
// answer that used a word the passage never contained.)
function extractPassage(html) {
  const m = String(html).match(/<div[^>]*class="ws-passage"[^>]*>([\s\S]*?)<\/div>/i);
  return m ? plainText(m[1]) : "";
}

function extractWordlist(html) {
  const m = String(html).match(/<div[^>]*class="ws-wordlist"[^>]*>([\s\S]*?)<\/div>/i);
  if (!m) return "";
  const words = [];
  const re = /<span[^>]*class="word"[^>]*>([\s\S]*?)<\/span>/gi;
  let x;
  while ((x = re.exec(m[1]))) words.push(plainText(x[1]));
  return words.join(", ");
}

function buildProofreadPrompt(grade, subject, topic, pairs, knownWrong, source) {
  const body = pairs.map((p) => p.n + ". Q: " + p.q + "\n   A: " + p.a).join("\n");
  const known = (knownWrong || []).length
    ? "\nALREADY CONFIRMED WRONG by an exact arithmetic check — you MUST correct these, keeping the same brief-reasoning style:\n" +
      knownWrong.map((w) => "  #" + w.n + " correct value is " + w.answer).join("\n") + "\n"
    : "";
  const src = source
    ? "\nTHE ONLY SOURCE TEXT THE STUDENT WAS GIVEN\n\"\"\"\n" + source + "\n\"\"\"\n" +
      "An answer that relies on a fact, word or term THAT DOES NOT APPEAR in the source text above is WRONG —\n" +
      "rewrite it so it can be answered from the source text alone, at the stated grade level.\n"
    : "";
  return `You are a meticulous proofreader checking the answer key of a Grade ${grade} ${subject} worksheet on "${topic}".

Check EVERY answer below:
- Recompute any arithmetic yourself. Do not trust the stated answer.
- Does the answer actually answer the question that was asked?
- Is the answer right for this grade level? A word or idea far above the grade is a defect.
- Check every answer against the source text and the word list, if given, not against your own general knowledge.
- For famous people, places, and historical events, ALSO verify the facts against your own knowledge (who they were, what they did, adult or child) — a simplified worksheet must never state a factually wrong claim about them.
${src}${known}
QUESTIONS AND ANSWERS
${body}

Return ONLY minified JSON — no prose, no markdown, no code fence:
{"wrong":[{"n":<question number>,"answer":"<the corrected answer, same brief-reasoning style as the original>"}]}
If every answer is correct, return exactly: {"wrong":[]}`;
}

function parseWrong(raw) {
  const t = stripCodeFences(raw);
  const m = t.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]);
    if (!o || !Array.isArray(o.wrong)) return null;
    return o.wrong
      .filter((w) => w && Number.isFinite(Number(w.n)) && typeof w.answer === "string" && w.answer.trim())
      .map((w) => ({ n: Number(w.n), answer: w.answer.trim() }));
  } catch (e) {
    return null;
  }
}

// Deterministic findings and model findings merged; the model's version wins
// because it carries the reasoning text.
function mergeWrong(det, llm) {
  const m = new Map();
  for (const w of det || []) m.set(w.n, w.answer);
  for (const w of llm || []) m.set(w.n, w.answer);
  return Array.from(m.entries()).map(([n, answer]) => ({ n, answer }));
}

function applyFixes(html, wrong) {
  if (!wrong || !wrong.length) return html;
  const byN = new Map(wrong.map((w) => [w.n, w.answer]));
  return String(html).replace(
    /(<ol[^>]*class="ws-answers"[^>]*>)([\s\S]*?)(<\/ol>)/i,
    (all, open, inner, close) => {
      let i = 0;
      const fixed = inner.replace(/<li([^>]*)>([\s\S]*?)<\/li>/gi, (m, attrs, _content) => {
        i += 1;
        return byN.has(i) ? "<li" + attrs + ">" + esc(byN.get(i)) + "</li>" : m;
      });
      return open + fixed + close;
    }
  );
}

function getClientIp(req) {
  const xff = (req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return xff || req.headers["x-real-ip"] || "unknown";
}

// Per-IP daily cap (anti-abuse). Uses Upstash when configured, otherwise falls back
// to a per-instance in-memory counter. The fallback is imperfect across instances but
// it is the difference between "one viral pin kills the Groq quota" and "it doesn't".
const MEM = new Map();
const BUDGET = new Map();
async function rateLimit(ip) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  const day = new Date().toISOString().slice(0, 10);
  // The trailing "|| default" matters: a non-numeric env var makes parseInt
  // return NaN, and every "<count> <= NaN" comparison is false — i.e. one typo
  // in a Vercel variable would 429 the entire site. Fall back to the default.
  const perIpLimit = Math.max(1, parseInt(process.env.DAILY_LIMIT_PER_IP || "100", 10) || 100);
  // Hard ceiling on the whole site's generations per day: bounds worst-case AI
  // spend even when an abuser rotates IPs. Tuned far above real traffic.
  const budget = Math.max(50, parseInt(process.env.GLOBAL_DAILY_BUDGET || "3000", 10) || 3000);
  if (!url || !token) return memRateLimit(ip, day, perIpLimit, budget);
  const key = "rl:" + ip + ":" + day;
  try {
    const r = await fetch(url.replace(/\/$/, "") + "/pipeline", {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify([["INCR", key], ["EXPIRE", key, 172800], ["INCR", "budget:" + day], ["EXPIRE", "budget:" + day, 172800]]),
    });
    const data = await r.json();
    const ipCount = data && data[0] && data[0].result;
    const totalCount = data && data[2] && data[2].result;
    if (typeof ipCount === "number" && typeof totalCount === "number") {
      return { ok: ipCount <= perIpLimit && totalCount <= budget, count: ipCount, limit: perIpLimit, via: "upstash" };
    }
    return { ok: true };
  } catch (e) {
    return memRateLimit(ip, day, perIpLimit, budget);
  }
}

function memRateLimit(ip, day, perIpLimit, budget) {
  const limit = Math.max(10, parseInt(process.env.MEM_LIMIT_PER_IP_DAY || "60", 10) || 60);
  const key = ip + ":" + day;
  const n = (MEM.get(key) || 0) + 1;
  MEM.set(key, n);
  const b = (BUDGET.get(day) || 0) + 1;
  BUDGET.set(day, b);
  if (MEM.size > 20000) MEM.clear(); // crude bound; entries expire by day key anyway
  return { ok: n <= limit && b <= budget, count: n, limit: limit, via: "memory" };
}

function buildAttempts() {
  const attempts = [];
  if (process.env.GROQ_API_KEY) {
    GROQ_MODELS.forEach((m) => attempts.push({
      url: "https://api.groq.com/openai/v1/chat/completions",
      key: process.env.GROQ_API_KEY, model: m,
    }));
  }
  if (process.env.OPENROUTER_API_KEY) {
    OPENROUTER_MODELS.forEach((m) => attempts.push({
      url: "https://openrouter.ai/api/v1/chat/completions",
      key: process.env.OPENROUTER_API_KEY, model: m,
    }));
  }
  if (process.env.DEEPSEEK_API_KEY) {
    DEEPSEEK_MODELS.forEach((m) => attempts.push({
      url: "https://api.deepseek.com/chat/completions",
      key: process.env.DEEPSEEK_API_KEY, model: m,
    }));
  }
  return attempts;
}

async function callChat(url, key, model, prompt) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PER_REQUEST_TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }] }),
      signal: controller.signal,
    });
    const data = await r.json();
    if (!r.ok) {
      throw new Error((data.error && data.error.message) || ("HTTP " + r.status));
    }
    return (
      (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || ""
    );
  } finally {
    clearTimeout(timer);
  }
}

const NAME_DATE = '<p class="ws-name"><span>Name: ____________</span><span>Date: ____________</span><span>Score: ______</span></p>';

function levelLine(level) {
  if (level === "easier") return "\n- DIFFICULTY: make the items a little EASIER — more support, simpler numbers/words.";
  if (level === "challenge") return "\n- DIFFICULTY: make the items more CHALLENGING — a stretch for strong students.";
  return "";
}

function buildRewritePrompt(grade, subject, topic, item) {
  return `You are an experienced U.S. elementary school teacher. Here is ONE question from a Grade ${grade} ${subject} worksheet on "${topic}":

${item}

Rewrite it as a SINGLE new question that tests the SAME skill but is clearer and different (new numbers or context). Return ONLY that one question as an HTML fragment using the SAME tags and class names as the original (do NOT wrap it in <li>). Keep math in LaTeX (\\frac, \\times, \\div) and never use $ as a math delimiter.`;
}

// Instruction-based tweak: keep THIS question, change only what the parent asks.
// Unlike rewrite (which replaces the question with a different one), a tweak must
// stay recognisably the SAME question. The answer-key entry travels with it so a
// change to the numbers can never leave the key out of sync.
function buildTweakPrompt(grade, subject, topic, item, answer, instruction) {
  return `You are an experienced U.S. elementary school teacher.
Here is ONE question from a Grade ${grade} ${subject} worksheet on "${topic}":

${item}

Its current answer-key entry is:
${answer || "(none)"}

A parent wants ONE specific change to THIS SAME question: "${instruction}"

Apply ONLY that change and keep the question otherwise identical — same skill, same question type, same structure and phrasing. Do NOT replace it with a different question. If the change alters the numbers or the answer, update the answer to match. Keep math in LaTeX (\\frac, \\times, \\div); never use the dollar sign as a math delimiter; the sheet is text-only.

Return ONLY minified JSON with exactly two string fields:
{"question":"<the revised question as an HTML fragment with the SAME tags/classes as the original, NOT wrapped in <li>>","answer":"<the revised answer-key entry as plain text or a short HTML fragment>"}`;
}

// Reads the {question, answer} JSON a tweak returns, tolerating ```json fences
// or stray prose around it.
function parseTweak(raw) {
  const s = String(raw == null ? "" : raw);
  const i = s.indexOf("{");
  const j = s.lastIndexOf("}");
  if (i < 0 || j <= i) return null;
  try {
    const o = JSON.parse(s.slice(i, j + 1));
    if (o && typeof o.question === "string" && o.question.trim()) {
      return { question: o.question, answer: typeof o.answer === "string" ? o.answer : "" };
    }
  } catch (e) { /* not valid JSON — fall through */ }
  return null;
}

// Re-levels a whole worksheet. This is deliberately NOT a fresh generation:
// the point is that question 3 of the Easier sheet and question 3 of the
// Challenge sheet are the SAME question, so a parent can teach one lesson to
// two children at different levels and mark both against one answer key.
// A worksheet library structurally cannot do this - it sells three different
// worksheets, not one worksheet at three levels.
function buildRelevelPrompt(grade, subject, topic, level, source) {
  const how = level === "easier"
    ? [
        "Use SMALLER numbers and simpler wording.",
        "Add scaffolding: give the first step, or state the method in the instruction.",
        "Use short, concrete sentences and familiar contexts.",
        "If a question needs several steps, reduce it to one step.",
      ]
    : [
        "Use LARGER numbers and less obvious wording.",
        "Remove scaffolding: no hint about the method, no given first step.",
        "Where it fits, add ONE extra step to the same skill (a two-step version).",
        "Use a less obvious context or a slightly more demanding phrasing.",
      ];
  return `You are an experienced U.S. elementary school teacher.

Below is a complete Grade ${grade} ${subject} worksheet on "${topic}".
Produce the ${level.toUpperCase()} version of THIS SAME worksheet.

HOW TO CHANGE IT
${how.map((h) => "- " + h).join("\n")}

WHAT MUST NOT CHANGE
- The SKILL tested, question by question. Question 3 must still test what question 3 tested.
- The NUMBER of questions and their ORDER. Question 3 stays question 3.
- The HTML structure and every class name: same tags, same <ol class="ws-questions">, same <hr class="ws-pagebreak">, same Answer Key block.
- Math stays in LaTeX (\\frac{1}{4}, \\times, \\div). Never use the dollar sign as a math delimiter.
- Any <div class="ws-visual" data-visual="..."> line stays as it is, unless its numbers must change to match the new question.

ALSO
- Change the title so it ends with " \u2014 ${level === "easier" ? "Easier" : "Challenge"}".
- Recompute the ENTIRE Answer Key for the new questions, keeping the same brief reasoning style.
- Return ONLY the HTML fragment. No <html>, no markdown, no code fences.

WORKSHEET TO RE-LEVEL
${source}`;
}

function buildPrompt(grade, subject, topic, count, level, style, student, extra) {
  const s = String(subject || "").toLowerCase();
  const head = `You are an experienced U.S. elementary school teacher creating a printable worksheet for a homeschool family.

Grade level: ${grade} (U.S. grade level). Subject: ${subject}. Topic: ${topic}.

GENERAL RULES
- Match the concepts and difficulty to U.S. standards for this grade (Common Core / NGSS style).
- Use U.S. contexts and conventions (U.S. names, U.S. spelling).
- The worksheet is TEXT-ONLY: never ask students to match, circle, or point at pictures, images, maps or audio — those cannot be rendered on a printed page.
- If the topic names a holiday, season, or theme, the WHOLE worksheet must feel themed at first glance: keep the theme in the title AND the instructions line, and thread it through every question you can — word problems obviously, and for bare computation prefer themed contexts ("Each bag holds 7 candies. 8 bags: 7 × 8 = ___") instead of generic "7 × 8 = ___". Never let a themed topic produce a sheet that looks like any other day.${student ? `
- PERSONALIZE: this worksheet is for a specific child. Use the first name "${student}" as the main character in EVERY word problem, story and reading passage (instead of generic names). Use ONLY that first name, spelled exactly like that.` : ""}${extra ? `
- EXTRA REQUIREMENTS (the parent's own notes for THIS sheet; honor them whenever they do NOT conflict with the rules above. If a note conflicts with the grade level, the subject, the text-only rule, or the answer-key rules, the rules above ALWAYS win): ${extra}` : ""}
- Grades K–2: keep wording very short and concrete.${levelLine(level)}
- The output MUST be a ${subject} worksheet. Follow the SUBJECT strictly, even if the topic wording could also fit another subject.
- In the Answer Key, give a brief step or reason for each answer (parents find this very useful).
- Return ONLY an HTML fragment (no <html>/<body>, no markdown or code fences), using EXACTLY the class names shown.`;

  if (s.indexOf("math") >= 0) return head + mathScope(grade) + mathBlock(count, style);
  if (s.indexOf("read") >= 0) return head + readingBlock(count, grade);
  if (s.indexOf("spell") >= 0 || s.indexOf("phonic") >= 0) return head + spellingBlock(count, grade);
  if (s.indexOf("vocab") >= 0) return head + vocabBlock(count, grade);
  if (s.indexOf("grammar") >= 0 || s.indexOf("language") >= 0) return head + grammarBlock(count, grade);
  if (s.indexOf("writ") >= 0) return head + writingBlock(grade);
  if (s.indexOf("science") >= 0) return head + scienceBlock(count, grade);
  if (s.indexOf("social") >= 0 || s.indexOf("history") >= 0) return head + socialBlock(count, grade);
  return head + readingBlock(count, grade);
}

function mathBlock(count, style) {
  const q = Array.from({ length: count }, () => "  <li>…</li>").join("\n");
  const st = String(style || "mixed").toLowerCase();
  let mix;
  if (st.indexOf("comp") >= 0) {
    mix = "- ALL " + count + " questions MUST be STRAIGHT COMPUTATION: only numbers, operators and an answer blank — NO story, NO context. Examples: \\frac{3}{4} + \\frac{1}{4} = ___ , Simplify \\frac{6}{8} = ___ , 5 \\times \\frac{2}{3} = ___";
  } else if (st.indexOf("word") >= 0) {
    mix = "- ALL " + count + " questions MUST be WORD PROBLEMS: a short real-life story (U.S. context) with numbers to solve.";
  } else {
    mix = "- Mix: MOST questions (at least 60%, e.g. 6 of 10) MUST be DIRECT COMPUTATION (numbers/operators/blank, NO story). Then about 2 word problems and about 2 visual/conceptual questions.";
  }
  return `

CONTENT
${mix}
- Provide EXACTLY ${count} questions. Double-check every answer.

MATH FORMATTING (very important)
- Write math using LaTeX commands ONLY: fractions as \\frac{1}{4}, multiplication as \\times, division as \\div, mixed numbers as 1\\frac{1}{2}.
- NEVER use the dollar sign ($) as a math delimiter. Do NOT write $4$ or $4 \\times 7$; write 4 \\times 7.
- A $ appears only for a real money amount in a money problem, with a SINGLE $ (e.g. "Mia has $5").

VISUALS (use ONE when it directly supports the question; 1–4 times across the sheet)
Insert on its own line inside the relevant <li>:
<div class="ws-visual" data-visual="TYPE" ATTRS></div>
Types: number-line (data-min data-max data-ticks) | fraction-bar (data-num data-den) | fraction-circle (data-num data-den) | ten-frame (data-count) | array (data-rows data-cols) | place-value (data-number) | vertical (data-a data-b data-op — column arithmetic)
For column/vertical addition or subtraction problems, use a vertical visual, e.g.:
  <li>Solve. <div class="ws-visual" data-visual="vertical" data-a="345" data-b="128" data-op="+"></div></li>

OUTPUT (exact structure)
<h2 class="ws-title">Title</h2>
<p class="ws-instructions">One clear instruction sentence.</p>
${NAME_DATE}
<ol class="ws-questions">
${q}
</ol>
<hr class="ws-pagebreak">
<h3 class="ws-answers-title">Answer Key</h3>
<ol class="ws-answers">
${q}
</ol>`;
}

function readingBlock(count, grade) {
  const kInstruction = String(grade).toUpperCase() === "K"
    ? "Answer each question with one or two words."
    : "Then answer the questions in complete sentences.";
  return `

STRUCTURE — Reading comprehension (Common Core Reading Literature/Informational)
- Write an ORIGINAL, age-appropriate passage (never copy a published text).
  Length by grade: K–1 ≈ 40–60 words; grades 2–3 ≈ 90–140 words; grades 4–5 ≈ 160–220 words.
  Vocabulary and sentence length must match the grade (K–1: decodable short sentences; 4–5: real informational density).
- Provide EXACTLY ${count} comprehension questions (literal, main idea, and at least one "how do you know / why").
- EVERY question must be answerable from the passage ALONE. Never ask about details, reasons, or examples the passage does not contain.
- After the questions, add ONE graphic organizer that fits the passage.

OUTPUT (exact structure)
<h2 class="ws-title">Title</h2>
<p class="ws-instructions">Read the passage. ${kInstruction}</p>
${NAME_DATE}
<div class="ws-passage">
  <p>…the passage (1–2 short paragraphs)…</p>
</div>
<ol class="ws-questions">
  <li>…</li>
</ol>
<div class="ws-visual" data-visual="organizer" data-kind="main-idea"></div>
<hr class="ws-pagebreak">
<h3 class="ws-answers-title">Answer Key</h3>
<ol class="ws-answers">
  <li>… (for "how do you know" questions, quote the sentence from the passage)</li>
</ol>`;
}

function spellingBlock(count, grade) {
  return `

STRUCTURE — Spelling / Phonics (Common Core Foundational Skills; Dolch/Fry sight words)
- Pick ONE pattern from THIS grade's list (never a pattern from another grade):
  K: short vowels (CVC), word families
  1: digraphs (sh/ch/th), beginning blends, silent-e long vowels
  2: vowel teams (ai/ay, oa/ee/ea), r-controlled (ar/or/er), inflections (-ed/-ing)
  3: homophones, contractions, plural spellings, three-letter blends
  4: irregular plurals, tricky homophones (their/there/they're), multisyllabic words
  5: Greek/Latin roots, unspoken letters, -tion/-sion endings, commonly confused words
  (Grades 3–5 must NEVER get CVC or vowel-team lists — those are K–2 skills.)
- Provide EXACTLY 10 words that ALL truly follow the pattern. Every word must be a clean example:
  e.g. in a silent-e list, never include exceptions like "love", "have", "give" (the e does not make the vowel long there).
- Output exactly 10 <span class="word"> elements and NOTHING between them — no dots, commas or numbering.
- Part B items depend on the pattern:
  phonics patterns (K–2): letter blanks — remove the SAME sound/letters from every word (rain → r _ n)
  homophones / commonly confused words (3–5): short CONTEXT SENTENCES with a blank — the student writes the correct homophone ("The dog wagged ___ tail."); never just remove the first letter.

OUTPUT (exact structure)
<h2 class="ws-title">Spelling: <the pattern></h2>
<p class="ws-instructions">Read the words. Then complete the activities below.</p>
${NAME_DATE}
<div class="ws-wordlist">
  <span class="word">word1</span><span class="word">word2</span> … (10 total, no separators)
</div>
<p class="ws-sub">A. Write each word two times.  B. Fill in the missing letters.  C. Use two words in a sentence.</p>
<ol class="ws-questions">
  <li>c _ t</li>  (one letter-blank item for EACH of the 10 words — 10 items total)
  <li>Write a sentence using "…".</li>
  <li>Write a sentence using "…".</li>
</ol>
<hr class="ws-pagebreak">
<h3 class="ws-answers-title">Answer Key</h3>
<ol class="ws-answers">
  <li>cat</li>  (the completed words; then a natural, meaningful example sentence for EACH sentence prompt — never a bare word list)
</ol>`;
}

function vocabBlock(count, grade) {
  return `

STRUCTURE — Vocabulary (Common Core Language; context clues)
- Choose 8 vocabulary words on the topic at THIS grade's level (never easier, never harder):
  K–1: everyday concrete words (dog, big, run)
  2: common words slightly above the grade's reading level
  3: affix-based words (un-, re-, pre-, -ful, -less, -ness)
  4: academic and multiple-meaning words across subjects
  5: subject-specific academic vocabulary (precise, domain-level words)
- NEVER print the answer inside a question — no "(answer: …)" anywhere in the questions.
- Every fill-in-the-blank sentence must make obvious sense with exactly ONE word from the bank
  (read it back: if the "correct" word makes the sentence strange, rewrite the sentence).

OUTPUT (exact structure)
<h2 class="ws-title">Vocabulary: <topic></h2>
<p class="ws-instructions">Use the word bank to complete each activity.</p>
${NAME_DATE}
<div class="ws-wordlist">
  <span class="word">word1</span><span class="word">word2</span> … (8 total, no separators)
</div>
<p class="ws-sub">A. Match each word to its meaning.  B. Fill in the blank.  C. Write your own sentence for two words.</p>
<ol class="ws-questions">
  <li>definition of one word (students match the word)</li>  (8)
  <li>sentence with a blank using one of the words</li>  (5)
  <li>Write a sentence using "…".</li>
  <li>Write a sentence using "…".</li>
</ol>
<hr class="ws-pagebreak">
<h3 class="ws-answers-title">Answer Key</h3>
<ol class="ws-answers">
  <li>…</li>
</ol>`;
}

function grammarBlock(count, grade) {
  return `

STRUCTURE — Grammar / Language (Common Core Language conventions)
- Focus on ONE skill from THIS grade's list (never a skill from another grade):
  K–1: capitalizing first words & names, ending punctuation, naming nouns/verbs
  2: plural nouns, subject-verb agreement, contractions, simple compound sentences
  3: verb tenses (consistency), pronouns, abstract nouns, comparative adjectives
  4: comma rules, dialogue punctuation, ordering adjectives, frequently confused words
  5: comma + coordinating conjunction, semicolons, intro/parenthetical clauses, verb consistency
- Every item must have ONE clearly correct answer — avoid ambiguous sentences
  (e.g. don't build a comma-list item around words that could be read as a single title).

OUTPUT (exact structure)
<h2 class="ws-title">Grammar: <the skill></h2>
<p class="ws-instructions">Rewrite each sentence correctly. / Circle the nouns. (pick what fits)</p>
${NAME_DATE}
<ol class="ws-questions">
  <li>…a sentence that needs fixing, or an item to label…</li>  (EXACTLY ${count} total)
</ol>
<hr class="ws-pagebreak">
<h3 class="ws-answers-title">Answer Key</h3>
<ol class="ws-answers">
  <li>the corrected sentence — and the rule in (parentheses)</li>  (${count} total)
</ol>`;
}

function writingBlock(grade) {
  return `

STRUCTURE — Writing (Common Core Writing: opinion / informative / narrative)
- Genre by grade:
  K–1: personal narrative (a day, a pet) — 1–2 simple sentences expected
  2: opinion (best pet, best season) or personal narrative paragraph
  3: opinion with 2–3 supporting reasons
  4: informative how-to/explanatory or narrative with concrete details
  5: informative, opinion, or narrative with clear structure (intro, details, ending)

OUTPUT (exact structure — NO answer key)
<h2 class="ws-title">Writing Prompt</h2>
<p class="ws-instructions">Plan your ideas, then write your response on the lines below.</p>
${NAME_DATE}
<div class="ws-prompt">
  <p>…the writing prompt (1–2 sentences), plus the purpose/audience…</p>
</div>
<p class="ws-sub">Plan: What is your main idea? What are 2–3 details or reasons?</p>
<div class="ws-lines"></div>
<p class="ws-checklist">&check; Capital letters  &check; Punctuation  &check; Complete sentences  &check; Clear main idea</p>

IMPORTANT: the <div class="ws-lines"></div> must stay EMPTY — the ruled lines are drawn automatically.
Never write underscores or text inside it.`;
}

function scienceBlock(count, grade) {
  return `

STRUCTURE — Science (NGSS)
- Write a short, accurate, grade-appropriate informational text (≈ 80–140 words).
- Typical NGSS themes: K = weather, pushes & pulls, what living things need; 1 = light & sound, plant/animal parts, patterns in the sky; 2 = states of matter, habitats, wind & water change land; 3 = life cycles, weather & climate, balanced forces, fossils; 4 = energy, waves, earth's features, plate tectonics; 5 = matter & its properties, ecosystems & food webs, earth's systems, stars & space.
- EVERY question must be answerable from the text ALONE — never ask about facts, reasons, or examples the text does not contain.

OUTPUT (exact structure)
<h2 class="ws-title">Title</h2>
<p class="ws-instructions">Read the text. Then answer the questions.</p>
${NAME_DATE}
<div class="ws-passage">
  <p>…the informational text…</p>
</div>
<ol class="ws-questions">
  <li>…</li>  (EXACTLY ${count} questions: recall + explain WHY)
</ol>
<div class="ws-visual" data-visual="organizer" data-kind="kwl"></div>
<hr class="ws-pagebreak">
<h3 class="ws-answers-title">Answer Key</h3>
<ol class="ws-answers">
  <li>…</li>
</ol>`;
}

function socialBlock(count, grade) {
  return `

STRUCTURE — Social Studies / History
- Write a short, accurate, grade-appropriate informational text (≈ 80–140 words).
- Typical K–5 themes: K = family/community; G1 = symbols & family history; G2 = people who made a difference; G3 = local history; G4 = state history & U.S. regions; G5 = early U.S. history.
- Keep every historical fact you are confident about; avoid invented precise dates/numbers.
- Simplifying for young grades must NEVER change the facts: real roles, real actions, real adult/child status (a famous activist is never "a young girl").
- EVERY question must be answerable from the text ALONE — never ask about details the text does not contain.

OUTPUT (exact structure)
<h2 class="ws-title">Title</h2>
<p class="ws-instructions">Read the text. Then answer the questions.</p>
${NAME_DATE}
<div class="ws-passage">
  <p>…the informational text…</p>
</div>
<ol class="ws-questions">
  <li>…</li>  (EXACTLY ${count} questions)
</ol>
<hr class="ws-pagebreak">
<h3 class="ws-answers-title">Answer Key</h3>
<ol class="ws-answers">
  <li>…</li>
</ol>`;
}

function stripCodeFences(text) {
  return String(text)
    .replace(/^\s*```(?:html)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    // Models sometimes leave their own notes in the markup ("<!-- Matching
    // definitions answers -->"). Never print them to a parent.
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim();
}

function demoSample(grade, subject, topic) {
  const s = String(subject || "").toLowerCase();
  if (s.indexOf("read") >= 0 || s.indexOf("science") >= 0 || s.indexOf("social") >= 0) {
    return `
    <h2 class="ws-title">${esc(topic)}</h2>
    <p class="ws-instructions">Read the passage. Then answer the questions.</p>
    ${NAME_DATE}
    <div class="ws-passage"><p>This is a DEMO passage about "${esc(topic)}". Add an AI key on the server to generate real content.</p></div>
    <ol class="ws-questions"><li>Sample question (1)</li><li>Sample question (2)</li><li>Sample question (3)</li></ol>
    <hr class="ws-pagebreak">
    <h3 class="ws-answers-title">Answer Key</h3>
    <ol class="ws-answers"><li>Answer (1)</li><li>Answer (2)</li><li>Answer (3)</li></ol>`;
  }
  if (s.indexOf("writ") >= 0) {
    return `
    <h2 class="ws-title">Writing Prompt</h2>
    <p class="ws-instructions">Plan your ideas, then write your response on the lines below.</p>
    ${NAME_DATE}
    <div class="ws-prompt"><p>DEMO prompt about "${esc(topic)}". Add an AI key to generate real content.</p></div>
    <div class="ws-lines"></div>`;
  }
  if (s.indexOf("spell") >= 0 || s.indexOf("phonic") >= 0 || s.indexOf("vocab") >= 0) {
    return `
    <h2 class="ws-title">${esc(subject)}: ${esc(topic)}</h2>
    <p class="ws-instructions">Use the word list to complete the activities.</p>
    ${NAME_DATE}
    <div class="ws-wordlist"><span class="word">word</span><span class="word">list</span><span class="word">demo</span></div>
    <ol class="ws-questions"><li>Sample activity (1)</li><li>Sample activity (2)</li></ol>`;
  }
  return `
    <h2 class="ws-title">${esc(subject)} Practice — Grade ${esc(grade)}</h2>
    <p class="ws-instructions">Solve each problem. Show your work where needed.</p>
    ${NAME_DATE}
    <ol class="ws-questions">
      <li>Shade three fourths of the bar. <div class="ws-visual" data-visual="fraction-bar" data-num="3" data-den="4"></div></li>
      <li>What fraction is shaded? <div class="ws-visual" data-visual="fraction-circle" data-num="1" data-den="4"></div></li>
      <li>Sample question (3)</li>
    </ol>
    <hr class="ws-pagebreak">
    <h3 class="ws-answers-title">Answer Key</h3>
    <ol class="ws-answers"><li>\\frac{3}{4}</li><li>\\frac{1}{4}</li><li>Answer (3)</li></ol>`;
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Exposed only so local tooling (prompt benchmarks + answer-check tests) can
// reuse the EXACT logic the server runs. Vercel uses the default export above.
module.exports._buildPrompt = buildPrompt;
module.exports._buildRelevelPrompt = buildRelevelPrompt;
module.exports._checkMath = checkMath;
module.exports._proofread = proofread;
module.exports._applyFixes = applyFixes;
module.exports._parseWrong = parseWrong;
module.exports._buildAttempts = buildAttempts;
module.exports._buildTweakPrompt = buildTweakPrompt;
