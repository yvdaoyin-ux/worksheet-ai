// _bench/test_relevel.cjs
//
// Locks the invariant that makes the THREE-LEVELS feature honest.
//
// Why this test exists (2026-10-18): "the same worksheet at three levels" is the
// one thing a static worksheet library structurally cannot copy — it is the
// product's headline differentiator. The promise is that question 3 of the
// Easier sheet tests what question 3 of the Standard sheet tested, so ONE lesson
// can be taught once and marked against ONE answer key.
//
// buildRelevelPrompt() does ask the model to keep "the same number of questions,
// same order". But asking is not enforcing: the relevel branch used to accept any
// output that merely passed looksComplete() (which only checks that the answer
// key covers the questions). A model that returned 8 questions instead of 10
// produced a "level set" whose questions no longer line up — and the parent
// would discover it while comparing the two sheets side by side.
//
// The fix counts the questions in the SOURCE sheet and rejects a re-levelled
// sheet with a different count. This test locks both halves: the prompt still
// states the requirement, and the code still enforces it.
//
// Run: node _bench/test_relevel.cjs      (pure local, no network, no keys)

const fs = require("fs");
const path = require("path");
const g = require(path.join(__dirname, "..", "api", "generate.js"));

let pass = 0;
const fails = [];
function check(name, ok, extra) {
  if (ok) { pass++; console.log("PASS", name); }
  else { fails.push(name); console.log("FAIL", name, extra === undefined ? "" : "| " + extra); }
}

// ---------- 1. the question counter itself ----------
const count = g._countListItems;
check("countListItems is exported", typeof count === "function");

if (typeof count === "function") {
  const sheet = (n) =>
    '<ol class="ws-questions">' + Array.from({ length: n }, (_, i) => "<li>Q" + (i + 1) + "</li>").join("") + "</ol>";
  for (const n of [1, 3, 10, 12]) {
    const html = sheet(n);
    const m = html.match(/<ol[^>]*class="ws-questions"[\s\S]*?<\/ol>/i);
    check("counts " + n + " questions", count(m) === n, "got " + count(m));
  }
  check("a missing <ol> counts as 0", count(null) === 0);
  check("an empty <ol> counts as 0", count(String("<ol class=\"ws-questions\"></ol>").match(/<ol[^>]*class="ws-questions"[\s\S]*?<\/ol>/i)) === 0);
  // Nested tags inside an <li> must not inflate the count.
  const nested = '<ol class="ws-questions"><li><div class="viz">x</div>Q1</li><li>Q2</li></ol>';
  check("nested markup does not inflate the count", count(nested.match(/<ol[^>]*class="ws-questions"[\s\S]*?<\/ol>/i)) === 2);
}

// ---------- 2. the prompt still states the requirement ----------
const rp = g._buildRelevelPrompt("3", "Math", "fractions", "easier", "<ol class=\"ws-questions\"><li>x</li></ol>");
check("relevel prompt demands the SAME number of questions", /NUMBER of questions/i.test(rp));
check("relevel prompt demands the SAME order", /ORDER/i.test(rp));
check("relevel prompt pins question-by-question skills", /Question 3 must still test what question 3 tested/i.test(rp));
const rpHard = g._buildRelevelPrompt("3", "Math", "fractions", "challenge", "<ol class=\"ws-questions\"><li>x</li></ol>");
check("the challenge prompt keeps the same requirement", /NUMBER of questions/i.test(rpHard));

// ---------- 3. the SERVER actually enforces it (source-level) ----------
const src = fs.readFileSync(path.join(__dirname, "..", "api", "generate.js"), "utf8");
const branchStart = src.indexOf('req.body.mode === "relevel"');
const branchEnd = src.indexOf('req.body.mode === "rewrite"', branchStart);
const branch = branchStart >= 0 && branchEnd > branchStart ? src.slice(branchStart, branchEnd) : "";

check("the relevel branch is found", branch.length > 0);
check(
  "relevel counts the questions in the SOURCE sheet",
  /countListItems\([\s\S]{0,120}source[\s\S]{0,80}\)/.test(branch),
  "source sheet must be measured, not just the output"
);
check(
  "relevel rejects an output whose question count differs",
  /gotQ\s*!==\s*wantQ/.test(branch),
  "the guard compares output count against source count"
);
check(
  "a mismatched sheet never reaches the customer (it `continue`s to the next model)",
  /gotQ\s*!==\s*wantQ[\s\S]{0,400}?continue;/.test(branch)
);
check(
  "the mismatch produces a message that explains the answer-key problem",
  /wouldn't line up with your answer key|line up with your answer key/.test(branch)
);

// ---------- 4. the guard must run BEFORE proofread (cheaper first) ----------
const idxCount = branch.indexOf("wantQ");
const idxProof = branch.indexOf("proofread(");
check(
  "the question-count guard runs before the proofread pass",
  idxCount >= 0 && idxProof > idxCount,
  "guard@" + idxCount + " proofread@" + idxProof
);

// ---------- summary ----------
console.log("");
if (fails.length) {
  console.log("FAILED " + fails.length + "/" + (pass + fails.length) + ":");
  fails.forEach((f) => console.log("  - " + f));
  process.exit(1);
}
console.log("three-levels invariant: " + pass + "/" + pass + " passed");
console.log("ALL PASS");
