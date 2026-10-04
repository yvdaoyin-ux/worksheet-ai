// WorksheetAI — shared client logic (used by index.html and all generated pages)
// Optional prefill: put data-grade / data-subject / data-topic on the <form id="genForm">.
(function () {
  const GUMROAD_URL = "https://219809065360.gumroad.com/l/orqxtr";
  const FREE_LIMIT = 2; // free worksheets per day

  const $ = (id) => document.getElementById(id);
  if (!$("genForm")) return; // nothing to do on pages without the tool

  const today = () => new Date().toISOString().slice(0, 10);
  const countKey = () => "wsai_count_" + today();
  const isUnlocked = () => localStorage.getItem("wsai_unlocked") === "1";
  const getCount = () => parseInt(localStorage.getItem(countKey()) || "0", 10);
  const setCount = (n) => localStorage.setItem(countKey(), String(n));

  // ---- math rendering: LaTeX + plain fractions -> stacked fractions, math symbols ----
  function fracSpan(a, b) {
    return '<span class="frac"><span class="num">' + a + '</span><span class="den">' + b + '</span></span>';
  }

  function renderMathString(t) {
    // remove LaTeX inline/display math delimiters \( \) \[ \]
    t = t.replace(/\\[\(\)\[\]]/g, "");
    // strip $...$ ONLY when it wraps a math expression (keep real money amounts)
    t = t.replace(/\$([^$]+)\$/g, (m, inner) =>
      /[\\=+\u00d7\u00f7]/.test(inner) || /^[\s\d.,]+$/.test(inner) ? inner : m
    );
    // LaTeX fractions  \frac{a}{b}
    t = t.replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, (m, a, b) => fracSpan(a, b));
    // mixed numbers  2 1/3
    t = t.replace(/(\d+)\s+(\d+)\s*\/\s*(\d+)/g, (m, w, a, b) => w + " " + fracSpan(a, b));
    // simple fractions  1/4  (no lookbehind, for old browsers)
    t = t.replace(/(^|[^\d/])(\d+)\s*\/\s*(\d+)(?![\d/])/g, (m, pre, a, b) => pre + fracSpan(a, b));
    // math symbols
    t = t
      .replace(/\\times/g, "\u00d7")
      .replace(/\\div/g, "\u00f7")
      .replace(/\\cdot/g, "\u00b7")
      .replace(/\\le/g, "\u2264")
      .replace(/\\ge/g, "\u2265");
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

  function updateQuota() {
    const q = $("quota");
    if (!q) return;
    if (isUnlocked()) { q.textContent = "Pro: unlimited worksheets \u2714"; return; }
    const left = Math.max(0, FREE_LIMIT - getCount());
    q.textContent = "Free plan: " + left + " of " + FREE_LIMIT + " worksheets left today";
  }

  function openPaywall() { $("paywall").hidden = false; }
  function closePaywall() { $("paywall").hidden = true; }

  function renderResult(html, demo) {
    const box = $("result");
    box.innerHTML = html || "<p>No content was returned.</p>";
    renderMath(box);

    let wm = box.querySelector(".watermark");
    if (!isUnlocked()) {
      if (!wm) { wm = document.createElement("p"); wm.className = "watermark"; box.appendChild(wm); }
      wm.textContent = "Made with WorksheetAI — upgrade to remove";
    } else if (wm) {
      wm.remove();
    }

    $("upsellBar").hidden = isUnlocked();
    $("resultWrap").hidden = false;
    const note = $("note");
    if (demo) note.textContent = "Demo mode (no API key set on server)";
    else note.textContent = isUnlocked() ? "Pro — watermark removed" : "Free preview";
    $("resultWrap").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  $("genForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const topic = $("topic").value.trim();
    if (!topic) { alert("Please enter a topic."); return; }
    if (!isUnlocked() && getCount() >= FREE_LIMIT) { openPaywall(); return; }

    const btn = $("genBtn");
    btn.disabled = true; btn.textContent = "Generating…";
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grade: $("grade").value, subject: $("subject").value, topic }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Request failed");
      renderResult(data.html, data.demo);
      if (!isUnlocked()) setCount(getCount() + 1);
      updateQuota();
    } catch (err) {
      alert("Something went wrong: " + err.message + "\nFree models can be busy — please try again in a few seconds.");
    } finally {
      btn.disabled = false; btn.textContent = "Generate worksheet";
    }
  });

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

  // Prefill from data-* attributes (used by generated SEO pages)
  const form = $("genForm");
  if (form.dataset.grade) $("grade").value = form.dataset.grade;
  if (form.dataset.subject) $("subject").value = form.dataset.subject;
  if (form.dataset.topic) $("topic").value = form.dataset.topic;

  $("gumroadBtn").href = GUMROAD_URL;
  updateQuota();
})();
