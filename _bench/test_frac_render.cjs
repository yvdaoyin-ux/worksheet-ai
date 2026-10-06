// One-off check: every fraction form an LLM might emit must render stacked.
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");

const { renderMathString: nodeImpl } = require(path.join(root, "scripts", "visuals.js"));

// Extract renderMathString + fracSpan from app.js (browser IIFE, not requireable).
const appSrc = fs.readFileSync(path.join(root, "app.js"), "utf-8");
const grab = (name) => {
  const i = appSrc.indexOf("function " + name + "(");
  if (i < 0) throw new Error(name + " not found");
  let d = 0, j = appSrc.indexOf("{", i);
  for (let k = j; k < appSrc.length; k++) {
    if (appSrc[k] === "{") d++;
    else if (appSrc[k] === "}") { d--; if (!d) return appSrc.slice(i, k + 1); }
  }
  throw new Error(name + " unbalanced");
};
const browserImpl = new Function(
  grab("fracSpan") + "\n" + grab("renderMathString") + "; return renderMathString;"
)();

const FRAC = '<span class="frac"><span class="num">8</span><span class="den">3</span></span>';
const cases = [
  // [input, expected substring check: output must contain stacked frac]
  ["8/3", FRAC],
  ["Answer: 8/3", FRAC],
  ["8 / 3", FRAC],
  ["(8/3)", FRAC],
  ["8\u20443", FRAC],              // U+2044 fraction slash
  ["8\u2044 3", FRAC],             // U+2044 with space
  ["8\u22153", FRAC],              // U+2215 division slash
  ["\\frac{8}{3}", FRAC],
  ["\\dfrac{8}{3}", FRAC],         // dfrac variant
  ["\\tfrac{8}{3}", FRAC],         // tfrac variant
  ["\\frac {8} {3}", FRAC],        // spaced braces
  ["\\frac {8}{3}", FRAC],
  ["\\left(\\frac{8}{3}\\right)", FRAC],
  ["$\\frac{8}{3}$", FRAC],
  ["$8/3$", FRAC],                 // bare frac wrapped in $...$
  ["8/3 = 2 2/3", FRAC],           // improper + mixed number
  ["2 2/3", 'class="frac"'],       // mixed number -> whole + stacked 2/3
  ["simplified: 8/3 cups", FRAC],
  ["1) 8/3  2) 5/6", FRAC],
  // safety net: orphan digit pairs left by an unknown macro
  ["\\unknownmacro{8}{3}", FRAC],
  // money: $ is currency, never a math delimiter when no macro is inside
  ["Amy has $5. She finds $3 more.", null, "$5"],
  ["$5 + $3 = $8", null, "$5 + $3 = $8"],
  ["A book costs $12. You pay with $20.", null, "$12"],
  ["$\\frac{1}{2}$", 'class="frac"'], // real LaTeX in $...$ still unwraps
  // must NOT become a fraction
  ["https://example.com/8/3", null],
  ["10/3/2026", null],
  ["km/h and m/s", null],
  ["plain text answer", null],
];

let fail = 0;
for (const [input, want, mustContain] of cases) {
  for (const [label, fn] of [["browser", browserImpl], ["node", nodeImpl]]) {
    const out = fn(input);
    const ok = want ? out.includes(want) : !out.includes("class=\"frac\"");
    if (!ok || (mustContain && !out.includes(mustContain))) {
      fail++;
      console.log("FAIL", label, JSON.stringify(input), "=>", JSON.stringify(out.slice(0, 120)));
    }
  }
}
console.log(fail === 0 ? "ALL PASS (" + cases.length + " cases x 2 impls)" : fail + " FAILURES");
process.exit(fail === 0 ? 0 : 1);
