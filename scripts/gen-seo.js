// scripts/gen-seo.js
// Generates static programmatic-SEO landing pages under /worksheets/<slug>/index.html
// plus sitemap.xml and robots.txt. Run: node scripts/gen-seo.js

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "worksheets");
const DOMAIN = "https://worksheet-ai-l1td.vercel.app";

// ---- taxonomy ----
const gradeByNum = {
  K: ["Kindergarten", "kindergarten"],
  "1": ["1st Grade", "1st-grade"],
  "2": ["2nd Grade", "2nd-grade"],
  "3": ["3rd Grade", "3rd-grade"],
  "4": ["4th Grade", "4th-grade"],
  "5": ["5th Grade", "5th-grade"],
};
const subjects = [
  ["Math", "math", "math"],
  ["Reading", "reading", "reading comprehension"],
  ["Spelling", "spelling", "spelling"],
  ["Vocabulary", "vocabulary", "vocabulary"],
  ["Grammar", "grammar", "grammar"],
  ["Writing", "writing", "writing"],
  ["Science", "science", "science"],
];

// [gradeNum, subject, topicLabel, generatorTopic]
const topics = [
  ["K", "Math", "Counting", "Kindergarten counting to 20"],
  ["K", "Reading", "Sight Words", "Kindergarten sight words"],
  ["K", "Spelling", "Letter Sounds", "Kindergarten beginning letter sounds"],
  ["1", "Math", "Addition", "1st Grade addition to 20"],
  ["1", "Math", "Subtraction", "1st Grade subtraction within 20"],
  ["1", "Reading", "Sight Words", "1st Grade sight words"],
  ["1", "Spelling", "Phonics", "1st Grade phonics"],
  ["2", "Math", "Fractions", "2nd Grade fractions"],
  ["2", "Math", "Addition With Regrouping", "2nd Grade addition with regrouping"],
  ["2", "Math", "Place Value", "2nd Grade place value"],
  ["2", "Reading", "Reading Comprehension", "2nd Grade reading comprehension"],
  ["3", "Math", "Multiplication", "3rd Grade multiplication"],
  ["3", "Math", "Division", "3rd Grade division"],
  ["3", "Math", "Fractions", "3rd Grade fractions"],
  ["4", "Math", "Long Division", "4th Grade long division"],
  ["4", "Math", "Fractions", "4th Grade fractions"],
  ["5", "Math", "Decimals", "5th Grade decimals"],
  ["5", "Math", "Fractions", "5th Grade fractions"],
  ["5", "Spelling", "Vocabulary", "5th Grade vocabulary"],
];

const slugify = (s) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// ---- collect pages ----
const pages = [];
const seen = new Set();
function addPage(p) {
  if (seen.has(p.slug)) return;
  seen.add(p.slug);
  pages.push(p);
}

for (const [num, [gl, gs]] of Object.entries(gradeByNum)) {
  for (const [subj, sslug, stopic] of subjects) {
    addPage({
      slug: `${gs}-${sslug}-worksheets`,
      grade: num,
      gradeLabel: gl,
      subject: subj,
      genTopic: `${gl} ${stopic}`,
      h1: `Free ${gl} ${subj} Worksheets`,
    });
  }
}
for (const [num, subj, topicLabel, genTopic] of topics) {
  const gl = gradeByNum[num][0];
  const gs = gradeByNum[num][1];
  addPage({
    slug: `${gs}-${slugify(topicLabel)}-worksheets`,
    grade: num,
    gradeLabel: gl,
    subject: subj,
    genTopic,
    h1: `Free ${gl} ${topicLabel} Worksheets`,
  });
}

// ---- templates ----
const gradeOptions = Object.keys(gradeByNum)
  .map((g) => `<option>${g}</option>`)
  .join("");
const subjectOptions = subjects.map((s) => `<option>${s[0]}</option>`).join("");

const resultModal = `
    <section id="resultWrap" class="result-wrap" hidden>
      <div id="upsellBar" class="upsell no-print" hidden>
        <span>\u{1F513} Free preview — your worksheet has a watermark</span>
        <button id="upsellBtn" type="button">Remove watermark &amp; go unlimited — $5</button>
      </div>
      <div class="toolbar no-print">
        <button id="printBtn" type="button">\u{1F5A8}\u{FE0F} Print / Save as PDF</button>
        <span id="note" class="note"></span>
      </div>
      <article id="result" class="worksheet"></article>
    </section>`;

