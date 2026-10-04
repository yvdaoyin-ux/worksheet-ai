// api/generate.js
// Vercel Serverless Function (Node.js). Keeps the OpenRouter key on the server.
// POST { grade, subject, topic } -> { html }  (or { html, demo:true } without a key)
//
// The model writes CONTENT (questions + answers); the client renders it into a
// clean, worksheet-looking layout. Math is written in LaTeX so fractions etc.
// can be typeset properly.

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
- Grades K–2: keep the wording very short and concrete; include a simple visual model where helpful.
- Include a mix: 2 warm-up questions, the main practice, and 1–2 word problems.
- Every question must be unambiguous and solvable. Double-check every answer.
- Provide EXACTLY 10 questions.

MATH FORMATTING (very important)
- Write math using LaTeX commands ONLY: fractions as \\frac{1}{4}, multiplication as \\times, division as \\div, mixed numbers as 1\\frac{1}{2}.
- NEVER use the dollar sign ($) as a math delimiter. Do NOT write $4$ or $4 \\times 7$. Write numbers and operators plainly: 4 \\times 7.
- The only time a $ appears is a real money amount inside a money word problem, always with a SINGLE $ and no closing one (e.g. "Mia has $5").

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
  const t = esc(topic);
  return `
    <h2 class="ws-title">${esc(subject)} Practice — Grade ${esc(grade)}</h2>
    <p class="ws-instructions">Solve each problem. Show your work where needed.</p>
    <p class="ws-name">Name: ______________&nbsp;&nbsp;&nbsp;Date: ______________</p>
    <ol class="ws-questions">
      <li>What fraction is shaded? (1 of 4 equal parts)</li>
      <li>Simplify: \\frac{2}{4}</li>
      <li>What is 3 \\times 5?</li>
      <li>There are 12 \\div 3 groups. How many in each group?</li>
      <li>Sample question about "${t}" (5).</li>
      <li>Sample question about "${t}" (6).</li>
      <li>Sample question about "${t}" (7).</li>
      <li>Sample question about "${t}" (8).</li>
      <li>Sample question about "${t}" (9).</li>
      <li>Sample question about "${t}" (10).</li>
    </ol>
    <hr class="ws-pagebreak">
    <h3 class="ws-answers-title">Answer Key</h3>
    <ol class="ws-answers">
      <li>\\frac{1}{4}</li>
      <li>\\frac{1}{2}</li>
      <li>15</li>
      <li>4</li>
      <li>Answer (5)</li>
      <li>Answer (6)</li>
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
