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
const subjectOptions = subjects
  .map((s) => `<option value="${s[0]}">${s[0]}${s[0] === "Math" ? " \u2605" : " (Pro)"}</option>`)
  .join("");

const resultModal = `
    <section id="resultWrap" class="result-wrap" hidden>
      <div id="upsellBar" class="upsell no-print" hidden>
        <span>\u{1F513} Free plan — watermarked · 2 math worksheets a day</span>
        <button id="upsellBtn" type="button">Upgrade — unlimited math from $6.93</button>
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
      <h2>Choose a plan</h2>
      <p class="price">Free forever: 2 math worksheets a day + 1 in any other subject.</p>

      <p class="plan-head"><strong>Basic — $6.93 once</strong> <s>$9.90</s> (30% off)</p>
      <ul>
        <li><strong>Unlimited math worksheets</strong>, every day</li>
        <li>3 worksheets a day in reading, spelling, science &amp; the rest</li>
        <li>No watermark</li>
      </ul>
      <a id="gumroadBtn" class="buy-btn" href="#" target="_blank" rel="noopener">Get Basic — $6.93 once (30% off)</a>

      <p class="plan-head"><strong>Pro — monthly</strong></p>
      <ul>
        <li><strong>All 8 subjects, unlimited</strong> — no daily limits at all</li>
        <li>Every new feature we ship, included</li>
        <li>No watermark</li>
      </ul>
      <a id="gumroadMonthlyBtn" class="buy-btn buy-btn-alt" href="#" target="_blank" rel="noopener">Go Pro monthly</a>

      <p class="plan-note">Both plans keep math unlimited. Cancel Pro any time.</p>
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
  <meta property="og:type" content="website" />
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${desc}" />
  <meta property="og:image" content="${DOMAIN}/og.png" />
  <meta property="og:url" content="${url}" />
  <meta name="twitter:card" content="summary_large_image" />
  <link rel="canonical" href="${url}" />
  <link rel="stylesheet" href="/app.css?v=18" />
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

    <section id="homeSubBox" class="sub-box no-print">
      <p class="sub-title">📩 Get a free ${p.gradeLabel} worksheet pack every Friday</p>
      <p class="sub-sub">Five printables with answer keys, straight to your inbox. No spam, unsubscribe anytime.</p>
      <form id="homeSubForm" class="sub-form">
        <input id="homeSubEmail" type="email" placeholder="you@email.com" autocomplete="email" required />
        <button type="submit" id="homeSubBtn">Send me packs</button>
      </form>
      <p id="homeSubMsg" class="msg"></p>
    </section>

    <p class="trustbar">2 math worksheets a day free · 1 in other subjects · no signup · Basic (unlimited math) $6.93 once · Pro (all subjects) monthly</p>

    <footer class="site no-print">
      <p><strong>Unlimited printable worksheets — $6.93 once (30% off).</strong></p>
      <p class="about">Made by an independent developer — every purchase keeps the servers running and funds new features. Thank you for the support!</p>
      <p><a href="/">WorksheetAI home</a> · <a href="/privacy.html">Privacy</a> · <a href="/terms.html">Terms</a></p>
    </footer>
  </div>
${paywall}
  <script src="/app.js?v=18" defer></script>
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
