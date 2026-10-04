// api/generate.js
// Vercel Serverless Function (Node.js). Keeps the OpenRouter key on the server.
// POST { grade, subject, topic } -> { html }  (or { html, demo:true } without a key)
//
// The model writes CONTENT; the client renders it. Each subject gets its own
// output structure (reading = passage + questions, spelling = word list + drills,
// writing = prompt + lines, etc.), aligned to US Common Core ELA / NGSS.

const MODELS = [
  "nvidia/nemotron-3-super-120b-a12b:free",
  "openrouter/free",
];

const PER_MODEL_TIMEOUT_MS = 45000;

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { grade = "", subject = "", topic = "" } = req.body || {};
  if (!topic) {
    res.status(400).json({ error: "Please enter a topic." });
    return;
  }

  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    res.status(200).json({ html: demoSample(grade, subject, topic), demo: true });
    return;
  }

  const prompt = buildPrompt(grade, subject, topic);
  let lastError = "";

  for (const model of MODELS) {
    try {
      const raw = await callOpenRouter(apiKey, model, prompt);
      const html = stripCodeFences(raw);
      if (html) {
        res.status(200).json({ html, model });
        return;
      }
      lastError = "Model returned an empty response.";
    } catch (err) {
      lastError = String(err && err.message ? err.message : err);
    }
  }

  res.status(502).json({ error: "AI request failed", detail: lastError });
};

const NAME_DATE = '<p class="ws-name">Name: ______________&nbsp;&nbsp;&nbsp;Date: ______________</p>';

function buildPrompt(grade, subject, topic) {
  const s = String(subject || "").toLowerCase();
  const head = `You are an experienced U.S. elementary school teacher creating a printable worksheet for a homeschool family.

Grade level: ${grade} (U.S. grade level). Subject: ${subject}. Topic: ${topic}.

GENERAL RULES
- Match the concepts and difficulty to U.S. standards for this grade (Common Core / NGSS style).
- Use U.S. contexts and conventions (U.S. names, U.S. spelling).
- Grades K–2: keep wording very short and concrete.
- Return ONLY an HTML fragment (no <html>/<body>, no markdown or code fences), using EXACTLY the class names shown.`;

  if (s.indexOf("math") >= 0) return head + mathBlock(topic);
  if (s.indexOf("read") >= 0) return head + readingBlock(grade);
  if (s.indexOf("spell") >= 0 || s.indexOf("phonic") >= 0) return head + spellingBlock();
  if (s.indexOf("vocab") >= 0) return head + vocabBlock();
  if (s.indexOf("grammar") >= 0 || s.indexOf("language") >= 0) return head + grammarBlock();
  if (s.indexOf("writ") >= 0) return head + writingBlock();
  if (s.indexOf("science") >= 0) return head + scienceBlock();
  if (s.indexOf("social") >= 0 || s.indexOf("history") >= 0) return head + socialBlock();
  return head + readingBlock(grade); // sensible default
}

function mathBlock(topic) {
  return `

CONTENT
- Mix: 2 warm-up questions, the main practice, and 1–2 word problems.
- Provide EXACTLY 10 questions. Double-check every answer.

MATH FORMATTING (very important)
- Write math using LaTeX commands ONLY: fractions as \\frac{1}{4}, multiplication as \\times, division as \\div, mixed numbers as 1\\frac{1}{2}.
- NEVER use the dollar sign ($) as a math delimiter. Do NOT write $4$ or $4 \\times 7$; write 4 \\times 7.
- A $ appears only for a real money amount in a money problem, with a SINGLE $ (e.g. "Mia has $5").

VISUALS (use ONE when it directly supports the question; 2–4 times across the sheet)
Insert on its own line inside the relevant <li>:
<div class="ws-visual" data-visual="TYPE" ATTRS></div>
Types: number-line (data-min data-max data-ticks) | fraction-bar (data-num data-den) | fraction-circle (data-num data-den) | ten-frame (data-count) | array (data-rows data-cols) | place-value (data-number)

OUTPUT (exact structure)
<h2 class="ws-title">Title</h2>
<p class="ws-instructions">One clear instruction sentence.</p>
${NAME_DATE}
<ol class="ws-questions">
  <li>…</li>  (10 total)
</ol>
<hr class="ws-pagebreak">
<h3 class="ws-answers-title">Answer Key</h3>
<ol class="ws-answers">
  <li>…</li>  (10 total, briefly show the work for math)
</ol>`;
}