const paywall = `
  <div id="paywall" class="modal-backdrop no-print" hidden>
    <div class="modal">
      <h2>Unlock unlimited worksheets</h2>
      <p class="price">$5 — one-time. No subscription.</p>
      <ul>
        <li>Unlimited generation (no daily limit)</li>
        <li>No watermark</li>
        <li>Math, Reading &amp; Spelling, Grades K–5</li>
        <li>Instant print / PDF — forever</li>
      </ul>
      <a id="gumroadBtn" class="buy-btn" href="#" target="_blank" rel="noopener">Buy on Gumroad — $5</a>
      <p class="trust">Secure checkout via Gumroad · no account needed</p>
      <div class="divider">Already purchased? Enter your key below</div>
      <input id="licenseInput" type="text" placeholder="Paste your license key" autocomplete="off" />
      <button id="activateBtn" class="btn-secondary" type="button">Activate</button>
      <p id="activateMsg" class="msg"></p>
      <button id="closeModal" class="link-btn" type="button">Close</button>
    </div>
  </div>`;

function renderPage(p) {
  const url = `${DOMAIN}/worksheets/${p.slug}/`;
  const title = `${p.h1} — Printable with Answer Keys | WorksheetAI`;
  const desc = `Create free ${p.h1
    .replace(/^Free /, "")
    .toLowerCase()} with instant answer keys. Type any topic and print in 30 seconds — free to try, no signup.`;
  const lede = `Need ${p.h1
    .replace(/^Free /, "")
    .toLowerCase()} fast? Type a topic below and WorksheetAI writes a clean, printable worksheet with an answer key in about 30 seconds — perfect for ${p.gradeLabel.toLowerCase()} homeschool practice.`;

  const siblings = pages.filter((x) => x.grade === p.grade && x.slug !== p.slug).slice(0, 8);
  const related = siblings
    .map((s) => `<li><a href="/worksheets/${s.slug}/">${s.h1}</a></li>`)
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <meta name="description" content="${desc}" />
  <link rel="canonical" href="${url}" />
  <link rel="stylesheet" href="/app.css?v=6" />
</head>
<body>
  <div class="wrap">
    <header class="site no-print">
      <div class="brand"><a href="/">Worksheet<span>AI</span></a></div>
    </header>

    <h1 class="page-h1">${p.h1}</h1>
    <p class="lede">${lede}</p>

    <form id="genForm" class="card no-print" data-grade="${p.grade}" data-subject="${p.subject}" data-topic="${p.genTopic}">
      <div class="grid">
        <div class="field"><label for="grade">Grade</label><select id="grade">${gradeOptions}</select></div>
        <div class="field"><label for="subject">Subject</label><select id="subject">${subjectOptions}</select></div>
        <div class="field full"><label for="topic">Topic</label><input id="topic" type="text" autocomplete="off" /></div>
      </div>
      <button type="submit" id="genBtn" class="btn-primary">Generate worksheet</button>
      <p id="quota" class="quota"></p>
    </form>
${resultModal}

    <section class="related no-print">
      <h2>More ${p.gradeLabel} worksheets</h2>
      <ul>${related}<li><a href="/">All worksheets →</a></li></ul>
    </section>

    <p class="trustbar">Free to try · 2 worksheets a day · no signup · unlimited for $5 once</p>

    <footer class="site no-print">
      <p><strong>Unlimited printable worksheets — $5 once.</strong></p>
      <p><a href="/">WorksheetAI home</a> · <a href="/privacy.html">Privacy</a> · <a href="/terms.html">Terms</a></p>
    </footer>
  </div>
${paywall}
  <script src="/app.js?v=6" defer></script>
</body>
</html>
`;
}

// ---- write files ----
fs.rmSync(OUT_DIR, { recursive: true, force: true });
for (const p of pages) {
  const dir = path.join(OUT_DIR, p.slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "index.html"), renderPage(p));
}

// sitemap
const urls = [`${DOMAIN}/`, ...pages.map((p) => `${DOMAIN}/worksheets/${p.slug}/`)];
const sitemap =
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  urls.map((u) => `  <url><loc>${u}</loc></url>`).join("\n") +
  `\n</urlset>\n`;
fs.writeFileSync(path.join(ROOT, "sitemap.xml"), sitemap);

fs.writeFileSync(
  path.join(ROOT, "robots.txt"),
  `User-agent: *\nAllow: /\nSitemap: ${DOMAIN}/sitemap.xml\n`
);

console.log(`Generated ${pages.length} pages into /worksheets`);
pages.slice(0, 12).forEach((p) => console.log("  /worksheets/" + p.slug + "/"));
console.log("  ... and " + Math.max(0, pages.length - 12) + " more");
console.log("Wrote sitemap.xml and robots.txt");
