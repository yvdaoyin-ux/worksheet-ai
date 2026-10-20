// _bench/test_claims.cjs
//
// Locks the honesty rules for the homepage's closing argument.
//
// Why this test exists (2026-10-18): growth work naturally pushes toward social
// proof — testimonials, star ratings, "10,000 happy families". This product has
// ZERO customer quotes so far, and inventing one would be straightforward fraud
// (and an FTC problem in the US market this site sells into). The block we
// shipped instead says, in as many words, "No testimonials here yet", and then
// lists claims a visitor can verify for themselves on the free plan.
//
// So this test guards two things at once:
//   1. no fabricated testimonial / rating markup sneaks into the homepage;
//   2. every checkable claim in that block is actually true in this repo.
//
// Claim #2 ("one lesson, three levels") is backed by the relevel question-count
// guard tested in test_relevel.cjs; claim #1 by checkMath/proofread in
// api/generate.js. If a future change deletes those, the homepage starts lying —
// which is exactly what this file is here to catch.
//
// Run: node _bench/test_claims.cjs      (pure local, no network, no keys)

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

let pass = 0;
const fails = [];
function check(name, ok, extra) {
  if (ok) { pass++; console.log("PASS", name); }
  else { fails.push(name); console.log("FAIL", name, extra === undefined ? "" : "| " + extra); }
}

const html = read("index.html");
const css = read("app.css");
const gen = read("api/generate.js");

// ---------- 1. the block exists and owns its "no testimonials" stance ----------
check("the checkable-claims block is in the homepage", /class="proof"/.test(html));
check("its styles exist", /\.proof-list/.test(css));
check(
  "it states plainly that there are no testimonials yet",
  /No testimonials here yet/i.test(html)
);
check(
  "it invites verification rather than trust",
  /check it yourself/i.test(html)
);

// ---------- 2. no fabricated social proof anywhere in the homepage ----------
const FORBIDDEN = [
  /★\s*★\s*★/,                 // star ratings
  /\b\d+(\.\d+)?\s*\/\s*5\s*stars?\b/i,
  /\b\d[\d,]{2,}\+?\s*(happy|satisfied)\b/i,   // "10,000 happy families"
  /\brated\b[^.]{0,20}\bstars?\b/i,
  /"[^"]{15,}"\s*[—-]\s*\w+\s+[A-Z]\./         // "quote" — Jenny P.
];
for (const re of FORBIDDEN) {
  check("no fabricated proof matching " + re, !re.test(html));
}

// A testimonial-looking block would need a name/initial attribution; the only
// legitimate use of a capital-letter initial here is the FAQ prose, so scan for
// the classic "— FirstName L., State" pattern specifically.
check(
  "no fake person attribution like '— Jenny P., Illinois'",
  !/—\s*[A-Z][a-z]+\s+[A-Z]\.\s*,\s*[A-Z][a-z]+/.test(html)
);

// ---------- 3. each listed claim must still be TRUE in this codebase ----------
// Claim: "an answer key that was actually recomputed"
check(
  "claim: arithmetic is really recomputed (checkMath exists)",
  /function checkMath\s*\(/.test(gen)
);
// Claim: "reading answers are compared against the passage text"
check(
  "claim: reading answers are really checked against the passage",
  /function extractPassage\s*\(/.test(gen) && /extractPassage\(/.test(gen)
);
check(
  "claim: the proofreader is actually wired into generation",
  /proofread\(html, grade, subject, topic\)/.test(gen)
);
// Claim: "prints on one page ... set up for US Letter"
check("claim: the stylesheet really declares US Letter", /@page\s*\{\s*size:\s*Letter/.test(css));
// Claim: "No account, no card, no email"
check(
  "claim: the free tier really needs no account",
  /no account/i.test(html) && !/id="signup"|id="login"/.test(html)
);
// Claim: "one lesson at three levels" — the relevel guard must still enforce the
// question-count invariant, otherwise question 3 is no longer question 3.
check(
  "claim: re-levelling still enforces the same question count",
  /gotQ\s*!==\s*wantQ/.test(gen)
);

// ---------- 4. the free offer quoted on the page matches the code ----------
// The block promises "two math worksheets a day are free". Keep that in sync
// with the constant that actually enforces it.
const appSrc = read("app.js");
const m = appSrc.match(/FREE_MATH_DAILY\s*=\s*(\d+)/);
check("FREE_MATH_DAILY is defined", !!m, "not found");
if (m) {
  const n = parseInt(m[1], 10);
  check(
    "the homepage's free-math allowance matches FREE_MATH_DAILY (" + n + ")",
    new RegExp(n + "\\s*math worksheets a day", "i").test(html) ||
    new RegExp("free[:\\s]*" + n + "\\s*math", "i").test(html),
    "homepage wording does not mention " + n
  );
}

// ---------- summary ----------
console.log("");
if (fails.length) {
  console.log("FAILED " + fails.length + "/" + (pass + fails.length) + ":");
  fails.forEach((f) => console.log("  - " + f));
  process.exit(1);
}
console.log("honest-claims rules: " + pass + "/" + pass + " passed");
console.log("ALL PASS");
