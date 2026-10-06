// WorksheetAI — shared client logic (used by index.html and all generated pages)
// Optional prefill: put data-grade / data-subject / data-topic on the <form id="genForm">.
(function () {
  const GUMROAD_URL = "https://219809065360.gumroad.com/l/orqxtr?code=LAUNCH30";
  // ---- plan rules (agreed with the owner; the free allowance and prices are promises) ----
  // Free   : 2 Math/day + 1 other-subject worksheet/day
  // Basic  : one-time $13.30 -> unlimited MATH + 3 other-subject worksheets/day
  // Pro    : monthly subscription -> ALL subjects unlimited + every new feature we ship
  const FREE_MATH_DAILY = 2; // promised — do not lower
  const FREE_OTHER_DAILY = 1;
  const BASIC_OTHER_DAILY = 3;
  const PRO_MONTHLY_URL = "https://219809065360.gumroad.com/l/scrywy"; // Pro monthly (Gumroad product "scrywy"); "" hides the button
  // Gumroad replaces __license_key__ per customer inside links/buttons on the product
  // content page. Point one at: https://worksheet-ai-l1td.vercel.app/?license_key=__license_key__
  const PRO_MONTHLY_LABEL = "$4.99/month"; // keep in sync with Gumroad
  // Classroom license: one-time, everything in Pro for ONE teacher's class.
  // Paste the Gumroad permalink here after creating the product; "" hides the block.
  // verify-license.js must know the product id too (GUMROAD_CLASSROOM_PRODUCT_ID).
  const CLASSROOM_URL = "https://219809065360.gumroad.com/l/dzsahy"; // Classroom license (one-time $59)
  const CLASSROOM_LABEL = "$59 once"; // keep in sync with Gumroad
  const PLAN_KEY = "wsai_plan"; // "basic" | "pro"
  const LEGACY_KEY = "wsai_unlocked"; // old unlock flag -> treated as Basic
  const PREF_KEY = "wsai_pref";
  const SUB_KEY = "wsai_subbed";

  const $ = (id) => document.getElementById(id);
  if (!$("genForm")) return; // nothing to do on pages without the tool

  const today = () => new Date().toISOString().slice(0, 10);
  const countKey = () => "wsai_count_" + today();
  // Sheets are generated one request at a time, but a 10-sheet pack or a
  // 3-level set still arrives as a burst. Groq's free tier caps TOKENS PER
  // MINUTE, so an unpaced burst can trip a 429 mid-set. A short pause between
  // sheets keeps a set completing instead of stopping half-built.
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const BETWEEN_SHEETS_MS = 1200;

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

  // ---------------- my worksheets (localStorage) ----------------
  // Every generated sheet is kept WITH its content, so "history" is a real
  // reprint library, not just topic shortcuts. Pinned sheets are kept forever;
  // pinning beyond the free limit is the upgrade moment.
  const HIST_KEY = "wsai_hist";
  const FAV_KEY = "wsai_favs";
  const HIST_MAX = 20;
  const FREE_FAV_LIMIT = 3;
  function loadList(key) { try { return JSON.parse(localStorage.getItem(key) || "[]"); } catch (e) { return []; } }
  function saveList(key, list) {
    try { localStorage.setItem(key, JSON.stringify(list)); }
    catch (e) { // storage full: keep the newest half and retry once
      try { localStorage.setItem(key, JSON.stringify(list.slice(0, Math.ceil(list.length / 2)))); } catch (e2) { /* ignore */ }
    }
  }
  function loadHist() { return loadList(HIST_KEY).filter((x) => x && x.html); } // legacy topic-only entries can't reopen
  function loadFavs() { return loadList(FAV_KEY); }
  function saveHist(item) {
    const h = loadHist().filter((x) => x.html !== item.html);
    h.unshift(Object.assign({ t: Date.now() }, item));
    saveList(HIST_KEY, h.slice(0, HIST_MAX));
  }
  function isPinned(item) { return !!item && item.html && loadFavs().some((x) => x.html === item.html); }
  function togglePin() {
    if (!lastSheetHtml) return;
    const item = { t: Date.now(), html: lastSheetHtml, topic: (lastCtx && lastCtx.topic) || "", subject: (lastCtx && lastCtx.subject) || "", grade: (lastCtx && lastCtx.grade) || "" };
    const favs = loadFavs();
    const i = favs.findIndex((x) => x.html === item.html);
    if (i >= 0) {
      favs.splice(i, 1);
      saveList(FAV_KEY, favs);
    } else {
      if (!isUnlocked() && favs.length >= FREE_FAV_LIMIT) { openPaywall("favorites"); return; }
      favs.unshift(item);
      saveList(FAV_KEY, favs.slice(0, 100));
    }
    updatePinBtn();
    renderHist();
  }
  function updatePinBtn() {
    const b = $("pinBtn");
    if (!b) return;
    const on = isPinned({ html: lastSheetHtml });
    b.textContent = on ? "★ Pinned" : "☆ Pin";
    b.title = on ? "Unpin this worksheet" : "Pin this worksheet so it never leaves your library";
    b.classList.toggle("pinned", on);
  }
  function renderHist() {
    const box = $("recentBox");
    if (!box) return;
    const favs = loadFavs();
    const h = loadHist();
    if (!favs.length && !h.length) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = "";
    const mkRow = (label, list, emptyNote) => {
      const row = document.createElement("div");
      row.className = "lib-row";
      const lab = document.createElement("span");
      lab.className = "recent-label";
      lab.textContent = label;
      row.appendChild(lab);
      if (!list.length && emptyNote) {
        const n = document.createElement("span");
        n.className = "recent-note";
        n.textContent = emptyNote;
        row.appendChild(n);
      }
      list.forEach((it) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "chip";
        const d = it.t ? new Date(it.t) : null;
        b.title = "Reprint this worksheet" + (d ? " (saved " + d.toLocaleDateString() + ")" : "");
        b.textContent = (it.subject ? it.subject + " · " : "") + (it.topic || "worksheet");
        b.addEventListener("click", () => {
          // Show a stored sheet AND make it the one the level-set button acts on.
          // Without this the button would re-level whatever was generated last,
          // i.e. the wrong worksheet.
          lastSheetHtml = it.html;
          lastIsSingle = true;
          lastCtx = { grade: it.grade || "", subject: it.subject || "", topic: it.topic || "" };
          paintWorksheet(it.html);
          updatePinBtn();
          $("resultWrap").scrollIntoView({ behavior: "smooth", block: "start" });
        });
        row.appendChild(b);
      });
      return row;
    };
    box.appendChild(mkRow("\u2B50 Pinned:", favs, isUnlocked() ? "" : "pin a sheet to keep it forever \u2014 3 on the free plan"));
    box.appendChild(mkRow("\u{1F552} Recent \u2014 click to reprint:", h.slice(0, 10), ""));
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

  // Seasonal suggestion, shown first for the current month (schools plan by
  // the calendar: back-to-school, Halloween, Thanksgiving, holidays, summer).
  const SEASONAL = {
    1:  { Math: "snow day math", Writing: "my winter break story", Reading: "a snowy day story", Science: "snow and ice" },
    9:  { Math: "back to school counting", Writing: "my summer story", Reading: "a first day of school story", Science: "apples and seasons", Vocabulary: "school words", Spelling: "school words" },
    10: { Math: "halloween candy math", Science: "pumpkin life cycle", Writing: "a friendly ghost story", Reading: "trick-or-treat night", Vocabulary: "halloween words", Spelling: "spooky words" },
    11: { Math: "thanksgiving dinner math", Writing: "what I am thankful for", Reading: "the first thanksgiving", Vocabulary: "gratitude words", "Social Studies": "the first thanksgiving" },
    12: { Math: "holiday gift shop math", Writing: "my holiday wish", Reading: "a winter snow day", Science: "snow and ice", Vocabulary: "winter words" },
    5:  { Math: "summer picnic math", Writing: "my perfect summer day", Science: "life cycles in summer", Reading: "a day at the beach" },
    6:  { Math: "summer review math", Writing: "my summer bucket list", Reading: "a camping trip story", Science: "oceans in summer" },
  };
  const SEASONAL_EMOJI = { 1: "\u2744\uFE0F", 9: "\u{1F392}", 10: "\u{1F383}", 11: "\u{1F983}", 12: "\u{1F384}", 5: "\u2600\uFE0F", 6: "\u2600\uFE0F" };

  function renderChips() {
    const box = $("topicChips");
    if (!box) return;
    const subject = ($("subject") && $("subject").value) || "Math";
    const list = SUGGESTIONS[subject] || SUGGESTIONS.Math;
    box.innerHTML = "";
    const month = new Date().getMonth() + 1;
    const season = (SEASONAL[month] || {})[subject];
    if (season && list.indexOf(season) < 0) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip chip-season";
      b.title = "Seasonal pick for this month";
      b.textContent = (SEASONAL_EMOJI[month] || "\u2728") + " " + season;
      b.addEventListener("click", () => { $("topic").value = season; $("topic").focus(); });
      box.appendChild(b);
    }
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
      '<select id="style"><option value="mixed" selected>Mixed</option><option value="computation">Computation</option><option value="word">Word problems</option></select></div>' +
      '<div class="field"><label for="studentName">Student name (optional)</label>' +
      '<input id="studentName" type="text" placeholder="e.g. Leo" autocomplete="off" /></div>' +
      '<div class="field"><label for="pack">Pack size</label>' +
      '<select id="pack"><option value="1" selected>1 sheet</option><option value="5">5 sheets</option><option value="10">10 sheets</option></select></div>';
    $("genForm").insertBefore(opts, $("genBtn"));

    if ($("subject")) $("subject").addEventListener("change", function () { renderChips(); syncMathStyle(); updateQuota(); });
    if ($("pack")) $("pack").addEventListener("change", function () {
      if ($("genBtn")) $("genBtn").textContent = genLabel();
      updateQuota();
    });
    if ($("genBtn") && $("pack")) $("genBtn").textContent = genLabel();
    renderChips();
    syncMathStyle();

    // Generation progress bar. It MUST live in the always-visible form (right
    // under the Generate button) — NOT inside #resultWrap, which starts hidden:
    // otherwise the FIRST generation shows no bar (its ancestor is display:none
    // until the sheet is painted, by which time the bar is already done/hidden).
    const progAnchor = $("genBtn") || $("note");
    if (progAnchor && !$("genProgress")) {
      const p = document.createElement("div");
      p.id = "genProgress";
      p.className = "gen-progress no-print";
      p.hidden = true;
      p.innerHTML = '<div class="gp-track"><div class="gp-fill"></div></div><span class="gp-label"></span>';
      progAnchor.parentNode.insertBefore(p, progAnchor.nextSibling);
    }

    const toolbar = document.querySelector("#resultWrap .toolbar");
    if (toolbar && !$("regenBtn")) {
      const mk = (id, label, title, fn) => {
        const b = document.createElement("button");
        b.type = "button"; b.id = id; b.hidden = true; b.title = title; b.textContent = label;
        b.addEventListener("click", fn);
        return b;
      };
      const anchor = $("printBtn") || toolbar.firstChild;
      // "Easier" and "Harder" are one API call each, so a parent who wants only
      // one direction doesn't pay the compute/time for both. "All 3 levels" stays
      // as an opt-in for families comparing the same sheet side by side.
      [
        mk("pinBtn", "☆ Pin", "Pin this worksheet so it never leaves your library", togglePin),
        mk("levelEasierBtn", "⬇️ Easier version", "Make this same worksheet easier", () => runRelevelOne("easier")),
        mk("levelHarderBtn", "⬆️ Harder version", "Make this same worksheet harder", () => runRelevelOne("challenge")),
        mk("levelSetBtn", "🎚️ All 3 levels", "Make the Easier and Harder versions at once and compare them", runLevelSet),
        mk("regenBtn", "🔄 Another version", "Generate a brand-new worksheet on the same topic", () => runGenerate(true)),
      ].forEach((b) => toolbar.insertBefore(b, anchor));

      // Answer-key print toggle: off = print ONLY the student sheet. The key
      // still lives on screen; this only changes what the printer gets.
      const keyTgl = document.createElement("label");
      keyTgl.className = "key-toggle no-print";
      keyTgl.title = "When on, the answer key prints on its own page. Turn off to print only the student sheet.";
      keyTgl.innerHTML = '<input type="checkbox" id="keyToggle" checked /> Answer key';
      toolbar.insertBefore(keyTgl, anchor);
      const kt = $("keyToggle");
      if (kt) {
        try { kt.checked = localStorage.getItem("wsai_print_key") !== "0"; } catch (e) { /* default on */ }
        const applyKeyPref = () => {
          document.body.classList.toggle("print-no-key", !kt.checked);
          try { localStorage.setItem("wsai_print_key", kt.checked ? "1" : "0"); } catch (e) { /* ignore */ }
        };
        kt.addEventListener("change", applyKeyPref);
        applyKeyPref();
      }
    }

    const recent = document.createElement("div");
    recent.id = "recentBox";
    recent.className = "recent no-print";
    recent.hidden = true;
    const rw = $("resultWrap");
    if (rw && rw.parentNode) rw.parentNode.insertBefore(recent, rw.nextSibling);
  }

  // ================= math rendering =================
  // A fill-in blank — empty braces, a lone \square / \Box, or pure whitespace —
  // is drawn as a light box instead of an empty cell, so "½ = ▢/4" shows a
  // visible slot the student can write in. Otherwise the cell text passes through.
  function fracSpan(a, b) {
    const cell = (x) => {
      const s = String(x == null ? "" : x).trim();
      return (s === "" || /^\\(?:square|Box|blacksquare|filledsquare)$/.test(s))
        ? '<span class="fill"></span>' : x;
    };
    return '<span class="frac"><span class="num">' + cell(a) + '</span><span class="den">' + cell(b) + '</span></span>';
  }
  function gcd(a, b) { return b ? gcd(b, a % b) : a; }
  function fracLabel(num, den) {
    const g = gcd(num, den);
    const n = num / g, d = den / g;
    if (d === 1) return String(n);
    return fracSpan(n, d);
  }
  function renderMathString(t) {
    // Normalize Unicode fraction/division slashes to ASCII so every fraction
    // form below matches. Mirrors scripts/visuals.js.
    t = String(t == null ? "" : t).replace(/[\u2044\u2215]/g, "/");
    t = t.replace(/\\[\(\)\[\]]/g, "");
    // LaTeX-escaped punctuation/spaces the model emits (\_, \%, \&, \#, \ , \, \;)
    // must be UNESCAPED — otherwise "\_\_\_" prints literally WITH backslashes.
    // Mirrors scripts/visuals.js.
    t = t.replace(/\\([_%&#])/g, "$1");
    t = t.replace(/\\[ ,;:]/g, " ");
    // Only treat $...$ as a LaTeX delimiter when it wraps a macro. Money uses
    // the same glyph: "$5 + $3" must keep its dollar signs. Mirrors visuals.js.
    t = t.replace(/\$([^$]+)\$/g, (m, inner) => (/\\/.test(inner) ? inner : m));
    // Allow EMPTY braces so a fill-in like \frac{}{4} (or \frac{\square}{4}) still
    // becomes a fraction — with a light box standing in for the blank — instead
    // of leaking literal "{}" braces. Mirrors scripts/visuals.js.
    t = t.replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, (m, a, b) => fracSpan(a, b));
    t = t.replace(/(\d+)\s+(\d+)\s*\/\s*(\d+)/g, (m, w, a, b) => w + " " + fracSpan(a, b));
    t = t.replace(/(^|[^\d/])(\d+)\s*\/\s*(\d+)(?![\d/])/g, (m, pre, a, b) => pre + fracSpan(a, b));
    t = t
      .replace(/\\times/g, "\u00d7")
      .replace(/\\div(?![a-zA-Z])/g, "\u00f7")
      .replace(/\\cdot/g, "\u00b7")
      .replace(/\\le(?![a-zA-Z])/g, "\u2264")
      .replace(/\\ge(?![a-zA-Z])/g, "\u2265")
      .replace(/\\neq/g, "\u2260")
      .replace(/\\pm(?![a-zA-Z])/g, "\u00b1");
    // Never let a macro the renderer does not understand leak as raw text
    // (e.g. \underline{\hspace{1cm}}). Spacers first (they nest inside
    // \underline), then keep the payload of \underline{X}, then drop any
    // leftover command. Mirrors scripts/visuals.js for baked samples.
    t = t.replace(/\\(?:hspace|vspace|hskip|vskip|quad|qquad|thinspace|enspace|medspace|thickspace)\*?(?:\{[^{}]*\})?/g, " ");
    t = t.replace(/\\(?:underline|textbf|textit|emph|mathrm|text|mbox)\{([^{}]*)\}/g, "$1");
    t = t.replace(/\\(?:left|right|displaystyle|textstyle)\b/g, "");
    t = t.replace(/\\[a-zA-Z]+/g, "");
    // Safety net: an unknown frac-like macro was stripped above and left an
    // orphan digit pair like "{8}{3}" — stack it instead of leaking raw braces.
    t = t.replace(/\{(-?\d+)\}\s*\{(-?\d+)\}/g, (m, a, b) => fracSpan(a, b));
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
      if (!/(\\[a-zA-Z]|\$|\d\s*[/\u2044\u2215]\s*\d)/.test(t)) continue;
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
    updateQuotaBase();
    // If a pack is selected that today's allowance can't cover, say so up front
    // instead of silently handing back a short stack.
    const n = $("pack") ? parseInt($("pack").value, 10) : 1;
    if (n <= 1) return;
    const left = freeLeft();
    const q = $("quota");
    if (q && left !== Infinity && left < n) {
      q.textContent = "Only " + left + " left today \u2014 a " + n + "-sheet pack will stop at " +
        left + ". Upgrade to make the whole pack.";
    }
  }

  function updateQuotaBase() {
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
      '<p class="sub-sub">Join free and get a <strong>10-printable Starter Pack</strong> (with answer keys) right now — new packs by email after that. No spam, unsubscribe anytime.</p>' +
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

  // ---------------- API guard (gate ticket) ----------------
  // The server only answers API calls that carry a short-lived signed ticket
  // from /api/gate. Fetched lazily, cached per tab, refreshed once on 403.
  let gateTicket = "";
  try { gateTicket = sessionStorage.getItem("wsai_gate") || ""; } catch (e) { /* private mode */ }
  async function ensureTicket(force) {
    if (gateTicket && !force) return gateTicket;
    try {
      const r = await fetch("/api/gate");
      const d = await r.json();
      if (d && d.ticket) {
        gateTicket = d.ticket;
        try { sessionStorage.setItem("wsai_gate", gateTicket); } catch (e) { /* ignore */ }
      }
    } catch (e) { /* the guarded call will surface a clear error */ }
    return gateTicket;
  }
  async function apiFetch(url, opts) {
    const o = opts || {};
    await ensureTicket();
    const withTicket = () => Object.assign({}, o.headers, gateTicket ? { "x-gate": gateTicket } : {});
    let res = await fetch(url, Object.assign({}, o, { headers: withTicket() }));
    if (res.status === 403) {
      const data = await res.json().catch(() => ({}));
      if (data && /verification missing or expired/i.test(data.error || "")) {
        await ensureTicket(true);
        res = await fetch(url, Object.assign({}, o, { headers: withTicket() }));
      }
    }
    return res;
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
      const res = await apiFetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email, source: location.pathname }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error((data && data.error) || "Could not sign you up.");
      localStorage.setItem(SUB_KEY, "1");
      msg.className = "msg ok";
      // Deliver the Starter Pack instantly — don't make a new lead wait for email.
      msg.innerHTML = "\u2714 You're on the list \u2014 <a href=\"/starter-pack.pdf\" download>download your free Starter Pack (10 printables)</a>.";
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
      const res = await apiFetch("/api/generate", {
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

  // Subjects whose questions ask for a written answer ("answer in complete
  // sentences", "rewrite each sentence"). Spelling / vocabulary get a word list
  // instead and writing has its own .ws-lines block, so they are excluded.
  const NEEDS_LINES = ["reading", "science", "social", "grammar"];

  // Give children somewhere to actually write. The AI is asked to say
  // "answer in complete sentences" but nothing in the sheet provided any ruled
  // space, so a printed sheet left nowhere to put the answer.
  function addAnswerSpace(box) {
    const subj = (($("subject") && $("subject").value) || "").toLowerCase();
    if (!NEEDS_LINES.some((k) => subj.indexOf(k) >= 0)) return;
    const items = box.querySelectorAll(".ws-questions > li");
    for (const li of items) {
      if (li.querySelector(".answer-lines") || li.querySelector(".ws-visual")) continue;
      const d = document.createElement("div");
      d.className = "answer-lines";
      d.setAttribute("contenteditable", "false");
      li.appendChild(d);
    }
  }

  function paintWorksheet(html) {
    const box = $("result");
    box.innerHTML = html || "<p>No content was returned.</p>";
    renderMath(box);
    hydrateVisuals(box);
    ensureOrganizer(box);
    addAnswerSpace(box);
    attachItemTools(box);
    if ($("font")) { box.classList.remove("font-andika", "font-comic", "font-lexend", "font-nunito"); box.classList.add("font-" + $("font").value); }
    if ($("size")) { box.classList.remove("size-s", "size-m", "size-l", "size-xl"); box.classList.add("size-" + $("size").value); }
    let wm = box.querySelector(".watermark");
    if (!isUnlocked()) {
      if (!wm) { wm = document.createElement("p"); wm.className = "watermark"; box.appendChild(wm); }
      wm.textContent = "Free preview · upgrade to remove the watermark — unlimited math for $13.30 once";
    } else if (wm) {
      wm.remove();
    }
    if ($("regenBtn")) $("regenBtn").hidden = false;
    // The level-set button only makes sense while ONE sheet is on screen.
    const showLevels = !!(lastIsSingle && lastSheetHtml);
    ["levelEasierBtn", "levelHarderBtn", "levelSetBtn", "pinBtn"].forEach((id) => { if ($(id)) $(id).hidden = !showLevels; });
    updatePinBtn();
    $("upsellBar").hidden = isUnlocked();
    $("resultWrap").hidden = false;
  }

  function renderResult(html, demo, checked) {
    paintWorksheet(html);
    const note = $("note");
    if (demo) note.textContent = "Demo mode (no API key set on server)";
    else {
      // Make the (otherwise invisible) answer-key check a visible trust signal.
      const badge = checked ? '<span class="ws-checked">&#10004; Answer key checked</span>' : "";
      const planTxt = isUnlocked() ? "Pro — watermark removed" : "Free preview";
      note.innerHTML = badge ? badge + " &middot; " + planTxt : planTxt;
    }
    $("resultWrap").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ================= multi-page packs =================
  // Why this exists: TPT data shows bundles are the highest-revenue product
  // type, and Etsy data shows $18-28 bundles outsell $3-5 singles about 5x.
  // Parents buy "a stack of worksheets to hand over", not "a generator". A
  // single sheet also makes a paid plan feel small: one sheet from an
  // "unlimited" product reads as a tenth of the value.
  //
  // Implementation note: each sheet is its OWN /api/generate request, run from
  // the browser. One request can't build 10 sheets inside Vercel's 60s function
  // limit, but 10 short requests are fine. The quota is consumed one credit per
  // sheet, so a free user can make a 2-sheet pack and then hits the wall.

  function genLabel() {
    const n = $("pack") ? parseInt($("pack").value, 10) : 1;
    return n > 1 ? "Make a " + n + "-sheet pack" : "Generate worksheet";
  }

  // ---- generation progress (real stages via SSE, smooth percentage inside) ----
  function startProgress() {
    const box = $("genProgress");
    if (!box) return { stage: () => {}, done: () => {}, fail: () => {} };
    const fill = box.querySelector(".gp-fill");
    const label = box.querySelector(".gp-label");
    box.hidden = false;
    let pct = 4, target = 55, stage = "writing";
    const t0 = Date.now();
    const render = () => {
      fill.style.width = pct + "%";
      label.textContent = (stage === "checking" ? "Checking every answer…" : "Writing your questions…") + " " + Math.round(pct) + "% · " + Math.round((Date.now() - t0) / 1000) + "s";
    };
    render();
    const timer = setInterval(() => {
      pct = Math.min(target, pct + Math.max(0.35, (target - pct) * 0.05));
      render();
    }, 280);
    return {
      stage(s) {
        if (stage === s) return;
        stage = s;
        if (s === "checking") { pct = Math.max(pct, 58); target = 92; }
        render();
      },
      done() { clearInterval(timer); pct = 100; fill.style.width = "100%"; label.textContent = "Done \u00b7 " + Math.round((Date.now() - t0) / 1000) + "s"; setTimeout(() => { box.hidden = true; }, 900); },
      fail() { clearInterval(timer); box.hidden = true; },
    };
  }

  async function generateOnce(topic, onStage) {
    const wantsStream = typeof onStage === "function";
    const res = await apiFetch("/api/generate", {
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
        student: $("studentName") ? $("studentName").value.trim() : "",
        stream: wantsStream ? 1 : 0,
      }),
    });
    if (!wantsStream) {
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Request failed");
      return data;
    }
    // SSE: JSON responses here are either the non-stream error paths (403/429)
    // or a not-yet-updated server instance during a deploy race — accept its
    // payload if it carries a worksheet instead of failing the request.
    if (!(res.headers.get("content-type") || "").includes("text/event-stream")) {
      const data = await res.json().catch(() => ({}));
      if (data && data.html) return data;
      throw new Error((data && data.error) || "Request failed");
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "", final = null;
    // Watchdog: a stalled connection must never leave the user on the progress
    // bar forever. 45s without bytes, or 2.5 minutes total, cancels the read.
    let lastBytes = Date.now();
    const started = Date.now();
    const watchdog = setInterval(() => {
      if (Date.now() - lastBytes > 60000 || Date.now() - started > 300000) {
        clearInterval(watchdog);
        try { reader.cancel("stalled"); } catch (e) { /* already closed */ }
      }
    }, 2000);
    try {
      for (;;) {
        const r = await reader.read();
        if (r.done) break;
        lastBytes = Date.now();
        buf += dec.decode(r.value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const line = chunk.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          const evt = JSON.parse(line.slice(6));
          if (evt.done) final = evt;
          else onStage(evt.stage || "writing");
        }
      }
    } finally {
      clearInterval(watchdog);
    }
    if (!final) throw new Error("The connection dropped \u2014 please try again.");
    if (final.error) throw new Error(final.error);
    return final;
  }

  function consumeCredit() {
    if (plan() === "pro") return;
    if (isMath()) {
      if (plan() === "free") setCount(getCount() + 1); // Basic: math is unlimited
    } else {
      setCountOther(getCountOther() + 1);
    }
  }

  // One generated sheet = student pages, then <hr class="ws-pagebreak">, then
  // its answer key. Split so a pack can be assembled as "all sheets, then all
  // keys" instead of "sheet, key, sheet, key" (which doubles the printing).
  function splitSheet(html) {
    const m = String(html || "").match(/<hr[^>]*class="ws-pagebreak"[^>]*>/i);
    if (!m) return { body: String(html || ""), key: "" };
    return { body: html.slice(0, m.index), key: html.slice(m.index + m[0].length) };
  }

  // Label every sheet so the pack reads as a deliberate set, not 10 loose pages.
  function numberTitle(body, i, n) {
    return String(body).replace(
      /(<h2[^>]*class="ws-title"[^>]*>)([\s\S]*?)(<\/h2>)/i,
      (m, a, t, b) => a + t.trim() + " \u2014 Sheet " + i + " of " + n + b
    );
  }
  function labelKeyWith(key, label) {
    return String(key).replace(
      /(<h3[^>]*class="ws-answers-title"[^>]*>)([\s\S]*?)(<\/h3>)/i,
      (m, a, t, b) => a + "Answer Key \u2014 " + label + b
    );
  }
  function labelKey(key, i) {
    return labelKeyWith(key, "Sheet " + i);
  }
  function labelLevel(html, label) {
    return String(html).replace(
      /(<h2[^>]*class="ws-title"[^>]*>)([\s\S]*?)(<\/h2>)/i,
      (m, a, t, b) => a + t.trim() + " \u2014 " + label + b
    );
  }

  function paintPack(sheets, stopped, requested) {
    lastIsSingle = false; // the visible document is a set, not one sheet
    lastSheetHtml = "";
    const parts = sheets.map((s) => splitSheet(s.html));
    const n = parts.length;
    const body = parts
      .map((p, i) => '<section class="ws-pack-sheet">' + numberTitle(p.body, i + 1, n) + "</section>")
      .join("");
    const keys = parts
      .map((p, i) => (p.key ? '<section class="ws-pack-key">' + labelKey(p.key, i + 1) + "</section>" : ""))
      .join("");
    const packHead =
      '<p class="ws-pack-head">' + $("grade").value + " \u00b7 " + $("subject").value + " \u00b7 " +
      $("topic").value.trim() + " \u2014 " + n + "-sheet pack</p>";
    paintWorksheet(
      packHead +
        '<section class="ws-pack-body">' + body + "</section>" +
        (keys ? '<hr class="ws-pagebreak">' + '<section class="ws-pack-keys">' + keys + "</section>" : "")
    );
    const note = $("note");
    if (note) {
      note.textContent = stopped
        ? "Made " + n + " of " + requested + " sheets \u2014 you hit today's free limit. Upgrade to finish the pack."
        : n + "-sheet pack ready \u2014 " + (n + Math.ceil(n / 3)) + " pages incl. answer keys";
    }
    if (stopped) { try { openPaywall("pack_limit"); } catch (e) { /* ignore */ } }
  }

  // ============ level sets: one worksheet, three difficulties ================
  // A worksheet library sells three DIFFERENT worksheets. What a family with
  // children at different levels actually needs is the SAME worksheet at three
  // levels, so one lesson can be taught once and marked once. Nothing in the
  // category offers that, and a library structurally cannot.
  let lastSheetHtml = "";
  let lastIsSingle = false;
  // The grade/subject/topic the sheet on screen was actually generated for.
  // Taken at generation time, not read off the form later, because the visitor
  // may have edited the topic box in the meantime.
  let lastCtx = { grade: "", subject: "", topic: "" };

  async function relevelOnce(level) {
    const res = await apiFetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "relevel",
        grade: lastCtx.grade || $("grade").value,
        subject: lastCtx.subject || $("subject").value,
        topic: lastCtx.topic || $("topic").value.trim(),
        level: level,
        source: lastSheetHtml,
      }),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || "Request failed");
    return data;
  }

  function paintLevelSet(sheets, stopped) {
    const parts = sheets.map((s) => {
      const sp = splitSheet(s.html);
      return { label: s.label, body: sp.body, key: sp.key };
    });
    const body = parts
      .map((p) => '<section class="ws-pack-sheet">' + labelLevel(p.body, p.label) + "</section>")
      .join("");
    const keys = parts
      .map((p) => (p.key ? '<section class="ws-pack-key">' + labelKeyWith(p.key, p.label) + "</section>" : ""))
      .join("");
    const head =
      '<p class="ws-pack-head">' + (lastCtx.grade || $("grade").value) + " \u00b7 " +
      (lastCtx.subject || $("subject").value) + " \u00b7 " +
      (lastCtx.topic || $("topic").value.trim()) + " \u2014 the same worksheet at three levels</p>";
    lastSheetHtml = "";
    lastIsSingle = false;
    paintWorksheet(
      head +
        '<section class="ws-pack-body">' + body + "</section>" +
        (keys ? '<hr class="ws-pagebreak">' + '<section class="ws-pack-keys">' + keys + "</section>" : "")
    );
    const note = $("note");
    if (note) {
      note.textContent = stopped
        ? "Made " + parts.length + " of 3 levels \u2014 you hit today's free limit. Upgrade to finish the set."
        : parts.length + " levels ready: Easier / Standard / Challenge \u2014 print them as one set";
    }
    if (stopped) { try { openPaywall("levelset_limit"); } catch (e) { /* ignore */ } }
  }

  async function runLevelSet() {
    if (!lastSheetHtml || !lastIsSingle) return;
    const btn = $("levelSetBtn");
    const note = $("note");
    const orig = btn.textContent;
    const out = [{ label: "Standard", html: lastSheetHtml }];
    let stopped = false;
    btn.disabled = true;
    track("levelset_start", { subject: $("subject").value, grade: $("grade").value, plan: plan() });
    try {
      for (const pair of [["easier", "Easier"], ["challenge", "Challenge"]]) {
        if (!canGenerate()) { stopped = true; break; }
        btn.textContent = "Making the " + pair[1].toLowerCase() + " version\u2026";
        if (note) note.textContent = "Rewriting this exact sheet at a " + pair[1].toLowerCase() + " level\u2026";
        try {
          const d = await relevelOnce(pair[0]);
          out.push({ label: pair[1], html: d.html });
          consumeCredit();
          updateQuota();
          await sleep(BETWEEN_SHEETS_MS);
        } catch (e) {
          if (out.length === 1) throw e;
          break; // keep whatever we managed to build
        }
      }
      if (out.length === 1) throw new Error("The AI was busy \u2014 please try again in a few seconds.");
      const ordered = ["Easier", "Standard", "Challenge"]
        .map((l) => out.filter((o) => o.label === l)[0])
        .filter(Boolean);
      paintLevelSet(ordered, stopped);
      track("levelset_ok", { made: ordered.length, stopped: stopped });
    } catch (err) {
      track("levelset_err", { message: String(err.message || err).slice(0, 120) });
      alert("Something went wrong: " + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = orig;
      updateQuota();
    }
  }

  // Re-level the current sheet at ONE chosen difficulty. One API call (not two),
  // so a parent who only wants an easier (or only a harder) version does not pay
  // the compute/time for both.
  async function runRelevelOne(level) {
    if (!lastSheetHtml || !lastIsSingle) return;
    const label = level === "challenge" ? "Harder" : "Easier";
    if (!canGenerate()) { openPaywall(isMath() ? "quota" : "subject_gate"); return; }
    const btn = $(level === "challenge" ? "levelHarderBtn" : "levelEasierBtn");
    const note = $("note");
    if (btn) btn.disabled = true;
    track("relevel_start", { level: level, subject: $("subject").value, grade: $("grade").value, plan: plan() });
    try {
      const d = await relevelOnce(level);
      lastSheetHtml = d.html;
      lastIsSingle = true;
      renderResult(d.html, false, d.checked);
      try { saveHist({ topic: (lastCtx && lastCtx.topic) || "worksheet", subject: (lastCtx && lastCtx.subject) || "", grade: (lastCtx && lastCtx.grade) || "", html: d.html }); } catch (e) { /* ignore */ }
      renderHist();
      if (note) note.textContent = label + " version ready — make it " + (level === "challenge" ? "easier" : "harder") + " or print it now.";
      consumeCredit();
      updateQuota();
      track("relevel_ok", { level: level });
    } catch (err) {
      track("relevel_err", { level: level, message: String(err.message || err).slice(0, 120) });
      alert("Something went wrong: " + err.message);
    } finally {
      if (btn) btn.disabled = false;
      updateQuota();
    }
  }

  async function runPack(n) {
    const topic = $("topic").value.trim();
    if (!topic) { alert("Please enter a topic (or tap a suggestion)."); return; }
    if (!canGenerate()) { openPaywall(isMath() ? "quota" : "subject_gate"); return; }
    savePref();
    track("pack_start", { subject: $("subject").value, grade: $("grade").value, size: n, plan: plan() });

    const btn = $("genBtn");
    const note = $("note");
    const sheets = [];
    let stopped = false;
    btn.disabled = true;
    $("resultWrap").hidden = false;
    try {
      for (let i = 1; i <= n; i++) {
        if (!canGenerate()) { stopped = true; break; }
        btn.textContent = "Making sheet " + i + " of " + n + "\u2026";
        if (note) note.textContent = "Making sheet " + i + " of " + n + "\u2026 (this takes a moment)";
        try {
          sheets.push(await generateOnce(topic));
          consumeCredit();
          updateQuota();
          await sleep(BETWEEN_SHEETS_MS);
        } catch (e) {
          // A single busy model shouldn't destroy a half-built pack.
          if (!sheets.length) throw e;
          break;
        }
      }
      if (!sheets.length) throw new Error("The AI was busy \u2014 please try again in a few seconds.");
      paintPack(sheets, stopped, n);
      // Every sheet of a pack is a real worksheet: file each one so it can be
      // found and reprinted later from the library.
      sheets.forEach((s) => { try { saveHist({ topic: topic, subject: $("subject").value, grade: $("grade").value, html: s.html }); } catch (e) { /* ignore */ } });
      renderHist();
      track("pack_ok", { made: sheets.length, requested: n, stopped: stopped });
    } catch (err) {
      track("pack_err", { message: String(err.message || err).slice(0, 120) });
      $("resultWrap").hidden = sheets.length === 0;
      alert("Something went wrong: " + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = genLabel();
      updateQuota();
    }
  }

  async function runGenerate(forceSingle) {
    if (!$("subject") || !$("subject").value) {
      alert("Please choose a subject first.");
      if ($("subject")) $("subject").focus();
      return;
    }
    const packN = forceSingle || !$("pack") ? 1 : parseInt($("pack").value, 10) || 1;
    if (packN > 1) {
      $("upsellBar").hidden = isUnlocked();
      $("regenBtn") && ($("regenBtn").hidden = false);
      return runPack(packN);
    }
    const topic = $("topic").value.trim();
    if (!topic) { alert("Please enter a topic (or tap a suggestion)."); return; }
    if (!canGenerate()) { openPaywall(isMath() ? "quota" : "subject_gate"); return; }
    track("generate_start", { subject: $("subject").value, grade: $("grade").value, plan: plan() });
    savePref();

    const btn = $("genBtn");
    btn.disabled = true;
    btn.textContent = "Generating…";
    const prog = startProgress();
    try {
      const data = await generateOnce(topic, (stage) => prog.stage(stage));
      lastSheetHtml = data.html; // kept so "easier + harder" can re-level THIS sheet
      lastIsSingle = true;
      lastCtx = { grade: $("grade").value, subject: $("subject").value, topic: topic };
      renderResult(data.html, data.demo, data.checked);
      prog.done();
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
      prog.fail();
      track("generate_err", { message: String(err.message || err).slice(0, 120) });
      alert("Something went wrong: " + err.message + "\nFree models can be busy — please try again in a few seconds.");
    } finally {
      btn.disabled = false;
      btn.textContent = genLabel();
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
      const res = await apiFetch("/api/verify-license", {
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
  const classroomBlock = $("classroomBlock");
  if (classroomBlock) {
    if (CLASSROOM_URL) {
      const cb = $("gumroadClassroomBtn");
      if (cb) {
        cb.href = CLASSROOM_URL;
        cb.textContent = "Get the Classroom license — " + CLASSROOM_LABEL;
        cb.addEventListener("click", () => track("buy_click", { from: "paywall", plan: "classroom" }));
      }
      classroomBlock.hidden = false;
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
