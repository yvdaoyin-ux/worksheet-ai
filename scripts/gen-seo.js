// scripts/gen-seo.js
// Generates static programmatic-SEO landing pages under /worksheets/<slug>/index.html
// plus sitemap.xml and robots.txt. Run: node scripts/gen-seo.js

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "worksheets");
const DOMAIN = "https://worksheet-ai-l1td.vercel.app";

// ---- taxonomy (shared with gen-samples.js so the two can't drift) ----
const { pages, gradeByNum, subjects } = require("./pages");
const { hydrate } = require("./visuals");

// ---- real sample worksheet, embedded in every landing page ----
// Without this the pages are doorway pages: an H1 promising "Free Worksheets"
// and no worksheet. scripts/gen-samples.js writes samples/<slug>.html; we bake
// the artwork in (see scripts/visuals.js) so it survives without JavaScript and
// is visible to Google.
const SAMPLES_DIR = path.join(ROOT, "samples");
function sampleBlock(p) {
  const file = path.join(SAMPLES_DIR, p.slug + ".html");
  if (!fs.existsSync(file)) return "";
  let html = hydrate(fs.readFileSync(file, "utf8"));
  const m = html.match(/<hr[^>]*class="ws-pagebreak"[^>]*>/i);
  let body = html, key = "";
  if (m) {
    body = html.slice(0, m.index);
    key = html.slice(m.index + m[0].length);
  }
  const subj = p.subject.toLowerCase();
  return `
    <section class="sample-block">
      <h2 class="no-print">A real ${p.gradeLabel} ${subj} worksheet you can print right now</h2>
      <p class="sample-sub no-print">This is a live example, not a mockup — the same layout and answer key you get in the tool. Print it and use it today, no signup.</p>
      <div class="worksheet sample-worksheet">${body}</div>
      ${key ? `<details class="sample-key no-print"><summary>Show the answer key</summary><div class="worksheet sample-worksheet">${key}</div></details>` : ""}
      <p class="sample-print no-print"><button type="button" onclick="window.print()">Print this worksheet</button><span>Or press Ctrl/⌘ + P — everything except this worksheet is already hidden from the printout.</span></p>
      <p class="sample-cert no-print">Every answer key is checked before it reaches you — arithmetic is recomputed and reading answers are proofread against the passage.</p>
      <p class="sample-cta no-print">Want a different topic? <a href="#genForm">Type it above</a> and press Generate — the first ${p.subject === "Math" ? "2" : "1"} each day is free.</p>
    </section>
`;
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
        <button id="upsellBtn" type="button">Upgrade — unlimited math from $13.30</button>
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

      <p class="plan-head"><strong>Basic — $13.30 once</strong> <s>$19</s> (30% off)</p>
      <ul>
        <li><strong>Unlimited math worksheets</strong>, every day — forever</li>
        <li>3 worksheets a day in reading, spelling, science &amp; the rest</li>
        <li><strong>Packs:</strong> build 5 or 10 sheets on one topic and print them as a set</li>
        <li>No watermark</li>
        <li><strong>One payment.</strong> No subscription, no renewal, no recurring charge.</li>
        <li>30-day money-back guarantee</li>
      </ul>
      <a id="gumroadBtn" class="buy-btn" href="#" target="_blank" rel="noopener">Get Basic — $13.30 once (30% off)</a>
      <ul class="trust-badges">
        <li><span>🛡️</span><span>Secure checkout via Gumroad</span></li>
        <li><span>♾️</span><span>One-time $13.30 — no subscription, no renewal</span></li>
        <li><span>⚡</span><span>Instant license key — printing in a minute</span></li>
        <li><span>🖨️</span><span>Print-ready US Letter · answer key on its own page</span></li>
      </ul>
      <p class="plan-note">Worksheet libraries usually cost $25–150 <em>every year</em>. Basic is a one-time payment — under 4&cent; a day for the first year, and nothing after that.</p>

      <p class="plan-head"><strong>Pro — monthly</strong></p>
      <ul>
        <li><strong>All 8 subjects, unlimited</strong> — no daily limits at all</li>
        <li>Every new feature we ship, included</li>
        <li>No watermark</li>
      </ul>
      <a id="gumroadMonthlyBtn" class="buy-btn buy-btn-alt" href="#" target="_blank" rel="noopener">Go Pro monthly</a>

      <p class="guarantee">30-day money-back guarantee — if it isn't right for you, we refund you in full.</p>
      <div class="compare">
        <p class="compare-title">Why pay once instead of subscribing?</p>
        <div class="compare-row compare-head"><span>Comparing</span><span>Typical worksheet sites</span><span>WorksheetAI</span></div>
        <div class="compare-row"><span>Price</span><span>$120–180 every year</span><span>$13.30 once — forever</span></div>
        <div class="compare-row"><span>Change a question</span><span>No — fixed PDF</span><span>Yes — edit or rewrite any question</span></div>
        <div class="compare-row"><span>Answer key</span><span>Usually the answer only</span><span>Checked twice, with steps</span></div>
        <div class="compare-row"><span>Printing</span><span>Page breaks you can't control</span><span>Fits one page per sheet</span></div>
      </div>
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
  <link rel="stylesheet" href="/app.css?v=25" />
  <style>
    .sample-block { margin: 26px 0 6px; }
    .sample-block h2 { text-align: center; font-size: 20px; margin: 0 0 4px; }
    .sample-sub { text-align: center; color: var(--muted); margin: 0 0 16px; font-size: 14px; }
    .sample-worksheet { font-size: 13px; padding: 20px 22px; }
    .sample-worksheet .ws-title { font-size: 17px; }
    .sample-worksheet .ws-instructions { font-size: 12px; margin-bottom: 10px; }
    .sample-worksheet .ws-name { font-size: 11px; margin-bottom: 12px; gap: 8px; }
    .sample-worksheet .ws-questions > li { font-size: 14px; line-height: 1.75; padding-left: 24px; margin-bottom: 10px; }
    .sample-worksheet .ws-questions > li::before { left: 0; }
    .sample-worksheet .ws-answers > li { font-size: 13px; margin-bottom: 4px; }
    .sample-worksheet .viz-bar .bar { width: 180px; height: 26px; }
    .sample-worksheet .viz-tenframe .tf-frame { grid-template-columns: repeat(5, 24px); grid-template-rows: repeat(2, 24px); }
    .sample-worksheet .viz-numline { height: 60px; }
    .sample-key { max-width: 660px; margin: 16px auto 0; font-size: 14px; }
    .sample-key summary { cursor: pointer; font-weight: 700; color: #2b3a52; }
    .sample-key .sample-worksheet { margin-top: 12px; }
    .sample-cta { text-align: center; color: var(--muted); font-size: 14px; margin: 16px 0 0; }
    .sample-print { text-align: center; margin: 18px 0 0; }
    .sample-print button { font: inherit; font-size: 15px; font-weight: 700; cursor: pointer; border: none; border-radius: 12px; padding: 12px 22px; color: #fff; background: #2f6fed; }
    .sample-print span { display: block; color: var(--muted); font-size: 12px; margin-top: 8px; }
    .sample-cert { text-align: center; color: #0f6e56; background: #e1f5ee; border: 1px solid #9fe1cb; border-radius: 8px; font-size: 12.5px; font-weight: 600; padding: 7px 12px; margin: 14px auto 0; max-width: 620px; }
    /* In print the page must reduce to JUST the worksheet. The landing page's
       own inline .sample-worksheet rules (above) are roomier than the app's
       print rhythm, so they must be overridden here. We qualify every selector
       with .sample-block so it OUT-SPECIFIES the app's generic .worksheet print
       rules no matter the source order - the previous equal-specificity rules
       only worked because this <style> happened to come after the <link>, which
       would silently break if that order ever changed. */
    @media print {
      .sample-block .sample-worksheet { padding: 0; border: none; box-shadow: none; font-size: 15px; }
      .sample-block .sample-worksheet .ws-questions > li { padding-bottom: 7px; margin-bottom: 8px; line-height: 1.8; font-size: 15px; padding-left: 22px; }
      .sample-block .sample-worksheet .ws-answers > li { margin-bottom: 4px; font-size: 14px; }
      .sample-block .sample-worksheet .ws-name { margin-bottom: 12px; font-size: 13px; }
      .sample-block .sample-worksheet .ws-instructions { margin-bottom: 10px; font-size: 14px; }
      .sample-block .sample-worksheet .ws-title { margin-bottom: 4px; font-size: 17px; }
      .sample-block .sample-worksheet .ws-visual { margin: 5px 0 8px; }
      .sample-block .sample-worksheet .viz-numline { height: 64px; }
      .sample-block .sample-worksheet .viz-bar .bar { width: 220px; height: 30px; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <header class="site no-print">
      <div class="brand"><a href="/">Worksheet<span>AI</span></a></div>
    </header>

    <h1 class="page-h1 no-print">${p.h1}</h1>
    <p class="lede no-print">${lede}</p>
    ${p.subject === "Math" ? "" : '<p class="lede no-print">Math is where we shine — this subject is included on Pro and gets better every week.</p>'}
${sampleBlock(p)}

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

    <p class="trustbar no-print">2 math worksheets a day free · 1 in other subjects · <strong>30-day money-back guarantee</strong> · no signup · Basic (unlimited math) $13.30 <strong>once — no renewal</strong> · Pro (all subjects) monthly</p>

    <footer class="site no-print">
      <p><strong>Unlimited printable worksheets — $13.30 once (30% off).</strong></p>
      <p class="about">Made by an independent developer — every purchase keeps the servers running and funds new features. Thank you for the support!</p>
      <p><a href="/">WorksheetAI home</a> · <a href="/privacy.html">Privacy</a> · <a href="/terms.html">Terms</a></p>
    </footer>
  </div>
${paywall}
  <script src="/app.js?v=25" defer></script>
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
