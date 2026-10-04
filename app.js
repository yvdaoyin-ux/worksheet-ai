// WorksheetAI — shared client logic (used by index.html and all generated pages)
// Optional prefill: put data-grade / data-subject / data-topic on the <form id="genForm">.
(function () {
  const GUMROAD_URL = "https://219809065360.gumroad.com/l/orqxtr";
  const FREE_LIMIT = 2; // free worksheets per day
  const PREF_KEY = "wsai_pref";

  const $ = (id) => document.getElementById(id);
  if (!$("genForm")) return; // nothing to do on pages without the tool

  const today = () => new Date().toISOString().slice(0, 10);
  const countKey = () => "wsai_count_" + today();
  const isUnlocked = () => localStorage.getItem("wsai_unlocked") === "1";
  const getCount = () => parseInt(localStorage.getItem(countKey()) || "0", 10);
  const setCount = (n) => localStorage.setItem(countKey(), String(n));

  // ---------------- recent worksheets (localStorage) ----------------
  const HIST_KEY = "wsai_hist";
  function loadHist() { try { return JSON.parse(localStorage.getItem(HIST_KEY) || "[]"); } catch (e) { return []; } }
  function saveHist(item) {
    try {
      const h = loadHist().filter((x) => !(x.topic === item.topic && x.subject === item.subject));
      h.unshift(item);
      localStorage.setItem(HIST_KEY, JSON.stringify(h.slice(0, 5)));
    } catch (e) { /* ignore */ }
  }
  function renderHist() {
    const box = $("recentBox");
    if (!box) return;
    const h = loadHist();
    if (!h.length) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = '<span class="recent-label">\u{1F550} Recent:</span>';
    h.forEach((it) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "chip";
      b.textContent = (it.subject ? it.subject + ": " : "") + it.topic;
      b.addEventListener("click", () => {
        paintWorksheet(it.html);
        $("resultWrap").scrollIntoView({ behavior: "smooth", block: "start" });
      });
      box.appendChild(b);
    });
  }

  // ---------------- saved preferences ----------------
  function readPref() {
    try { return JSON.parse(localStorage.getItem(PREF_KEY) || "{}"); } catch (e) { return {}; }
  }
  function savePref() {
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify({
        grade: $("grade") ? $("grade").value : "",
        subject: $("subject") ? $("subject").value : "",
        count: $("count") ? $("count").value : "10",
        level: $("level") ? $("level").value : "standard",
        size: $("size") ? $("size").value : "normal",
      }));
    } catch (e) { /* ignore */ }
  }

  // ---------------- topic suggestions (chips) + options ----------------
  const SUGGESTIONS = {
    Math: ["addition", "subtraction", "multiplication", "division", "fractions", "place value", "word problems", "money", "time", "shapes"],
    Reading: ["a short story", "main idea", "animals", "the water cycle", "a famous person", "ocean animals"],
    Spelling: ["short a words", "sight words", "digraphs sh/ch/th", "long vowel words", "r-controlled words", "CVC words"],
    Vocabulary: ["context clues", "synonyms and antonyms", "prefixes and suffixes", "science words", "feelings"],
    Grammar: ["capitalizing proper nouns", "ending punctuation", "plural nouns", "past tense verbs", "complete sentences"],
    Writing: ["my favorite animal", "a persuasive letter", "how to make a sandwich", "a story about a lost dog", "my summer vacation"],
    Science: ["the water cycle", "animal habitats", "weather", "the solar system", "forces and motion", "plants"],
    "Social Studies": ["community helpers", "U.S. symbols", "map skills", "a famous American", "then and now"],
  };

  function renderChips() {
    const box = $("topicChips");
    if (!box) return;
    const list = SUGGESTIONS[($("subject") && $("subject").value) || "Math"] || SUGGESTIONS.Math;
    box.innerHTML = "";
    list.forEach((t) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.textContent = t;
      b.addEventListener("click", () => { $("topic").value = t; $("topic").focus(); });
      box.appendChild(b);
    });
  }

  function buildExtras() {
    const topicField = $("topic").closest(".field") || $("topic").parentNode;
    const chips = document.createElement("div");
    chips.id = "topicChips";
    chips.className = "chips";
    topicField.appendChild(chips);

    const opts = document.createElement("div");
    opts.className = "options";
    opts.innerHTML =
      '<div class="field"><label for="count">Questions</label>' +
      '<select id="count"><option>5</option><option>8</option><option selected>10</option><option>12</option></select></div>' +
      '<div class="field"><label for="level">Level</label>' +
      '<select id="level"><option value="easier">Easier</option><option value="standard" selected>Standard</option><option value="challenge">Challenge</option></select></div>' +
      '<div class="field"><label for="size">Text size</label>' +
      '<select id="size"><option value="normal" selected>Normal</option><option value="large">Large</option></select></div>';
    $("genForm").insertBefore(opts, $("genBtn"));

    if ($("subject")) $("subject").addEventListener("change", renderChips);
    renderChips();

    const toolbar = document.querySelector("#resultWrap .toolbar");
    if (toolbar && !$("regenBtn")) {
      const rg = document.createElement("button");
      rg.type = "button";
      rg.id = "regenBtn";
      rg.hidden = true;
      rg.textContent = "\u{1F504} Another version";
      rg.addEventListener("click", runGenerate);
      toolbar.insertBefore(rg, toolbar.firstChild);
    }

    const recent = document.createElement("div");
    recent.id = "recentBox";
    recent.className = "recent no-print";
    recent.hidden = true;
    const rw = $("resultWrap");
    if (rw && rw.parentNode) rw.parentNode.insertBefore(recent, rw.nextSibling);
  }

  // ================= math rendering =================
  function fracSpan(a, b) {
    return '<span class="frac"><span class="num">' + a + '</span><span class="den">' + b + '</span></span>';
  }
  function gcd(a, b) { return b ? gcd(b, a % b) : a; }
  function fracLabel(num, den) {
    const g = gcd(num, den);
    const n = num / g, d = den / g;
    if (d === 1) return String(n);
    return fracSpan(n, d);
  }
  function renderMathString(t) {
    t = t.replace(/\\[\(\)\[\]]/g, "");
    t = t.replace(/\$([^$]+)\$/g, (m, inner) =>
      /[\\=+\u00d7\u00f7]/.test(inner) || /^[\s\d.,]+$/.test(inner) ? inner : m
    );
    t = t.replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, (m, a, b) => fracSpan(a, b));
    t = t.replace(/(\d+)\s+(\d+)\s*\/\s*(\d+)/g, (m, w, a, b) => w + " " + fracSpan(a, b));
    t = t.replace(/(^|[^\d/])(\d+)\s*\/\s*(\d+)(?![\d/])/g, (m, pre, a, b) => pre + fracSpan(a, b));
    t = t
      .replace(/\\times/g, "\u00d7").replace(/\\div/g, "\u00f7").replace(/\\cdot/g, "\u00b7")
      .replace(/\\le/g, "\u2264").replace(/\\ge/g, "\u2265");
    return t;
  }
  function renderMath(root) {
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    const texts = [];
    let n;
    while ((n = walker.nextNode())) texts.push(n);
    for (const node of texts) {
      const t = node.nodeValue;
      if (!/(\\frac|\\times|\\div|\\cdot|\\\(|\$|\d\s*\/\s*\d)/.test(t)) continue;
      const out = renderMathString(t);
      if (out !== t) {
        const span = document.createElement("span");
        span.innerHTML = out;
        node.parentNode.replaceChild(span, node);
      }
    }
  }

  // ================= code-drawn math visuals =================
  function numberLineHTML(o) {
    const ticks = o.ticks > 0 ? o.ticks : 1;
    let html = '<div class="viz viz-numline"><span class="nl-line"></span>';
    for (let i = 0; i <= ticks; i++) {
      const pct = (i / ticks) * 100;
      const val = o.min + ((o.max - o.min) * i) / ticks;
      let label;
      if (Number.isInteger(val)) label = String(val);
      else if (o.min === 0 && o.max === 1) label = fracLabel(i, ticks);
      else label = String(Math.round(val * 100) / 100);
      html += '<span class="nl-tick" style="left:' + pct + '%"></span>';
      html += '<span class="nl-label" style="left:' + pct + '%">' + label + "</span>";
    }
    (o.points || []).forEach((p) => {
      const parts = String(p).split(":");
      const v = parseFloat(parts[0]);
      if (isNaN(v) || o.max === o.min) return;
      const pct = ((v - o.min) / (o.max - o.min)) * 100;
      if (pct < -5 || pct > 105) return;
      html += '<span class="nl-point" style="left:' + pct + '%">' + (parts[1] ? "<em>" + parts[1] + "</em>" : "") + "</span>";
    });
    return html + "</div>";
  }
  function fractionBarHTML(o) {
    let segs = "";
    for (let i = 0; i < o.den; i++) segs += '<span class="bar-seg' + (i < o.num ? " filled" : "") + '"></span>';
    return '<div class="viz viz-bar"><div class="bar">' + segs + "</div></div>";
  }
  function fractionCircleHTML(o) {
    const size = 120, r = 52, cx = 60, cy = 60;
    let slices = "";
    for (let i = 0; i < o.den; i++) {
      const a0 = (i / o.den) * 2 * Math.PI - Math.PI / 2;
      const a1 = ((i + 1) / o.den) * 2 * Math.PI - Math.PI / 2;
      const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
      const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const d = "M " + cx + " " + cy + " L " + x0 + " " + y0 + " A " + r + " " + r + " 0 " + large + " 1 " + x1 + " " + y1 + " Z";
      slices += '<path d="' + d + '" class="pie-slice' + (i < o.num ? " filled" : "") + '"/>';
    }
    return '<div class="viz viz-circle"><svg viewBox="0 0 ' + size + " " + size + '" width="120" height="120">' + slices + "</svg></div>";
  }
  function tenFrameHTML(o) {
    const count = Math.max(0, o.count);
    const frames = count > 10 ? 2 : 1;
    let remaining = count, out = "";
    for (let f = 0; f < frames; f++) {
      let cells = "";
      for (let i = 0; i < 10; i++) cells += '<span class="tf-cell' + (i < remaining ? " filled" : "") + '"></span>';
      remaining -= 10;
      out += '<div class="tf-frame">' + cells + "</div>";
    }
    return '<div class="viz viz-tenframe">' + out + "</div>";
  }
  function arrayHTML(o) {
    let cells = "";
    for (let i = 0; i < o.rows * o.cols; i++) cells += '<span class="arr-dot"></span>';
    return '<div class="viz viz-array"><div class="arr" style="--cols:' + o.cols + '">' + cells + "</div></div>";
  }
  function placeValueHTML(o) {
    const digits = String(o.number).replace(/\D/g, "").padStart(3, "0").slice(-3).split("");
    const heads = ["Hundreds", "Tens", "Ones"].map((h) => "<th>" + h + "</th>").join("");
    const cells = digits.map((d) => "<td>" + d + "</td>").join("");
    return '<div class="viz viz-pv"><table><thead><tr>' + heads + "</tr></thead><tbody><tr>" + cells + "</tr></tbody></table></div>";
  }
  function organizerHTML(kind) {
    const k = String(kind || "").toLowerCase();
    let rows;
    if (k.indexOf("story") >= 0) rows = ["Characters", "Setting", "Problem", "Solution"];
    else if (k.indexOf("sequence") >= 0 || k.indexOf("first") >= 0) rows = ["First", "Next", "Then", "Last"];
    else if (k.indexOf("kwl") >= 0) rows = ["K \u2014 What I Know", "W \u2014 What I Want to Know", "L \u2014 What I Learned"];
    else if (k.indexOf("compare") >= 0 || k.indexOf("venn") >= 0) rows = ["Alike", "Different"];
    else rows = ["Main Idea", "Detail 1", "Detail 2", "Detail 3"];
    const boxes = rows.map((t) =>
      '<div class="org-box"><span class="org-title">' + t + '</span><span class="org-lines"></span></div>'
    ).join("");
    return '<div class="viz viz-organizer">' + boxes + "</div>";
  }

  function buildVisual(type, params, kind) {
    const t = String(type || "").toLowerCase();
    if (t.indexOf("organizer") >= 0 || t.indexOf("graphic") >= 0) return organizerHTML(kind);
    if (t.indexOf("line") >= 0) return numberLineHTML(params);
    if (t.indexOf("bar") >= 0) return fractionBarHTML(params);
    if (t.indexOf("circle") >= 0 || t.indexOf("pie") >= 0) return fractionCircleHTML(params);
    if (t.indexOf("ten") >= 0) return tenFrameHTML(params);
    if (t.indexOf("array") >= 0) return arrayHTML(params);
    if (t.indexOf("place") >= 0) return placeValueHTML(params);
    return "";
  }
  function hydrateVisuals(root) {
    if (!root) return;
    const els = root.querySelectorAll("[data-visual]");
    for (const el of els) {
      const a = (name, d) => { const v = parseFloat(el.getAttribute("data-" + name)); return isNaN(v) ? d : v; };
      const i = (name, d) => { const v = parseInt(el.getAttribute("data-" + name), 10); return isNaN(v) ? d : v; };
      const points = (el.getAttribute("data-points") || "").split(",").map((s) => s.trim()).filter(Boolean);
      const html = buildVisual(el.getAttribute("data-visual"), {
        min: a("min", 0), max: a("max", 1), ticks: i("ticks", 4), points,
        num: i("num", 1), den: i("den", 4), count: i("count", 5),
        rows: i("rows", 3), cols: i("cols", 4), number: i("number", 345),
      }, el.getAttribute("data-kind"));
      if (html) el.innerHTML = html; else el.remove();
    }
  }

  // ================= UI =================
  function updateQuota() {
    const q = $("quota");
    if (!q) return;
    if (isUnlocked()) { q.textContent = "Pro: unlimited worksheets \u2714"; return; }
    const left = Math.max(0, FREE_LIMIT - getCount());
    q.textContent = "Free plan: " + left + " of " + FREE_LIMIT + " worksheets left today";
  }
  function openPaywall() { $("paywall").hidden = false; }
  function closePaywall() { $("paywall").hidden = true; }

  function paintWorksheet(html) {
    const box = $("result");
    box.innerHTML = html || "<p>No content was returned.</p>";
    renderMath(box);
    hydrateVisuals(box);
    if ($("size")) box.classList.toggle("text-large", $("size").value === "large");
    let wm = box.querySelector(".watermark");
    if (!isUnlocked()) {
      if (!wm) { wm = document.createElement("p"); wm.className = "watermark"; box.appendChild(wm); }
      wm.textContent = "Made with WorksheetAI — upgrade to remove";
    } else if (wm) {
      wm.remove();
    }
    if ($("regenBtn")) $("regenBtn").hidden = false;
    $("upsellBar").hidden = isUnlocked();
    $("resultWrap").hidden = false;
  }

  function renderResult(html, demo) {
    paintWorksheet(html);
    const note = $("note");
    if (demo) note.textContent = "Demo mode (no API key set on server)";
    else note.textContent = isUnlocked() ? "Pro — watermark removed" : "Free preview";
    $("resultWrap").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function runGenerate() {
    const topic = $("topic").value.trim();
    if (!topic) { alert("Please enter a topic (or tap a suggestion)."); return; }
    if (!isUnlocked() && getCount() >= FREE_LIMIT) { openPaywall(); return; }
    savePref();

    const btn = $("genBtn");
    btn.disabled = true;
    btn.textContent = "Generating…";
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grade: $("grade").value,
          subject: $("subject").value,
          topic,
          count: $("count") ? parseInt($("count").value, 10) : 10,
          level: $("level") ? $("level").value : "standard",
          size: $("size") ? $("size").value : "normal",
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Request failed");
      renderResult(data.html, data.demo);
      try { saveHist({ topic: topic, subject: $("subject").value, grade: $("grade").value, html: data.html }); } catch (e) { /* ignore */ }
      renderHist();
      if (!isUnlocked()) setCount(getCount() + 1);
      updateQuota();
    } catch (err) {
      alert("Something went wrong: " + err.message + "\nFree models can be busy — please try again in a few seconds.");
    } finally {
      btn.disabled = false;
      btn.textContent = "Generate worksheet";
    }
  }

  $("genForm").addEventListener("submit", (e) => { e.preventDefault(); runGenerate(); });
  $("printBtn").addEventListener("click", () => window.print());
  if ($("upsellBtn")) $("upsellBtn").addEventListener("click", openPaywall);

  $("activateBtn").addEventListener("click", async () => {
    const key = $("licenseInput").value.trim();
    const msg = $("activateMsg");
    if (!key) { msg.textContent = "Please enter your license key."; return; }
    msg.textContent = "Checking…";
    try {
      const res = await fetch("/api/verify-license", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ license_key: key }),
      });
      const data = await res.json();
      if (data.valid) {
        localStorage.setItem("wsai_unlocked", "1");
        msg.textContent = "\u2714 Unlocked! Enjoy unlimited worksheets.";
        updateQuota();
        const box = $("result");
        const wm = box && box.querySelector(".watermark");
        if (wm) wm.remove();
        $("upsellBar").hidden = true;
        setTimeout(closePaywall, 900);
      } else {
        msg.textContent = "\u2716 " + (data.error || "That key is not valid.");
      }
    } catch (err) {
      msg.textContent = "\u2716 Error: " + err.message;
    }
  });

  $("closeModal").addEventListener("click", closePaywall);
  $("paywall").addEventListener("click", (e) => { if (e.target === $("paywall")) closePaywall(); });

  // ---------------- init ----------------
  const pref = readPref();
  if (pref.grade && $("grade")) $("grade").value = pref.grade;
  if (pref.subject && $("subject")) $("subject").value = pref.subject;

  const form = $("genForm");
  if (form.dataset.grade) $("grade").value = form.dataset.grade;
  if (form.dataset.subject) $("subject").value = form.dataset.subject;
  if (form.dataset.topic) $("topic").value = form.dataset.topic;

  buildExtras();
  renderHist();
  if (pref.count && $("count")) $("count").value = pref.count;
  if (pref.level && $("level")) $("level").value = pref.level;
  if (pref.size && $("size")) $("size").value = pref.size;

  $("gumroadBtn").href = GUMROAD_URL;
  updateQuota();
})();
