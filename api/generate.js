// api/generate.js
// Vercel Serverless Function (Node.js). Keeps the AI API key on the server.
// POST { grade, subject, topic } -> { html }  (or { html, demo:true } without a key)
//
// Supports two providers, auto-selected by which env var is set:
//   - OPENROUTER_API_KEY  -> OpenRouter (recommended: no card, no ID verification)
//   - GEMINI_API_KEY      -> Google Gemini direct (needs a Google Cloud project)

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

  const openrouterKey = process.env.OPENROUTER_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;

  // Demo mode: no key configured -> return a sample so the flow is testable.
  if (!openrouterKey && !geminiKey) {
    res.status(200).json({ html: demoSample(grade, subject, topic), demo: true });
    return;
  }

  const prompt = buildPrompt(grade, subject, topic);

  try {
    let html = "";
    if (openrouterKey) {
      html = await callOpenRouter(openrouterKey, prompt);
    } else {
      html = await callGemini(geminiKey, prompt);
    }
    html = stripCodeFences(html);
    if (!html) {
      res.status(502).json({ error: "The model returned an empty response." });
      return;
    }
    res.status(200).json({ html });
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
};

// ---------------------------------------------------------------- providers

async function callOpenRouter(key, prompt) {
  const model = process.env.OPENROUTER_MODEL || "qwen/qwen3.8-27b:free";
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + key,
      "Content-Type": "application/json",
      // These two headers are optional but recommended by OpenRouter:
      "HTTP-Referer": "http://localhost",
      "X-Title": "WorksheetAI",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await r.json();
  if (!r.ok) {
    throw new Error(
      (data && data.error && data.error.message) ||
        "OpenRouter request failed (try a different OPENROUTER_MODEL)"
    );
  }
  return (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || "";
}

async function callGemini(key, prompt) {
  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    "gemini-2.0-flash:generateContent?key=" +
    encodeURIComponent(key);
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  });
  const data = await r.json();
  if (!r.ok) {
    throw new Error(
      (data && data.error && data.error.message) || "Gemini request failed"
    );
  }
  return (
    (data.candidates &&
      data.candidates[0] &&
      data.candidates[0].content &&
      data.candidates[0].content.parts &&
      data.candidates[0].content.parts[0] &&
      data.candidates[0].content.parts[0].text) ||
    ""
  );
}

// ---------------------------------------------------------------- helpers

function buildPrompt(grade, subject, topic) {
  return `You are an experienced elementary school teacher.
Create a printable worksheet.
Grade: ${grade}. Subject: ${subject}. Topic: ${topic}.
Rules:
- Output clean HTML FRAGMENT only (no <html>, <head>, or <body> wrapper).
- Use only these tags: <h2>, <h3>, <p>, <ol>, <li>, <hr>, <strong>, <em>.
- Start with a title <h2>, then a Name/Date line as:
  <p class="namebar"><span>Name:</span> <span>Date:</span></p>
- Include 8-12 numbered questions inside a single <ol>.
- After the questions, add <hr style="page-break-before:always"> then an
  <h3>Answer Key</h3> section listing every answer in a <ol>.
- For math, double-check every answer before finalizing (accuracy matters a lot).
- Do not wrap the output in code fences.`;
}

function stripCodeFences(text) {
  return text
    .replace(/^\s*```(?:html)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
}

function demoSample(grade, subject, topic) {
  const t = esc(topic);
  return `
    <h2>${esc(subject)} Practice — ${esc(grade)}</h2>
    <p><em>Topic: ${t}</em></p>
    <p class="namebar"><span>Name:</span> <span>Date:</span></p>
    <ol>
      <li>Sample question about "${t}" (1).</li>
      <li>Sample question about "${t}" (2).</li>
      <li>Sample question about "${t}" (3).</li>
      <li>Sample question about "${t}" (4).</li>
      <li>Sample question about "${t}" (5).</li>
      <li>Sample question about "${t}" (6).</li>
      <li>Sample question about "${t}" (7).</li>
      <li>Sample question about "${t}" (8).</li>
    </ol>
    <hr style="page-break-before:always">
    <h3>Answer Key</h3>
    <ol>
      <li>Answer (1)</li><li>Answer (2)</li><li>Answer (3)</li><li>Answer (4)</li>
      <li>Answer (5)</li><li>Answer (6)</li><li>Answer (7)</li><li>Answer (8)</li>
    </ol>
    <p style="color:#6b7280;font-size:13px">
      This is a DEMO worksheet. Add an OPENROUTER_API_KEY (or GEMINI_API_KEY) on the server to generate real worksheets.
    </p>`;
}

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