function readingBlock(grade) {
  return `

STRUCTURE — Reading comprehension (Common Core Reading Literature/Informational)
- Write an ORIGINAL, age-appropriate passage (do not copy any published text).
  Length by grade: K–1 ≈ 40–60 words; grades 2–3 ≈ 90–140 words; grades 4–5 ≈ 160–220 words.
- Then ask comprehension questions: K–1 → 3 questions; grades 2–3 → 5; grades 4–5 → 6.
  Include literal questions, a main-idea question, and at least one "how do you know / why" question.

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
<hr class="ws-pagebreak">
<h3 class="ws-answers-title">Answer Key</h3>
<ol class="ws-answers">
  <li>… (for "how do you know" questions, quote the sentence from the passage)</li>
</ol>`;
}

function spellingBlock() {
  return `

STRUCTURE — Spelling / Phonics (Common Core Foundational Skills; Dolch/Fry sight words)
- Pick ONE phonics/spelling pattern appropriate for the grade (e.g. short-a CVC, digraphs sh/ch/th, blends, silent-e, vowel teams, r-controlled).
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
  <li>c _ t</li> …  (8–10 letter-missing items based on the word list)
  <li>Write a sentence using "…".</li>
  <li>Write a sentence using "…".</li>
</ol>
<hr class="ws-pagebreak">
<h3 class="ws-answers-title">Answer Key</h3>
<ol class="ws-answers">
  <li>cat</li> … (the completed words; accept reasonable sentences)
</ol>`;
}

function vocabBlock() {
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
  <li>definition of one word (students match the word)</li> … (8)
  <li>sentence with a blank using one of the words</li> … (5)
  <li>Write a sentence using "…".</li>
  <li>Write a sentence using "…".</li>
</ol>
<hr class="ws-pagebreak">
<h3 class="ws-answers-title">Answer Key</h3>
<ol class="ws-answers">
  <li>…</li>
</ol>`;
}

function grammarBlock() {
  return `

STRUCTURE — Grammar / Language (Common Core Language conventions)
- Focus on ONE skill appropriate for the grade (e.g. capitalizing proper nouns, ending punctuation, plural nouns, verb tense, complete sentences).

OUTPUT (exact structure)
<h2 class="ws-title">Grammar: <the skill></h2>
<p class="ws-instructions">Rewrite each sentence correctly. / Circle the nouns. (pick what fits)</p>
${NAME_DATE}
<ol class="ws-questions">
  <li>…sentence to fix or item…</li>  (10 total)
</ol>
<hr class="ws-pagebreak">
<h3 class="ws-answers-title">Answer Key</h3>
<ol class="ws-answers">
  <li>the corrected sentence — and the rule in (parentheses)</li>  (10 total)
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

function scienceBlock() {
  return `

STRUCTURE — Science (NGSS)
- Write a short, accurate, grade-appropriate informational text (≈ 80–140 words) about the topic.

OUTPUT (exact structure)
<h2 class="ws-title">Title</h2>
<p class="ws-instructions">Read the text. Then answer the questions.</p>
${NAME_DATE}
<div class="ws-passage">
  <p>…the informational text…</p>
</div>
<ol class="ws-questions">
  <li>…</li>  (4–5 questions: recall + explain WHY)
</ol>
<hr class="ws-pagebreak">
<h3 class="ws-answers-title">Answer Key</h3>
<ol class="ws-answers">
  <li>…</li>
</ol>`;
}

function socialBlock() {
  return `

STRUCTURE — Social Studies / History
- Write a short, accurate, grade-appropriate informational text (≈ 80–140 words) about the topic.
- Typical K–5 themes: K = family/community; G1 = symbols & family history; G2 = people who made a difference; G3 = local history; G4 = state history & U.S. regions; G5 = early U.S. history.

OUTPUT (exact structure)
<h2 class="ws-title">Title</h2>
<p class="ws-instructions">Read the text. Then answer the questions.</p>
${NAME_DATE}
<div class="ws-passage">
  <p>…the informational text…</p>
</div>
<ol class="ws-questions">
  <li>…</li>  (4–5 questions)
</ol>
<hr class="ws-pagebreak">
<h3 class="ws-answers-title">Answer Key</h3>
<ol class="ws-answers">
  <li>…</li>
</ol>`;
}

async function callOpenRouter(key, model, prompt) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PER_MODEL_TIMEOUT_MS);
  try {
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }] }),
      signal: controller.signal,
    });
    const data = await r.json();
    if (!r.ok) {
      throw new Error((data.error && data.error.message) || "OpenRouter request failed");
    }
    return (
      (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || ""
    );
  } finally {
    clearTimeout(timer);
  }
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
    <div class="ws-passage"><p>This is a DEMO passage about "${esc(topic)}". Add an OPENROUTER_API_KEY on the server to generate real content.</p></div>
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
    <div class="ws-prompt"><p>DEMO prompt about "${esc(topic)}". Add an OPENROUTER_API_KEY to generate real content.</p></div>
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
