// api/generate.js
// Vercel Serverless Function (Node.js). Keeps AI keys on the server.
// POST { grade, subject, topic, count, level, size } -> { html }
//
// Providers (tries in order, first success wins):
//   1) Groq        (if GROQ_API_KEY)      — fast, generous free tier, OpenAI-compatible
//   2) OpenRouter  (if OPENROUTER_API_KEY)
// The model writes CONTENT; the client renders it. Each subject gets its own
// output structure, aligned to US Common Core ELA / NGSS.

const PER_REQUEST_TIMEOUT_MS = 45000;

const GROQ_MODELS = (process.env.GROQ_MODEL || "openai/gpt-oss-120b,openai/gpt-oss-20b")
  .split(",").map((s) => s.trim()).filter(Boolean);
const OPENROUTER_MODELS = ["nvidia/nemotron-3-super-120b-a12b:free", "openrouter/free"];

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { grade = "", subject = "", topic = "", count = 10, level = "standard", style = "mixed" } = req.body || {};
  if (!topic) {
    res.status(400).json({ error: "Please enter a topic." });
    return;
  }

  const qCount = Math.min(20, Math.max(3, parseInt(count, 10) || 10));
  const prompt = buildPrompt(grade, subject, topic, qCount, level, style);
  const attempts = buildAttempts();

  if (!attempts.length) {
    res.status(200).json({ html: demoSample(grade, subject, topic), demo: true });
    return;
  }

  const rl = await rateLimit(getClientIp(req));
  if (!rl.ok) {
    res.status(429).json({ error: "You've reached today's worksheet limit. Please try again tomorrow." });
    return;
  }

  let lastError = "";
  for (const a of attempts) {
    try {
      const raw = await callChat(a.url, a.key, a.model, prompt);
      const html = stripCodeFences(raw);
      if (html && looksComplete(html)) {
        res.status(200).json({ html, model: a.model });
        return;
      }
      lastError = html ? "Model returned an incomplete worksheet." : "Model returned an empty response.";
    } catch (err) {
      lastError = String(err && err.message ? err.message : err);
    }
  }

  const friendly = /rate limit|quota|429|per-day|exceeded/i.test(lastError)
    ? "The AI is at its daily/usage limit right now. Please try again later."
    : "AI request failed. Please try again in a moment.";
  res.status(502).json({ error: friendly, detail: lastError });
};

function looksComplete(html) {
  if (!html || html.length < 150) return false;
  if (html.indexOf("ws-title") < 0) return false;
  if (html.indexOf("ws-questions") < 0 && html.indexOf("ws-prompt") < 0) return false;
  if (html.indexOf("</ol>") < 0 && html.indexOf("</div>") < 0) return false;
  return true;
}

