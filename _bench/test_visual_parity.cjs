// _bench/test_visual_parity.cjs
//
// app.js (browser IIFE) and scripts/visuals.js (build-time) are TWO copies of the
// same renderers. The project rule is "change one -> change the other", and the
// baked SEO samples are produced by visuals.js while the live app uses app.js —
// so any divergence ships two different pictures of the same worksheet.
//
// renderMathString() already had a 2-implementation test (test_frac_render.cjs).
// The EIGHT VISUAL BUILDERS had none, and had silently drifted (app.js's fraction
// circle was missing the role/aria-label that visuals.js emits). This closes that
// hole: every builder must produce byte-identical output on both sides.
//
// No network, no browser. Run: node _bench/test_visual_parity.cjs

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

// --- pull a top-level `function name(...) {...}` out of a source file ---------
function makeGrabber(src, file) {
  return (name) => {
    const i = src.indexOf("function " + name + "(");
    if (i < 0) throw new Error(file + ": function " + name + " not found");
    let depth = 0;
    for (let k = src.indexOf("{", i); k < src.length; k++) {
      if (src[k] === "{") depth++;
      else if (src[k] === "}") { depth--; if (!depth) return src.slice(i, k + 1); }
    }
    throw new Error(file + ": unbalanced braces in " + name);
  };
}

const appSrc = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
const visSrc = fs.readFileSync(path.join(ROOT, "scripts", "visuals.js"), "utf8");
const grabApp = makeGrabber(appSrc, "app.js");
const grabVis = makeGrabber(visSrc, "scripts/visuals.js");

// Shared helpers each side needs, then the builders. Names differ only in the
// "HTML" suffix app.js uses.
const HELPERS = ["gcd", "fracSpan", "fracLabel"];
const BUILDERS = [
  ["numberLineHTML", "numberLine"],
  ["fractionBarHTML", "fractionBar"],
  ["fractionCircleHTML", "fractionCircle"],
  ["tenFrameHTML", "tenFrame"],
  ["arrayHTML", "array"],
  ["placeValueHTML", "placeValue"],
  ["verticalMathHTML", "vertical"],
  ["organizerHTML", "organizer"],
];

function buildImpl(grab, builderNames) {
  const src = HELPERS.map(grab).join("\n") + "\n" + builderNames.map(grab).join("\n");
  const ret = builderNames.map((n, i) => n + ": " + n).join(", ");
  return new Function(src + "\nreturn {" + ret + "};")();
}

const app = buildImpl(grabApp, BUILDERS.map((p) => p[0]));
const vis = buildImpl(grabVis, BUILDERS.map((p) => p[1]));

// --- cases: one entry per builder, in the same order -------------------------
const CASES = [
  [{ min: 0, max: 1, ticks: 4, points: [] },
   { min: 0, max: 10, ticks: 5, points: ["3", "7:here"] },
   { min: 0, max: 1, ticks: 5, points: ["0.6:six tenths"] },
   { min: -5, max: 5, ticks: 4, points: ["-3"] },
   { min: 0, max: 1, ticks: 0, points: [] }],
  [{ num: 3, den: 4 }, { num: 0, den: 5 }, { num: 7, den: 7 }, { num: 1, den: 1 }],
  [{ num: 1, den: 4 }, { num: 0, den: 3 }, { num: 5, den: 6 }, { num: 1, den: 2 }],
  [{ count: 7 }, { count: 0 }, { count: 12 }, { count: 10 }],
  [{ rows: 3, cols: 4 }, { rows: 1, cols: 1 }, { rows: 2, cols: 5 }],
  [{ number: 345 }, { number: 62 }, { number: 7 }, { number: 1000 }],
  [{ a: "345", b: "128", op: "+" }, { a: "90", b: "7", op: "-" }, { a: "", b: "1", op: "+" }],
  ["story", "sequence", "kwl", "compare", "main-idea", "something-else"],
];

let pass = 0;
const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("PASS", name); }
  else { fails.push(name); console.log("FAIL", name, extra === undefined ? "" : "| " + extra); }
}

BUILDERS.forEach(([appName, visName], i) => {
  const args = CASES[i];
  let identical = true;
  let detail = "";
  args.forEach((arg, k) => {
    const a = app[appName](arg);
    const v = vis[visName](arg);
    if (a !== v) {
      identical = false;
      if (!detail) detail = "case#" + k + " app=" + JSON.stringify(a) + " visuals=" + JSON.stringify(v);
    }
  });
  ok(appName + " == " + visName + " (" + args.length + " cases)", identical, detail);
  // Guard against a vacuous pass: if a grabber ever returned a stub that renders
  // nothing, both sides would "agree" on "" and the check above would be hollow.
  const rendered = args.map((arg) => String(app[appName](arg))).join("");
  ok(appName + " actually renders markup", rendered.length > 60 && rendered.indexOf("viz") >= 0,
    "rendered " + rendered.length + " chars");
});

console.log("\nvisual builder parity: " + pass + "/" + (pass + fails.length) + " builders identical");
if (fails.length) {
  console.log("DRIFT DETECTED — app.js and scripts/visuals.js disagree:");
  fails.forEach((x) => console.log("  - " + x));
  process.exit(1);
}
console.log("ALL PASS");
