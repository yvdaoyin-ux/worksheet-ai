// One-off product sweep: real generation across subjects + edge cases + landing integrity.
const path = require("path");
const fs = require("fs");
const { spawnSync } = require("child_process");
const root = path.join(__dirname, "..");
const { hydrate } = require(path.join(root, "scripts", "visuals.js"));
const BASE = "http://127.0.0.1:3000";
const OUT = path.join(root, "_sweep");

async function gen(body) {
  const r = await fetch(BASE + "/api/generate", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let data = {};
  try { data = await r.json(); } catch (e) { data = { error: "non-json response" }; }
  return { status: r.status, data };
}

function scanRendered(html) {
  const rendered = hydrate(html); // mirrors app.js: visuals + math on text nodes only
  const texts = rendered.split(/(<[^>]*>)/).filter((s) => s.charAt(0) !== "<");
  const joined = texts.join("\n");
  const issues = [];
  const hf = joined.match(/.{12}\d\s*\/\s*\d.{8}/g);
  if (hf) issues.push("HORIZONTAL-FRACTION: " + hf.slice(0, 2).join(" | ").replace(/\s+/g, " "));
  if (/\{\d+\}\s*\{\d+\}/.test(joined)) issues.push("ORPHAN-BRACES: " + (joined.match(/.{10}\{\d+\}\s*\{\d+\}.{5}/g) || [""])[0].replace(/\s+/g, " "));
  const cmds = joined.match(/\\[a-zA-Z]+/g);
  if (cmds) issues.push("LEFTOVER-LATEX: " + [...new Set(cmds)].slice(0, 6).join(","));
  if (/\\[\(\)\[\]]/.test(joined)) issues.push("LEFTOVER-MATH-DELIM");
  if (/\$[^$\n]{1,50}\$/.test(joined)) issues.push("DOLLAR-WRAPPED: " + (joined.match(/\$[^$\n]{1,50}\$/g) || []).slice(0, 2).join("|"));
  const empt = (rendered.match(/<div[^>]*class="[^"]*ws-visual[^"]*"[^>]*>\s*<\/div>/gi) || []).length;
  if (empt) issues.push("UNRENDERED-VISUALS: " + empt);
  if (/<script|onerror\s*=/i.test(rendered)) issues.push("!! INJECTION-LOOKALIKE");
  const lis = [...rendered.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((m) => m[1].replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim());
  const empty = lis.filter((t) => t.length < 3).length;
  if (empty) issues.push("NEAR-EMPTY-ITEMS: " + empty);
  const weird = joined.match(/[\uFFFD]|&amp;[a-z]+;/g);
  if (weird) issues.push("ENCODING/DOUBLE-ESCAPE: " + [...new Set(weird)].slice(0, 4).join(","));
  return { issues, rendered, items: lis };
}

function structure(html) {
  const olQ = (html.match(/<ol[^>]*class="ws-questions"[\s\S]*?<\/ol>/i) || [""])[0];
  const olA = (html.match(/<ol[^>]*class="ws-answers"[\s\S]*?<\/ol>/i) || [""])[0];
  return {
    nq: (olQ.match(/<li/gi) || []).length,
    na: (olA.match(/<li/gi) || []).length,
    pagebreak: /ws-pagebreak/.test(html),
    title: ((html.match(/class="ws-title"[^>]*>([\s\S]*?)</i) || [])[1] || "").replace(/\s+/g, " ").trim().slice(0, 70),
    passage: /ws-passage/.test(html),
    wordlist: /word list|word bank|ws-words/i.test(html),
  };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const report = { subjects: [], edges: [] };

  // ---------- Part A: 8 subjects, real generation ----------
  const subjects = [
    ["Math", "3", "multiplication and division word problems"],
    ["Reading", "3", "main idea and details"],
    ["Spelling", "2", "short vowel words"],
    ["Vocabulary", "4", "prefixes and suffixes"],
    ["Grammar", "3", "nouns and verbs"],
    ["Writing", "3", "opinion writing prompts"],
    ["Science", "4", "the water cycle"],
    ["Social Studies", "2", "maps and communities"],
  ];
  for (const [subject, grade, topic] of subjects) {
    const t0 = Date.now();
    const { status, data } = await gen({ grade, subject, topic, count: 8 });
    const html = data.html || "";
    const st = structure(html);
    const sc = scanRendered(html);
    fs.writeFileSync(path.join(OUT, "A_" + subject.replace(/\s/g, "") + ".html"), html);
    const structIssues = [];
    if (status !== 200 || data.error) structIssues.push("HTTP " + status + " " + (data.error || ""));
    else {
      if (st.nq !== 8) structIssues.push("questions=" + st.nq + " (want 8)");
      if (st.na !== st.nq) structIssues.push("answers=" + st.na + " != questions=" + st.nq);
      if (!st.pagebreak) structIssues.push("no-pagebreak");
      if (subject === "Reading" && !st.passage) structIssues.push("no-passage");
      if ((subject === "Spelling" || subject === "Vocabulary") && !st.wordlist) structIssues.push("no-wordlist");
      if (!data.checked) structIssues.push("answer-check-off");
    }
    report.subjects.push({ subject, grade, ms: Date.now() - t0, title: st.title, struct: structIssues, render: sc.issues });
    console.log("A", subject, "|", st.title || ("ERR " + (data.error || status)), "| struct:", structIssues.length ? structIssues.join("; ") : "ok", "| render:", sc.issues.length ? sc.issues.join(" ;; ") : "ok");
  }

  // ---------- Part B: edge / security cases ----------
  const edges = [
    ["xss-topic", { grade: "3", subject: "Math", topic: '<img src=x onerror=alert(1)>', count: 5 }, (html) => /onerror|<img/i.test(hydrate(html)) ? "INJECTION-PASSTHROUGH" : ""],
    ["xss-name", { grade: "3", subject: "Math", topic: "fractions", count: 5, student: "R<D>x & 'John" }, (html) => /<D>|&lt;D&gt;/.test(html) ? "NAME-NOT-SANITIZED" : ""],
    ["empty-topic", { grade: "3", subject: "Math", topic: "", count: 5 }, null],
    ["grade-6", { grade: "6", subject: "Math", topic: "fractions", count: 5 }, null],
    ["grade-K", { grade: "K", subject: "Math", topic: "counting to 10", count: 5 }, null],
    ["count-30", { grade: "3", subject: "Math", topic: "two digit addition", count: 30 }, null],
    ["count-1", { grade: "3", subject: "Math", topic: "two digit addition", count: 1 }, null],
    ["level-easier-style-word", { grade: "3", subject: "Math", topic: "money word problems", count: 5, level: "easier", style: "word" }, null],
    ["missing-fields", { subject: "Math" }, null],
  ];
  for (const [name, body, check] of edges) {
    const { status, data } = await gen(body);
    const html = data.html || "";
    let note = "";
    if (check) note = check(html);
    const sc = scanRendered(html);
    fs.writeFileSync(path.join(OUT, "B_" + name + ".html"), html);
    const st = structure(html);
    report.edges.push({ name, status, error: data.error || "", note, struct: st, render: sc.issues });
    console.log("B", name, "| HTTP", status, data.error ? ("err=" + data.error) : ("nq=" + st.nq + "/" + body.count), note ? ("| " + note) : "", sc.issues.length ? ("| render: " + sc.issues.join(" ;; ")) : "");
  }

  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
  console.log("DONE part A+B");
})().catch((e) => { console.error("SWEEP FAILED:", e); process.exit(1); });
