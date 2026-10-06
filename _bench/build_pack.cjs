// Build the free Starter Pack: 10 real generated sheets -> one printable PDF.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const BASE = "http://127.0.0.1:3000";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SHEETS = [
  ["K", "Math", "counting to 10"],
  ["1", "Math", "addition within 20"],
  ["2", "Math", "place value"],
  ["3", "Math", "multiplication facts"],
  ["4", "Math", "long division"],
  ["2", "Reading", "a day at the park"],
  ["3", "Grammar", "nouns and verbs"],
  ["1", "Spelling", "short vowel words"],
  ["4", "Science", "the water cycle"],
  ["3", "Writing", "opinion writing prompts"],
];

async function gen(b) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(BASE + "/api/generate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(b),
      });
      const d = await r.json();
      if (d.html && d.html.length > 400) return d.html;
      console.log("  retry (bad response)", b.subject, d.error || "");
    } catch (e) { console.log("  retry", b.subject, e.message); }
    await sleep(2000);
  }
  throw new Error("generation failed: " + b.subject);
}

(async () => {
  const parts = [];
  parts.push(
    '<section style="text-align:center;margin-top:120px">' +
    '<h2 style="font-size:30px;border:none">WorksheetAI Starter Pack</h2>' +
    '<p style="font-size:15px">10 free printables with answer keys \u2014 Kindergarten through Grade 5.</p>' +
    '<p style="font-size:13px;color:#555">Print, hand over, check together. Want more? Make unlimited fresh sheets at<br>worksheet-ai-l1td.vercel.app \u2014 the first 2 math sheets each day are free.</p>' +
    "</section>" +
    '<hr class="ws-pagebreak">'
  );
  for (let i = 0; i < SHEETS.length; i++) {
    const [grade, subject, topic] = SHEETS[i];
    process.stdout.write("gen " + grade + " " + subject + " (" + topic + ") ... ");
    const html = await gen({ grade, subject, topic, count: 8 });
    parts.push(html);
    parts.push('<hr class="ws-pagebreak">'); // next sheet starts on a fresh page
    console.log("ok (" + html.length + " bytes)");
    await sleep(1200);
  }
  const body = parts.join("\n");
  const doc =
    '<!doctype html><html><head><meta charset="utf-8">' +
    '<link rel="stylesheet" href="/app.css?v=28"></head>' +
    '<body><article class="worksheet">' + body + "</article></body></html>";
  const htmlPath = path.join(__dirname, "..", "_pack.html");
  fs.writeFileSync(htmlPath, doc);

  const edge = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
  const out = path.join(__dirname, "..", "starter-pack.pdf");
  execFileSync(edge, [
    "--headless=new", "--disable-gpu", "--no-sandbox",
    "--user-data-dir=" + path.join(__dirname, "..", "_ep2"),
    "--no-pdf-header-footer",
    "--print-to-pdf=" + out,
    "http://127.0.0.1:3000/_pack.html",
  ], { stdio: "ignore", timeout: 120000 });
  const kb = Math.round(fs.statSync(out).size / 1024);
  console.log("starter-pack.pdf written:", kb, "KB");
})().catch((e) => { console.error("PACK FAILED:", e.message); process.exit(1); });
