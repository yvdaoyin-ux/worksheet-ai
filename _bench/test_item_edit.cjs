// _bench/test_item_edit.cjs
//
// Locks the ONE rule the per-question tools must never break: a question may
// never change without its matching answer-key entry changing with it.
//
// Why this test exists (2026-10-18): v41 fixed 🔄 Rewrite so it returns a new
// question AND its new answer, and added parseItemEdit() as the shared gate. But
// the gate only required `question` to be non-empty — `answer` was allowed to be
// "" / missing / null. On the client, applyAnswerEdit() skips an empty answer,
// while the question had ALREADY been swapped into the DOM. Net result: a brand
// new question graded against the PREVIOUS question's answer — the exact
// "parent marks a correct child wrong" failure v41 set out to remove.
//
// The contract is enforced twice now, and both halves are asserted here:
//   1. api/generate.js  parseItemEdit() rejects any edit whose answer is empty.
//   2. app.js           runItemEdit() validates BEFORE touching the DOM.
//
// Run: node _bench/test_item_edit.cjs     (pure local, no network, no keys)

const fs = require("fs");
const path = require("path");
const g = require(path.join(__dirname, "..", "api", "generate.js"));
const parseItemEdit = g._parseItemEdit;

let pass = 0;
const fails = [];
function check(name, ok, extra) {
  if (ok) { pass++; console.log("PASS", name); }
  else { fails.push(name); console.log("FAIL", name, extra === undefined ? "" : "| " + extra); }
}

if (typeof parseItemEdit !== "function") {
  console.log("FAIL parseItemEdit is exported from api/generate.js");
  process.exit(1);
}

// ---------- layer 1: the server-side gate ----------
const cases = [
  ["accepts a well-formed edit", '{"question":"<p>5 + 7 = ?</p>","answer":"12"}', true],
  ["tolerates code fences / prose around the JSON", 'Here you go:\n```json\n{"question":"<p>1+1=?</p>","answer":"2"}\n```', true],
  ["rejects an EMPTY answer", '{"question":"<p>8 + 9 = ?</p>","answer":""}', false],
  ["rejects a whitespace-only answer", '{"question":"<p>9 + 9 = ?</p>","answer":"   "}', false],
  ["rejects a MISSING answer field", '{"question":"<p>4 + 4 = ?</p>"}', false],
  ["rejects a null answer", '{"question":"<p>3 + 3 = ?</p>","answer":null}', false],
  ["rejects a non-string answer (number)", '{"question":"<p>2 + 2 = ?</p>","answer":4}', false],
  ["rejects an empty question", '{"question":"","answer":"5"}', false],
  ["rejects a missing question", '{"answer":"5"}', false],
  ["rejects plain prose with no JSON", "Sorry, I cannot do that.", false],
  ["rejects an unparseable object", '{"question": "<p>x</p>", "answer": }', false],
];
for (const [name, raw, shouldAccept] of cases) {
  const r = parseItemEdit(raw);
  check(name, !!r === shouldAccept, "got " + JSON.stringify(r));
}

// The empty-answer family is the regression; assert it explicitly so a future
// refactor cannot quietly re-allow it while keeping the other cases green.
const emptyAnswerFamily = [
  '{"question":"<p>q</p>","answer":""}',
  '{"question":"<p>q</p>","answer":"  \\n "}',
  '{"question":"<p>q</p>"}',
  '{"question":"<p>q</p>","answer":null}',
];
check(
  "no empty-answer variant is ever accepted",
  emptyAnswerFamily.every((raw) => parseItemEdit(raw) === null)
);

// ---------- layer 2: the client must validate before touching the DOM ----------
const appSrc = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");

// The ordering matters more than the presence of the check: assigning
// li.innerHTML first and validating afterwards leaves the sheet corrupted on
// exactly the failure we are guarding against.
const fnStart = appSrc.indexOf("async function runItemEdit");
const fnEnd = appSrc.indexOf("\n  function rewriteItem", fnStart);
const fnBody = fnStart >= 0 && fnEnd > fnStart ? appSrc.slice(fnStart, fnEnd) : "";

check("runItemEdit() is found in app.js", fnBody.length > 0);
check(
  "runItemEdit() refuses an empty answer",
  /if\s*\(\s*!data\.answer\s*\|\|/.test(fnBody)
);
const idxGuard = fnBody.search(/if\s*\(\s*!data\.answer[\s\S]*?\)\s*\{?\s*throw/);
const idxSwap = fnBody.indexOf("li.innerHTML = data.html");
check(
  "the answer guard runs BEFORE the question is swapped in",
  idxGuard >= 0 && idxSwap > idxGuard,
  "guard@" + idxGuard + " swap@" + idxSwap
);
check(
  "applyAnswerEdit() is still called after the swap (answer key is written)",
  fnBody.indexOf("applyAnswerEdit(ctx, data)") > idxSwap
);
check(
  "the edit is persisted (syncSheetStorage) so Pin / Recent / re-level follow it",
  /syncSheetStorage\(prevHtml\)/.test(fnBody)
);
check(
  "the pre-edit html is captured BEFORE the swap (so the library entry is updated, not duplicated)",
  /const prevHtml = lastSheetHtml/.test(fnBody) &&
  fnBody.indexOf("const prevHtml = lastSheetHtml") < idxSwap
);
check(
  "ruled answer lines are restored after li.innerHTML is replaced",
  /addAnswerLinesTo\(li\)/.test(fnBody) && fnBody.indexOf("addAnswerLinesTo(li)") > idxSwap
);

// ---------- summary ----------
console.log("");
if (fails.length) {
  console.log("FAILED " + fails.length + "/" + (pass + fails.length) + ":");
  fails.forEach((f) => console.log("  - " + f));
  process.exit(1);
}
console.log("item-edit contract: " + pass + "/" + pass + " passed");
console.log("ALL PASS");
