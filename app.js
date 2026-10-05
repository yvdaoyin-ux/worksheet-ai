// WorksheetAI — shared client logic (used by index.html and all generated pages)
// Optional prefill: put data-grade / data-subject / data-topic on the <form id="genForm">.
(function () {
  const GUMROAD_URL = "https://219809065360.gumroad.com/l/orqxtr?code=LAUNCH30";
  // ---- plan rules (agreed with the owner; the free allowance and prices are promises) ----
  // Free   : 2 Math/day + 1 other-subject worksheet/day
  // Basic  : one-time $6.93 -> unlimited MATH + 3 other-subject worksheets/day
  // Pro    : monthly subscription -> ALL subjects unlimited + every new feature we ship
  const FREE_MATH_DAILY = 2; // promised — do not lower
  const FREE_OTHER_DAILY = 1;
  const BASIC_OTHER_DAILY = 3;
  const PRO_MONTHLY_URL = "https://219809065360.gumroad.com/l/scrywy"; // Pro monthly (Gumroad product "scrywy"); "" hides the button
  // Gumroad replaces __license_key__ per customer inside links/buttons on the product
  // content page. Point one at: https://worksheet-ai-l1td.vercel.app/?license_key=__license_key__
  const PRO_MONTHLY_LABEL = "$4.99/month"; // keep in sync with Gumroad
  const PLAN_KEY = "wsai_plan"; // "basic" | "pro"
  const LEGACY_KEY = "wsai_unlocked"; // old unlock flag -> treated as Basic
  const PREF_KEY = "wsai_pref";
  const SUB_KEY = "wsai_subbed";

  const $ = (id) => document.getElementById(id);
  if (!$("genForm")) return; // nothing to do on pages without the tool

  const today = () => new Date().toISOString().slice(0, 10);
  const countKey = () => "wsai_count_" + today();

  // plan: "free" | "basic" | "pro" (old single-flag installs are migrated to "basic")
  function plan() {
    let p = localStorage.getItem(PLAN_KEY);
    if (p !== "basic" && p !== "pro") {
      if (localStorage.getItem(LEGACY_KEY) === "1") {
        p = "basic";
        try { localStorage.setItem(PLAN_KEY, p); } catch (e) { /* ignore */ }
      } else {
        p = "free";
      }
    }
    return p;
  }
  const isUnlocked = () => plan() !== "free";
  const getCount = () => parseInt(localStorage.getItem(countKey()) || "0", 10);
  const setCount = (n) => localStorage.setItem(countKey(), String(n));
  const otherKey = () => "wsai_count_other_" + today();
  const getCountOther = () => parseInt(localStorage.getItem(otherKey()) || "0", 10);
  const setCountOther = (n) => localStorage.setItem(otherKey(), String(n));

  const isMath = () => ($("subject") ? $("subject").value : "Math") === "Math";

  // Infinity = unlimited for this subject on the current plan
  function dailyLimit(math) {
    const p = plan();
    if (p === "pro") return Infinity;
    if (math) return p === "basic" ? Infinity : FREE_MATH_DAILY;
    return p === "basic" ? BASIC_OTHER_DAILY : FREE_OTHER_DAILY;
  }
  function usedCount(math) {
    return math ? getCount() : getCountOther();
  }
  function freeLeft() {
    const lim = dailyLimit(isMath());
    return lim === Infinity ? Infinity : Math.max(0, lim - usedCount(isMath()));
  }
  function canGenerate() {
    const lim = dailyLimit(isMath());
    return lim === Infinity ? true : usedCount(isMath()) < lim;
  }

  // ---------------- analytics (no vendor needed; logs to /api/track) ----------------
  function track(event, props) {
    try {
      const body = JSON.stringify({
        event: event,
        props: props || {},
        path: location.pathname,
        ref: document.referrer || "",
      });
      if (navigator.sendBeacon) {
        navigator.sendBeacon("/api/track", new Blob([body], { type: "application/json" }));
      } else {
        fetch("/api/track", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: body,
          keepalive: true,
        }).catch(function () {});
      }
    } catch (e) { /* analytics must never break the product */ }
  }

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
        font: $("font") ? $("font").value : "andika",
        size: $("size") ? $("size").value : "m",
        style: $("style") ? $("style").value : "mixed",
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

  function syncMathStyle() {
    const f = $("styleField");
    if (!f) return;
    f.style.display = ($("subject") && $("subject").value === "Math") ? "" : "none";
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
      '<div class="field"><label for="font">Font</label>' +
      '<select id="font"><option value="andika" selected>Andika</option><option value="comic">Comic Neue</option><option value="lexend">Lexend</option><option value="nunito">Nunito</option></select></div>' +
      '<div class="field"><label for="size">Text size</label>' +
      '<select id="size"><option value="s">Small</option><option value="m" selected>Normal</option><option value="l">Large</option><option value="xl">Extra large</option></select></div>' +
      '<div class="field" id="styleField"><label for="style">Math style</label>' +
      '<select id="style"><option value="mixed" selected>Mixed</option><option value="computation">Computation</option><option value="word">Word problems</option></select></div>';
    $("genForm").insertBefore(opts, $("genBtn"));

    if ($("subject")) $("subject").addEventListener("change", function () { renderChips(); syncMathStyle(); updateQuota(); });
    renderChips();
    syncMathStyle();

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
  function verticalMathHTML(o) {
    const clean = (s) => String(s == null ? "" : s).replace(/[&<>]/g, "");
    const a = clean(o.a).trim();
    const b = clean(o.b).trim();
    const op = clean(o.op).trim() || "+";
    if (!a) return "";
    const w = Math.max(a.length, b.length);
    const line1 = "  " + a.padStart(w, " ");
    const line2 = op + " " + b.padStart(w, " ");
    const rule = "  " + "-".repeat(w) + "-";
    return '<div class="viz viz-vertical"><pre>' + line1 + "\n" + line2 + "\n" + rule + "</pre></div>";
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

  function ensureOrganizer(box) {
    const subject = $("subject") ? $("subject").value : "";
    const s = subject.toLowerCase();
    const needs = s.indexOf("read") >= 0 || s.indexOf("science") >= 0 || s.indexOf("social") >= 0;
    if (!needs || !box.querySelector || box.querySelector(".viz-organizer")) return;
    const ol = box.querySelector(".ws-questions");
    if (!ol) return;
    const kind = s.indexOf("science") >= 0 || s.indexOf("social") >= 0 ? "kwl" : "main-idea";
    const div = document.createElement("div");
    div.className = "ws-visual";
    div.innerHTML = organizerHTML(kind);
    ol.parentNode.insertBefore(div, ol.nextSibling);
  }

  function buildVisual(type, params, kind) {
    const t = String(type || "").toLowerCase();
    if (t.indexOf("organizer") >= 0 || t.indexOf("graphic") >= 0) return organizerHTML(kind);
    if (t.indexOf("vertical") >= 0 || t.indexOf("column") >= 0) return verticalMathHTML(params);
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
        a: el.getAttribute("data-a"), b: el.getAttribute("data-b"), op: el.getAttribute("data-op"),
      }, el.getAttribute("data-kind"));
      if (html) el.innerHTML = html; else el.remove();
    }
  }

  // ================= UI =================
  function updateQuota() {
    const q = $("quota");
    if (!q) return;
    const p = plan();
    const subj = $("subject") ? $("subject").value : "";

    if (p === "pro") {
      q.textContent = "Pro: unlimited worksheets, all subjects \u2714";
      return;
    }
    if (p === "basic") {
      if (isMath()) {
        q.textContent = "Basic plan: unlimited Math \u2714";
      } else {
        const left = Math.max(0, BASIC_OTHER_DAILY - getCountOther());
        q.textContent = left > 0
          ? "Basic plan: " + left + " of " + BASIC_OTHER_DAILY + " other-subject worksheets left today \u2014 Math is unlimited"
          : "That's today's " + BASIC_OTHER_DAILY + " " + subj + " worksheets \u2014 Math is still unlimited, or go Pro for all subjects.";
      }
      return;
    }
    if (isMath()) {
      q.textContent = "Free plan: " + Math.max(0, FREE_MATH_DAILY - getCount()) +
        " of " + FREE_MATH_DAILY + " math worksheets left today";
    } else {
      const left = Math.max(0, FREE_OTHER_DAILY - getCountOther());
      q.textContent = left > 0
        ? "Free plan: " + left + " of " + FREE_OTHER_DAILY + " " + subj +
          " worksheet" + (FREE_OTHER_DAILY > 1 ? "s" : "") + " left today \u2014 Math is free (2/day)"
        : "That was today's " + subj + " worksheet \u2014 Math is still free (2/day), or upgrade for more.";
    }
  }
  function openPaywall(reason) {
    track("paywall_open", { reason: reason || "unknown" });
    $("paywall").hidden = false;
  }
  function closePaywall() { $("paywall").hidden = true; }

  function makeTools(li) {
    if (li.querySelector(".li-tools")) return;
    const t = document.createElement("span");
    t.className = "li-tools no-print";
    t.setAttribute("contenteditable", "false");
    const edit = document.createElement("button");
    edit.type = "button"; edit.title = "Edit this question"; edit.textContent = "\u270F\uFE0F";
    edit.addEventListener("click", () => { li.contentEditable = "true"; li.focus(); });
    li.addEventListener("blur", () => { li.contentEditable = "false"; });
    const re = document.createElement("button");
    re.type = "button";
    re.title = "Rewrite this question (free — does not use your daily worksheets)";
    re.textContent = "\u{1F504}";
    re.addEventListener("click", () => rewriteItem(li, re));
    t.appendChild(edit); t.appendChild(re);
    li.appendChild(t);
  }

  function attachItemTools(box) {
    box.querySelectorAll(".ws-questions > li").forEach(makeTools);
  }

  function refreshItemTools() {
    const box = $("result");
    if (!box) return;
    box.querySelectorAll(".li-tools").forEach((n) => n.remove());
    attachItemTools(box);
  }

  // ---------------- email capture (the only durable asset a visitor leaves behind) ----------------
  function buildSubscribeBox() {
    if (document.getElementById("subBox")) return;
    const box = document.createElement("div");
    box.id = "subBox";
    box.className = "sub-box no-print";
    box.hidden = true;
    box.innerHTML =
      '<p class="sub-title">\u{1F4E9} Want a fresh worksheet pack every week?</p>' +
      '<p class="sub-sub">Five printables with answer keys in one email. No spam, unsubscribe anytime.</p>' +
      '<form id="subForm" class="sub-form">' +
      '<input id="subEmail" type="email" placeholder="you@email.com" autocomplete="email" required />' +
      '<button type="submit" id="subBtn">Send me packs</button>' +
      '</form>' +
      '<p id="subMsg" class="msg"></p>';
    const rw = $("resultWrap");
    if (rw && rw.parentNode) rw.parentNode.insertBefore(box, rw.nextSibling);
    wireSubForm("subForm", "subEmail", "subBtn", "subMsg");
  }

  function maybeShowSubscribe() {
    const box = $("subBox");
    if (!box) return;
    box.hidden = localStorage.getItem(SUB_KEY) === "1";
  }

  function wireSubForm(formId, inputId, btnId, msgId) {
    const form = $(formId);
    if (!form) return;
    form.addEventListener("submit", (e) => submitSubscribe(e, inputId, btnId, msgId));
  }

  async function submitSubscribe(e, inputId, btnId, msgId) {
    e.preventDefault();
    const email = ($(inputId).value || "").trim();
    const msg = $(msgId);
    const btn = $(btnId);
    if (!email) { msg.textContent = "Please enter your email."; return; }
    btn.disabled = true; btn.textContent = "\u2026";
    msg.className = "msg"; msg.textContent = "";
    try {
      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email, source: location.pathname }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error((data && data.error) || "Could not sign you up.");
      localStorage.setItem(SUB_KEY, "1");
      msg.className = "msg ok";
      msg.textContent = "\u2714 You're on the list \u2014 check your inbox soon.";
      track("subscribe_ok", {});
      setTimeout(() => {
        if ($("subBox")) $("subBox").hidden = true;
        if (msgId !== "subMsg" && msg.parentNode) msg.parentNode.hidden = true;
      }, 2500);
    } catch (err) {
      msg.className = "msg";
      msg.textContent = "\u2716 " + err.message;
      track("subscribe_err", {});
    } finally {
      btn.disabled = false; btn.textContent = "Send me packs";
    }
  }

  async function rewriteItem(li, btn) {
    // Rewriting a single question does NOT consume the free daily quota.
    const clone = li.cloneNode(true);
    const toolsInClone = clone.querySelector(".li-tools");
    if (toolsInClone) toolsInClone.remove();
    const item = clone.innerHTML.trim();
    const subject = $("subject") ? $("subject").value : "";
    const topic = ($("topic") && $("topic").value.trim()) || "worksheet";
    const old = btn.textContent;
    btn.disabled = true; btn.textContent = "\u2026";
    try {
      const res = await fetch("/api/generate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "rewrite", grade: $("grade").value, subject, topic, item }),
      });
      const data = await res.json();
      if (!res.ok || !data.html) throw new Error(data.error || "failed");
      li.innerHTML = data.html;
      makeTools(li);
      renderMath(li);
      hydrateVisuals(li);
    } catch (e) {
      alert("Could not rewrite: " + e.message);
    } finally {
      btn.disabled = false; btn.textContent = old;
    }
  }

  function paintWorksheet(html) {
    const box = $("result");
    box.innerHTML = html || "<p>No content was returned.</p>";
    renderMath(box);
    hydrateVisuals(box);
    ensureOrganizer(box);
    attachItemTools(box);
    if ($("font")) { box.classList.remove("font-andika", "font-comic", "font-lexend", "font-nunito"); box.classList.add("font-" + $("font").value); }
    if ($("size")) { box.classList.remove("size-s", "size-m", "size-l", "size-xl"); box.classList.add("size-" + $("size").value); }
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
    if (!canGenerate()) { openPaywall(isMath() ? "quota" : "subject_gate"); return; }
    track("generate_start", { subject: $("subject").value, grade: $("grade").value, plan: plan() });
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
          style: $("style") ? $("style").value : "mixed",
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Request failed");
      renderResult(data.html, data.demo);
      try { saveHist({ topic: topic, subject: $("subject").value, grade: $("grade").value, html: data.html }); } catch (e) { /* ignore */ }
      renderHist();
      if (plan() !== "pro") {
        if (isMath()) {
          if (plan() === "free") setCount(getCount() + 1); // Basic: Math is unlimited
        } else {
          setCountOther(getCountOther() + 1);
        }
      }
      updateQuota();
      maybeShowSubscribe();
      track("generate_ok", { subject: $("subject").value, demo: !!data.demo });
    } catch (err) {
      track("generate_err", { message: String(err.message || err).slice(0, 120) });
      alert("Something went wrong: " + err.message + "\nFree models can be busy — please try again in a few seconds.");
    } finally {
      btn.disabled = false;
      btn.textContent = "Generate worksheet";
    }
  }

  $("genForm").addEventListener("submit", (e) => { e.preventDefault(); runGenerate(); });
  $("printBtn").addEventListener("click", () => window.print());
  if ($("upsellBtn")) $("upsellBtn").addEventListener("click", openPaywall);

  async function doActivate(key) {
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
        const pl = data.plan === "pro" ? "pro" : "basic";
        localStorage.setItem(PLAN_KEY, pl);
        try {
          localStorage.setItem(LEGACY_KEY, "1");
          localStorage.setItem("wsai_key", key);
          localStorage.setItem("wsai_checked", today());
        } catch (e) { /* ignore */ }
        msg.textContent = pl === "pro"
          ? "\u2714 Pro activated \u2014 all subjects, unlimited."
          : "\u2714 Basic activated \u2014 unlimited Math, 3 other-subject worksheets a day.";
        updateQuota();
        const box = $("result");
        const wm = box && box.querySelector(".watermark");
        if (wm) wm.remove();
        $("upsellBar").hidden = true;
        refreshItemTools();
        track("activate_ok", {});
        setTimeout(closePaywall, 900);
      } else {
        msg.textContent = "\u2716 " + (data.error || "That key is not valid.");
        track("activate_fail", {});
      }
    } catch (err) {
      msg.textContent = "\u2716 Error: " + err.message;
    }
  }

  $("activateBtn").addEventListener("click", () => doActivate($("licenseInput").value.trim()));

  // Gumroad can send buyers back with the key in the URL — activate it for them
  // instead of making them copy/paste (fewer "I paid and it doesn't work" emails).
  // Re-check a stored key once a day, so a cancelled Pro subscription falls back
  // to the free plan instead of staying unlocked forever in this browser.
  function silentRecheck() {
    let key = "";
    try { key = localStorage.getItem("wsai_key") || ""; } catch (e) { return; }
    if (!key) return;
    if (localStorage.getItem("wsai_checked") === today()) return;
    fetch("/api/verify-license", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ license_key: key }),
    })
      .then((r) => r.json())
      .then((data) => {
        localStorage.setItem("wsai_checked", today());
        if (data && data.valid) {
          localStorage.setItem(PLAN_KEY, data.plan === "pro" ? "pro" : "basic");
        } else {
          localStorage.removeItem(PLAN_KEY);
          localStorage.removeItem(LEGACY_KEY);
          localStorage.removeItem("wsai_key");
        }
        updateQuota();
        track("license_recheck", { ok: !!(data && data.valid) });
      })
      .catch(() => { /* offline: keep the current plan until tomorrow */ });
  }

  function autoActivateFromUrl() {
    try {
      const p = new URLSearchParams(location.search);
      const key = p.get("license_key") || p.get("key") || p.get("lk");
      if (!key) return;
      const clean = key.trim();
      // Drop the key from the address bar so it is not shared or bookmarked.
      try { history.replaceState({}, "", location.pathname + location.hash); } catch (e) { /* ignore */ }
      if (isUnlocked()) return;
      $("licenseInput").value = clean;
      $("paywall").hidden = false; // show the modal so the buyer sees it happening
      doActivate(clean);
    } catch (e) { /* ignore */ }
  }

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
  if (pref.font && $("font")) $("font").value = pref.font;
  if (pref.size && $("size")) $("size").value = pref.size;
  if (pref.style && $("style")) $("style").value = pref.style;
  syncMathStyle();

  $("gumroadBtn").href = GUMROAD_URL;
  $("gumroadBtn").addEventListener("click", () => track("buy_click", { from: "paywall", plan: "lifetime" }));

  const monthlyBtn = $("gumroadMonthlyBtn");
  if (monthlyBtn) {
    if (PRO_MONTHLY_URL) {
      monthlyBtn.href = PRO_MONTHLY_URL;
      monthlyBtn.textContent = "Go Pro monthly — " + PRO_MONTHLY_LABEL;
      monthlyBtn.addEventListener("click", () => track("buy_click", { from: "paywall", plan: "monthly" }));
    } else {
      monthlyBtn.hidden = true;
    }
  }
  if ($("upsellBtn")) $("upsellBtn").addEventListener("click", () => track("buy_click", { from: "upsell_bar" }));

  buildSubscribeBox();
  wireSubForm("homeSubForm", "homeSubEmail", "homeSubBtn", "homeSubMsg");
  if (localStorage.getItem(SUB_KEY) === "1") {
    const hb = $("homeSubBox");
    if (hb) hb.hidden = true;
  }
  updateQuota();

  track("page_view", { plan: plan() });
  autoActivateFromUrl();
  silentRecheck();
})();
