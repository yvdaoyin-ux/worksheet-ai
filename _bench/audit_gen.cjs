// Content audit: generate 7 non-math subjects x 3 grades, dump plain text for human review.
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const { hydrate } = require(path.join(root, "scripts", "visuals.js"));
const BASE = "http://127.0.0.1:3000";
const OUT = path.join(root, "_audit");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MATRIX = [
  ["Reading", "K", "a trip to the farm"],
  ["Reading", "2", "the lost puppy"],
  ["Reading", "4", "why leaves change color"],
  ["Spelling", "K", "short vowel words"],
  ["Spelling", "2", "words with silent e"],
  ["Spelling", "4", "homophones"],
  ["Vocabulary", "2", "animal words"],
  ["Vocabulary", "3", "prefixes and suffixes"],
  ["Vocabulary", "5", "science vocabulary weather"],
  ["Grammar", "1", "capital letters and ending punctuation"],
  ["Grammar", "3", "past and present verb tense"],
  ["Grammar", "5", "commas and conjunctions"],
  ["Writing", "K", "narrative my favorite day"],
  ["Writing", "2", "opinion the best pet"],
  ["Writing", "5", "informative how to paragraph"],
  ["Science", "2", "states of matter"],
  ["Science", "3", "life cycles of animals"],
  ["Science", "5", "ecosystems and food webs"],
  ["Social Studies", "K", "community helpers"],
  ["Social Studies", "2", "people who made a difference"],
  ["Social Studies", "4", "the regions of the united states"],
];

async function gen(b) {
  for (let a = 0; a < 2; a++) {
    try {
      const r = await fetch(BASE + "/api/generate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(b),
      });
      const d = await r.json();
      if (d.html && d.html.length > 300) return d;
      console.log("  retry:", b.subject, d.error || "");
    } catch (e) { console.log("  retry:", b.subject, e.message); }
    await sleep(2000);
  }
  return null;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  for (const [subject, grade, topic] of MATRIX) {
    const d = await gen({ grade, subject, topic, count: 8 });
    const name = subject.replace(/\s/g, "") + "_g" + grade;
    if (!d) { console.log("FAIL", name); continue; }
    fs.writeFileSync(path.join(OUT, name + ".html"), d.html);
    const rendered = hydrate(d.html);
    const text = rendered
      .replace(/<hr[^>]*ws-pagebreak[^>]*>/gi, "\n\n========== ANSWER PAGE ==========\n\n")
      .replace(/<[^>]+>/g, "\n")
      .replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/&ldquo;/g, '"').replace(/&rdquo;/g, '"').replace(/&rsquo;/g, "'").replace(/&mdash;/g, "-").replace(/&hellip;/g, "...")
      .split("\n").map((s) => s.trim()).filter(Boolean).join("\n");
    fs.writeFileSync(path.join(OUT, name + ".txt"), text);
    console.log("OK", name, "| checked:", d.checked, "|", d.html.length, "bytes");
    await sleep(1200);
  }
  console.log("AUDIT GENERATION DONE");
})().catch((e) => { console.error("FAILED:", e); process.exit(1); });
