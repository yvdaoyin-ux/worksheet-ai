// api/generate.js
// Vercel Serverless Function (Node.js). Keeps the OpenRouter key on the server.
// POST { grade, subject, topic } -> { html }  (or { html, demo:true } without a key)
//
// The model writes CONTENT (questions + answers + optional visual placeholders);
// the client renders it into a clean, worksheet-looking layout with code-drawn
// math visuals and stacked fractions.

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

function buildPrompt(grade, subject, topic) {
  return `You are an experienced U.S. elementary school teacher creating a printable worksheet for a homeschool family.

Grade level: ${grade} (U.S. grade level). Subject: ${subject}. Topic: ${topic}.

CONTENT RULES
- Match the concepts and difficulty to U.S. standards for this grade (Common Core style).
- Use U.S. contexts and conventions: U.S. names, U.S. spelling.
- Grades K–2: keep the wording very short and concrete.
- Include a mix: 2 warm-up questions, the main practice, and 1–2 word problems.
- Every question must be unambiguous and solvable. Double-check every answer.
- Provide EXACTLY 10 questions.

MATH FORMATTING (very important)
- Write math using LaTeX commands ONLY: fractions as \\frac{1}{4}, multiplication as \\times, division as \\div, mixed numbers as 1\\frac{1}{2}.
- NEVER use the dollar sign ($) as a math delimiter. Do NOT write $4$ or $4 \\times 7$. Write numbers and operators plainly: 4 \\times 7.
- A $ appears only for a real money amount in a money word problem, with a SINGLE $ (e.g. "Mia has $5").

VISUALS (use ONE when it directly supports the question — e.g. fractions, number lines, counting, place value, arrays; use them 2–4 times across the sheet)
Insert a visual on its own line, right after the question text, inside the <li>:
<div class="ws-visual" data-visual="TYPE" ATTRS></div>
Available TYPEs and attributes (copy exactly):
- number-line  -> data-min="0" data-max="1" data-ticks="4"   (ticks = number of equal parts; use for fractions on a number line)
- fraction-bar -> data-num="3" data-den="4"                  (shaded parts of a whole)
- fraction-circle -> data-num="1" data-den="4"               (pie)
- ten-frame    -> data-count="7"                             (0–20)
- array        -> data-rows="3" data-cols="4"                (multiplication dots)
- place-value  -> data-number="345"                          (hundreds/tens/ones)
Example question with a visual:
  <li>Shade three fourths of the bar. <div class="ws-visual" data-visual="fraction-bar" data-num="3" data-den="4"></div></li>

OUTPUT
Return ONLY an HTML fragment (no <html>/<body>, no markdown code fences), using EXACTLY this structure and class names:

<h2 class="ws-title">A short, specific worksheet title</h2>
<p class="ws-instructions">One clear sentence telling the student what to do.</p>
<p class="ws-name">Name: ______________&nbsp;&nbsp;&nbsp;Date: ______________</p>
<ol class="ws-questions">
  <li>Question 1</li>
  <li>Question 2</li>
  <li>Question 3</li>
  <li>Question 4</li>
  <li>Question 5</li>
  <li>Question 6</li>
  <li>Question 7</li>
  <li>Question 8</li>
  <li>Question 9</li>
  <li>Question 10</li>
</ol>
<hr class="ws-pagebreak">
<h3 class="ws-answers-title">Answer Key</h3>
<ol class="ws-answers">
  <li>Answer to 1 (briefly show the work for math)</li>
  <li>Answer to 2</li>
  <li>Answer to 3</li>
  <li>Answer to 4</li>
  <li>Answer to 5</li>
  <li>Answer to 6</li>
  <li>Answer to 7</li>
  <li>Answer to 8</li>
  <li>Answer to 9</li>
  <li>Answer to 10</li>
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
  return `
    <h2 class="ws-title">${esc(subject)} Practice — Grade ${esc(grade)}</h2>
    <p class="ws-instructions">Solve each problem. Show your work where needed.</p>
    <p class="ws-name">Name: ______________&nbsp;&nbsp;&nbsp;Date: ______________</p>
    <ol class="ws-questions">
      <li>Shade three fourths of the bar.
        <div class="ws-visual" data-visual="fraction-bar" data-num="3" data-den="4"></div></li>
      <li>What fraction is shaded? (1 of 4 equal parts)
        <div class="ws-visual" data-visual="fraction-circle" data-num="1" data-den="4"></div></li>
      <li>Point to \\frac{3}{4} on the number line.
        <div class="ws-visual" data-visual="number-line" data-min="0" data-max="1" data-ticks="4"></div></li>
      <li>How many dots in the array? <div class="ws-visual" data-visual="array" data-rows="3" data-cols="4"></div></li>
      <li>Show 7 with a ten-frame. <div class="ws-visual" data-visual="ten-frame" data-count="7"></div></li>
      <li>Write the value of each digit in 345. <div class="ws-visual" data-visual="place-value" data-number="345"></div></li>
      <li>Sample question about "${esc(topic)}" (7).</li>
      <li>Sample question about "${esc(topic)}" (8).</li>
      <li>Sample question about "${esc(topic)}" (9).</li>
      <li>Sample question about "${esc(topic)}" (10).</li>
    </ol>
    <hr class="ws-pagebreak">
    <h3 class="ws-answers-title">Answer Key</h3>
    <ol class="ws-answers">
      <li>\\frac{3}{4}</li>
      <li>\\frac{1}{4}</li>
      <li>\\frac{3}{4}</li>
      <li>12</li>
      <li>7 filled</li>
      <li>3 hundreds, 4 tens, 5 ones</li>
      <li>Answer (7)</li>
      <li>Answer (8)</li>
      <li>Answer (9)</li>
      <li>Answer (10)</li>
    </ol>
    <p style="color:#6b7280;font-size:13px">
      This is a DEMO worksheet. Add an OPENROUTER_API_KEY on the server to generate real worksheets.
    </p>`;
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
