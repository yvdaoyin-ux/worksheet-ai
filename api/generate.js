// api/generate.js
// Vercel Serverless Function (Node.js). Keeps the OpenRouter key on the server.
// POST { grade, subject, topic } -> { html }  (or { html, demo:true } without a key)
//
// Tries a list of models in order (fast free model first) and falls back if one
// is rate-limited or slow, so a single flaky free model doesn't break the app.

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

  // Demo mode: no key configured -> return a sample so the flow is testable.
  if (!apiKey) {
    res.status(200).json({ html: demoSample(grade, subject, topic), demo: true });
    return;
  }

  const prompt = `You are an experienced elementary school teacher.
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

async function callOpenRouter(key, model, prompt) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PER_MODEL_TIMEOUT_MS);
  try {
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: controller.signal,
    });

    const data = await r.json();
    if (!r.ok) {
      throw new Error((data.error && data.error.message) || "OpenRouter request failed");
    }
    return (
      (data.choices &&
        data.choices[0] &&
        data.choices[0].message &&
        data.choices[0].message.content) ||
      ""
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
  const items = (n, ans) =>
    Array.from({ length: n }, (_, i) => `<li>${ans} ${i + 1}</li>`).join("");
  return `
    <h2>${esc(subject)} Practice — ${esc(grade)}</h2>
    <p><em>Topic: ${t}</em></p>
    <p class="namebar"><span>Name:</span> <span>Date:</span></p>
    <ol>${items(8, "Sample question about \"" + t + "\"")}</ol>
    <hr style="page-break-before:always">
    <h3>Answer Key</h3>
    <ol>${items(8, "Answer")}</ol>
    <p style="color:#6b7280;font-size:13px">
      This is a DEMO worksheet. Add an OPENROUTER_API_KEY on the server to generate real worksheets.
    </p>`;
}

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
