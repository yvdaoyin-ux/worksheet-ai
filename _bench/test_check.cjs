// _bench/test_check.cjs
// Local unit tests for the deterministic arithmetic checker used by
// api/generate.js. Reuses the REAL exported logic (module.exports._checkMath)
// so this test can never drift from production behaviour.
//
// checkMath() is the first (network-free) layer of answer proofreading: it
// parses only UNAMBIGUOUS bare-computation items, recomputes them with exact
// integer/fraction arithmetic, and flags a mismatch. Anything wordy must be
// skipped, never guessed at — a bad guess would corrupt a correct worksheet.
// This file locks that contract down.
//
// Run:  node _bench/test_check.cjs

const g = require("../api/generate.js");

let pass = 0;
const fails = [];
function ok(name, cond) {
  if (cond) { pass++; }
  else { fails.push(name); }
}

// Build a worksheet html with a questions <ol> and an answer-key <ol>.
function sheet(qs, ans) {
  return (
    '<div class="worksheet">\n' +
    '<ol class="ws-questions">\n' +
    qs.map((q) => "  <li>" + q + "</li>").join("\n") + "\n" +
    "</ol>\n" +
    '<p class="ws-answers-title">Answer Key</p>\n' +
    '<ol class="ws-answers">\n' +
    ans.map((a) => "  <li>" + a + "</li>").join("\n") + "\n" +
    "</ol>\n" +
    "</div>"
  );
}
const check = (qs, ans) => g._checkMath(sheet(qs, ans)).wrong;

// ---- [1] correct computations are never flagged ----
{
  const w = check(
    ["3 + 4 = ___", "9 - 2 = ___", "6 \\times 7 = ___", "20 \\div 4 = ___"],
    ["7", "7", "42", "5"]
  );
  ok("correct add/sub/mul/div => 0 flags", w.length === 0);
}

// ---- [2] a wrong computation is flagged with the CORRECT answer + item no. ----
{
  const w = check(["3 + 4 = ___"], ["8"]);
  ok("wrong sum is flagged", w.length === 1);
  ok("flag carries 1-based item number", w.length === 1 && w[0].n === 1);
  ok("flag reports the correct answer", w.length === 1 && w[0].answer === "7");

  const w2 = check(["2 + 2 = ___", "5 + 5 = ___"], ["4", "9"]);
  ok("only the wrong item is flagged", w2.length === 1);
  ok("only the wrong item is flagged (n=2)", w2.length === 1 && w2[0].n === 2);
  ok("only the wrong item is flagged (answer=10)", w2.length === 1 && w2[0].answer === "10");
}

// ---- [3] fractions: exact arithmetic + simplification ----
{
  const good = check(["\\frac{1}{2} + \\frac{1}{4} = ___"], ["\\frac{3}{4}"]);
  ok("correct fraction sum => 0 flags", good.length === 0);

  const bad = check(["\\frac{1}{2} + \\frac{1}{4} = ___"], ["\\frac{2}{4}"]);
  ok("wrong fraction sum is flagged", bad.length === 1);
  ok("wrong fraction sum (2/4==1/2 != 3/4)", bad.length === 1 && bad[0].answer === "\\frac{3}{4}");

  const mix = check(["1\\frac{1}{2} + 1\\frac{1}{2} = ___"], ["3"]);
  ok("mixed numbers 1 1/2 + 1 1/2 => 3, 0 flags", mix.length === 0);
}

// ---- [4] word / themed problems are SKIPPED, never guessed ----
{
  const w = check(["Sam has 3 apples. He buys 4 more. How many? ___"], ["7"]);
  ok("plain word problem is skipped", w.length === 0);

  const themed = check(["Each bag holds 7 candies. 8 bags: 7 \\times 8 = ___"], ["56"]);
  ok("themed computation is skipped (not a bare computation)", themed.length === 0);
}

// ---- [5] answer key with trailing explanation still checks the leading value ----
{
  const w = check(["\\frac{3}{5} + \\frac{1}{5} = ___"], ["\\frac{4}{5} (add the numerators)"]);
  ok("leading value extracted from annotated answer", w.length === 0);
}

// ---- [6] fail-open / tolerance: never crash, never flag what it can't parse ----
{
  ok("no questions block => 0 flags", g._checkMath("<p>hello</p>").wrong.length === 0);
  ok("empty questions block => 0 flags", g._checkMath('<ol class="ws-questions"></ol>').wrong.length === 0);
  ok("missing answer => not flagged", check(["3 + 4 = ___"], []).length === 0);
  ok("non-numeric answer => not flagged", check(["3 + 4 = ___"], ["seven"]).length === 0);
  ok("division by zero => skipped", check(["10 \\div 0 = ___"], ["0"]).length === 0);
}

// ---- [7] subtraction mismatch is reported exactly ----
{
  const w = check(["9 - 2 = ___"], ["6"]);
  ok("wrong difference flagged", w.length === 1 && w[0].answer === "7");
}

// ---- [8] the parent's extra notes are injected as a NON-OVERRIDING layer ----
{
  const withExtra = g._buildPrompt("3", "Math", "multiplication", 8, "standard", "mixed", "", "use two-digit numbers; add money problems");
  ok("extra notes are present in the prompt", withExtra.indexOf("use two-digit numbers; add money problems") >= 0);
  ok("extra notes are labelled as requirements", /EXTRA REQUIREMENTS/i.test(withExtra));
  const noExtra = g._buildPrompt("3", "Math", "multiplication", 8, "standard", "mixed", "", "");
  ok("empty notes => no EXTRA REQUIREMENTS block", !/EXTRA REQUIREMENTS/i.test(noExtra));
}

// ================= summary =================
const total = pass + fails.length;
console.log("\n_checkMath unit tests: " + pass + "/" + total + " passed");
if (fails.length) {
  console.log("FAILED:");
  for (const f of fails) console.log("  - " + f);
  process.exit(1);
}
console.log("ALL PASS");
