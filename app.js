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

  function updateQuota() {
    const q = $("quota");
    if (!q) return;
    if (isUnlocked()) { q.textContent = "Pro: unlimited worksheets ✔"; return; }
    const left = Math.max(0, FREE_LIMIT - getCount());
    q.textContent = "Free plan: " + left + " of " + FREE_LIMIT + " worksheets left today";
  }

  function openPaywall() { $("paywall").hidden = false; }
  function closePaywall() { $("paywall").hidden = true; }

  function renderResult(html, demo) {
    const box = $("result");
    box.innerHTML = html || "<p>No content was returned.</p>";

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
        msg.textContent = "✔ Unlocked! Enjoy unlimited worksheets.";
        updateQuota();
        const box = $("result");
        const wm = box && box.querySelector(".watermark");
        if (wm) wm.remove();
        $("upsellBar").hidden = true;
        setTimeout(closePaywall, 900);
      } else {
        msg.textContent = "✖ " + (data.error || "That key is not valid.");
      }
    } catch (err) {
      msg.textContent = "✖ Error: " + err.message;
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