function getClientIp(req) {
  const xff = (req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return xff || req.headers["x-real-ip"] || "unknown";
}

// Optional per-IP daily cap (anti-abuse). Needs UPSTASH_REDIS_REST_URL/TOKEN; else no-op.
async function rateLimit(ip) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return { ok: true };
  const limit = Math.max(1, parseInt(process.env.DAILY_LIMIT_PER_IP || "100", 10));
  const day = new Date().toISOString().slice(0, 10);
  const key = "rl:" + ip + ":" + day;
  try {
    const r = await fetch(url.replace(/\/$/, "") + "/pipeline", {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify([["INCR", key], ["EXPIRE", key, 172800]]),
    });
    const data = await r.json();
    const count = data && data[0] && data[0].result;
    if (typeof count === "number") return { ok: count <= limit, count, limit };
    return { ok: true };
  } catch (e) {
    return { ok: true }; // fail open
  }
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

function buildPrompt(grade, subject, topic, count, level, style) {
  const s = String(subject || "").toLowerCase();
  const head = `You are an experienced U.S. elementary school teacher creating a printable worksheet for a homeschool family.

Grade level: ${grade} (U.S. grade level). Subject: ${subject}. Topic: ${topic}.

GENERAL RULES
- Match the concepts and difficulty to U.S. standards for this grade (Common Core / NGSS style).
- Use U.S. contexts and conventions (U.S. names, U.S. spelling).
- Grades K–2: keep wording very short and concrete.${levelLine(level)}
- The output MUST be a ${subject} worksheet. Follow the SUBJECT strictly, even if the topic wording could also fit another subject.
- In the Answer Key, give a brief step or reason for each answer (parents find this very useful).
- Return ONLY an HTML fragment (no <html>/<body>, no markdown or code fences), using EXACTLY the class names shown.`;

  if (s.indexOf("math") >= 0) return head + mathBlock(count, style);
  if (s.indexOf("read") >= 0) return head + readingBlock(count);
  if (s.indexOf("spell") >= 0 || s.indexOf("phonic") >= 0) return head + spellingBlock(count);
  if (s.indexOf("vocab") >= 0) return head + vocabBlock(count);
  if (s.indexOf("grammar") >= 0 || s.indexOf("language") >= 0) return head + grammarBlock(count);
  if (s.indexOf("writ") >= 0) return head + writingBlock();
  if (s.indexOf("science") >= 0) return head + scienceBlock(count);
  if (s.indexOf("social") >= 0 || s.indexOf("history") >= 0) return head + socialBlock(count);
  return head + readingBlock(count);
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

function readingBlock(count) {
  return `

STRUCTURE — Reading comprehension (Common Core Reading Literature/Informational)
- Write an ORIGINAL, age-appropriate passage (never copy a published text).
  Length by grade: K–1 ≈ 40–60 words; grades 2–3 ≈ 90–140 words; grades 4–5 ≈ 160–220 words.
- Provide EXACTLY ${count} comprehension questions (literal, main idea, and at least one "how do you know / why").
- After the questions, add ONE graphic organizer that fits the passage.

OUTPUT (exact structure)
<h2 class="ws-title">Title</h2>
<p class="ws-instructions">Read the passage. Then answer the questions in complete sentences.</p>
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

function spellingBlock(count) {
  return `

STRUCTURE — Spelling / Phonics (Common Core Foundational Skills; Dolch/Fry sight words)
- Pick ONE phonics/spelling pattern appropriate for the grade (short-a CVC, digraphs sh/ch/th, blends, silent-e, vowel teams, r-controlled).
- Provide EXACTLY 10 words that ALL match that pattern (use common sight words where possible).

OUTPUT (exact structure)
<h2 class="ws-title">Spelling: <the pattern></h2>
<p class="ws-instructions">Read the words. Then complete the activities below.</p>
${NAME_DATE}
<div class="ws-wordlist">
  <span class="word">word1</span> … <span class="word">word10</span>
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
  <li>cat</li>  (the completed words; accept reasonable sentences)
</ol>`;
}

function vocabBlock(count) {
  return `

STRUCTURE — Vocabulary (Common Core Language; context clues)
- Choose 8 grade-appropriate vocabulary words on the topic, each with a short, kid-friendly definition.

OUTPUT (exact structure)
<h2 class="ws-title">Vocabulary: <topic></h2>
<p class="ws-instructions">Use the word bank to complete each activity.</p>
${NAME_DATE}
<div class="ws-wordlist">
  <span class="word">word1</span> … <span class="word">word8</span>
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

function grammarBlock(count) {
  return `

STRUCTURE — Grammar / Language (Common Core Language conventions)
- Focus on ONE grammar skill appropriate for the grade (capitalizing proper nouns, ending punctuation, plural nouns, verb tense, complete sentences).
- The worksheet is a set of sentences to FIX or label — it is NOT a reading passage.

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

function writingBlock() {
  return `

STRUCTURE — Writing (Common Core Writing: opinion / informative / narrative)
- Choose a grade-appropriate prompt and genre.

OUTPUT (exact structure — NO answer key)
<h2 class="ws-title">Writing Prompt</h2>
<p class="ws-instructions">Plan your ideas, then write your response on the lines below.</p>
${NAME_DATE}
<div class="ws-prompt">
  <p>…the writing prompt (1–2 sentences), plus the purpose/audience…</p>
</div>
<p class="ws-sub">Plan: What is your main idea? What are 2–3 details or reasons?</p>
<div class="ws-lines"></div>
<p class="ws-checklist">&check; Capital letters  &check; Punctuation  &check; Complete sentences  &check; Clear main idea</p>`;
}

function scienceBlock(count) {
  return `

STRUCTURE — Science (NGSS)
- Write a short, accurate, grade-appropriate informational text (≈ 80–140 words).

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

function socialBlock(count) {
  return `

STRUCTURE — Social Studies / History
- Write a short, accurate, grade-appropriate informational text (≈ 80–140 words).
- Typical K–5 themes: K = family/community; G1 = symbols & family history; G2 = people who made a difference; G3 = local history; G4 = state history & U.S. regions; G5 = early U.S. history.

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
