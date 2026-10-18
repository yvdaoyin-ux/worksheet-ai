// _bench/test_library.cjs
//
// Locks the library / reprint rules that were broken until 2026-10-18.
//
// The bug: "the subject of this page" was read from the FORM in four places
// (addAnswerSpace, ensureOrganizer, itemContext, the pack header). Reprinting a
// stored Reading worksheet while the form happened to show "Math" therefore
//   - skipped the ruled answer lines (the child had nowhere to write), and
//   - sent the WRONG subject with a per-question rewrite/tweak request.
// The fix introduces sheetSubject() as the single source of truth, and this
// test makes sure nothing drifts back to reading the form directly.
//
// It also locks three neighbouring fixes so they cannot be silently reverted:
//   - a pack records its own lastCtx (otherwise a later reprint leaks in),
//   - storage pressure is reported instead of silently halving the list,
//   - a short pack caused by a BUSY MODEL is not reported as "free limit hit".
//
// Static source assertions on purpose: these are browser IIFE internals that
// cannot be required. Each assertion is paired with a "the thing actually exists"
// check so a rename cannot make the test pass vacuously.
//
// Run: node _bench/test_library.cjs      (pure local, no network, no keys)

const fs = require("fs");
const path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");

let pass = 0;
const fails = [];
function check(name, ok, extra) {
  if (ok) { pass++; console.log("PASS", name); }
  else { fails.push(name); console.log("FAIL", name, extra === undefined ? "" : "| " + extra); }
}

// Slice out one function body by name. Returns "" when the function is gone —
// every caller asserts non-empty first, so a deletion can never pass silently.
function fnBody(name) {
  const start = src.indexOf("function " + name + "(");
  if (start < 0) return "";
  // Function bodies in app.js are indented by two spaces; the closing brace of a
  // top-level inner function is "\n  }".
  const end = src.indexOf("\n  }", start);
  return end < 0 ? "" : src.slice(start, end + 4);
}

// ---------- 1. sheetSubject() exists and prefers the sheet, not the form ----------
const sheetSubj = fnBody("sheetSubject");
check("sheetSubject() exists", sheetSubj.length > 0);
check(
  "sheetSubject() prefers lastCtx.subject",
  /lastCtx\s*&&\s*lastCtx\.subject/.test(sheetSubj)
);
check(
  "sheetSubject() only falls back to the form",
  sheetSubj.indexOf('$("subject")') > -1 &&
  sheetSubj.indexOf("lastCtx") < sheetSubj.indexOf('$("subject")'),
  "fallback must come after the sheet value"
);

// ---------- 2. nothing decorates the sheet using the form's subject ----------
for (const fn of ["addAnswerSpace", "ensureOrganizer", "itemContext"]) {
  const body = fnBody(fn);
  check(fn + "() still exists", body.length > 0);
  check(fn + "() uses sheetSubject()", /sheetSubject\(\)/.test(body));
  check(
    fn + "() does NOT read the subject form field directly",
    !/\$\("subject"\)\s*\?\s*\$\("subject"\)\.value/.test(body) && !/const\s+subject\s*=\s*\$\("subject"\)/.test(body)
  );
}

// ---------- 3. a pack pins its own context ----------
const paintPack = fnBody("paintPack");
check("paintPack() exists", paintPack.length > 0);
check("paintPack() records lastCtx (so a later reprint cannot leak in)", /lastCtx\s*=/.test(paintPack));

// ---------- 4. reprinting sets lastCtx from the STORED entry ----------
check(
  "reprint sets lastCtx from the stored item",
  /lastCtx\s*=\s*\{\s*grade:\s*it\.grade[\s\S]{0,80}subject:\s*it\.subject/.test(src)
);

// ---------- 5. an edited sheet is persisted, not just repainted ----------
const runItemEdit = fnBody("runItemEdit");
check("runItemEdit() exists", runItemEdit.length > 0);
check("runItemEdit() persists the edited sheet", /syncSheetStorage\(prevHtml\)/.test(runItemEdit));
check(
  "runItemEdit() updates the existing library entry instead of adding a near-duplicate",
  /const prevHtml = lastSheetHtml/.test(runItemEdit)
);
const sync = fnBody("syncSheetStorage");
check("syncSheetStorage() exists", sync.length > 0);
check("syncSheetStorage() refreshes lastSheetHtml", /lastSheetHtml\s*=\s*clone\.innerHTML/.test(sync));
check("syncSheetStorage() files the sheet into history", /saveHist\(/.test(sync));
check("syncSheetStorage() strips the watermark before storing", /watermark/.test(sync));

// ---------- 6. storage pressure is reported, never a silent half-list write ----------
const saveList = fnBody("saveList");
check("saveList() exists", saveList.length > 0);
check(
  "saveList() no longer halves the list behind the visitor's back",
  !/slice\(0,\s*Math\.ceil\(list\.length\s*\/\s*2\)\)/.test(saveList)
);
check("saveList() reports success/failure to the caller", /return\s+true/.test(saveList) && /return\s+false/.test(saveList));
const trimmed = fnBody("saveListTrimmed");
check("saveListTrimmed() exists", trimmed.length > 0);
check("saveListTrimmed() reports how many entries were dropped", /dropped/.test(trimmed));
check(
  "the pin limit is a high, honest ceiling rather than a hidden 100",
  /const\s+FAV_MAX\s*=\s*(\d+)/.test(src) && parseInt(RegExp.$1, 10) >= 100,
  RegExp.$1
);
check("pinning uses FAV_MAX, not a magic 100", /slice\(0,\s*FAV_MAX\)/.test(src));

// ---------- 7. the library can be pruned ----------
check("library chips carry a remove button", /className\s*=\s*"chip-x"/.test(src));
check("the library offers a clear-all control", /className\s*=\s*"chip-clear"/.test(src));

// ---------- 8. a busy model is not blamed on the visitor's allowance ----------
check("runPack tracks a busy stop separately", /busyStop\s*=\s*true/.test(src));
check("paintPack receives busyStop", /function paintPack\(sheets, stopped, requested, busyStop\)/.test(src));
check(
  "the busy message does not claim the free limit was hit",
  /busyStop[\s\S]{0,220}allowance is untouched/.test(src)
);

// ---------- summary ----------
console.log("");
if (fails.length) {
  console.log("FAILED " + fails.length + "/" + (pass + fails.length) + ":");
  fails.forEach((f) => console.log("  - " + f));
  process.exit(1);
}
console.log("library / reprint rules: " + pass + "/" + pass + " passed");
console.log("ALL PASS");
