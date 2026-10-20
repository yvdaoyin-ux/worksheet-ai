// _bench/ux_check.cjs — front-end-only regressions. No real API, no network:
// the local server stubs /api/* so the REAL app.js code path runs end to end
// (gate ticket -> generate -> renderResult -> attachItemTools).
//
// Asserts the display rules no other suite covers:
//   1. the quota line on a fresh homepage (no subject picked) reads as a
//      sentence — it used to render "Free plan: 1 of 1  worksheet left today".
//   2. the toolbar note names the plan the visitor actually has — a Basic buyer
//      used to be told "Pro".
//   3. the per-question tools are hidden at rest, visible on :focus-within
//      (keyboard), and visible + in-flow on a no-hover (touch) device.
//   4. 🔄 rewrite updates the matching ANSWER-KEY entry too (it used to leave the
//      key describing the old question, so a parent marked a correct child wrong),
//      and 🎯 tweak still does.
//   5. the Questions control is hidden for spelling / vocabulary / writing,
//      whose generator pins the item count.
//   6. the email box appears after a PACK, not only after a single sheet.
//   7. no horizontal overflow at 390px.
//
// Run: node _bench/ux_check.cjs     (needs Edge installed; nothing else)

const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const CDP_PORT = 9227;
const SRV_PORT = 3111;
const PROFILE = path.join(__dirname, "_ep_ux");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".xml": "application/xml",
  ".txt": "text/plain; charset=utf-8",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A canned sheet shaped exactly like the real generator's output.
const STUB_HTML =
  '<h2 class="ws-title">Stub Worksheet</h2>' +
  '<p class="ws-instructions">Solve each problem.</p>' +
  '<ol class="ws-questions"><li>What is 2 + 3? ____</li><li>What is 4 + 5? ____</li></ol>' +
  '<hr class="ws-pagebreak">' +
  '<h3 class="ws-answers-title">Answer Key</h3>' +
  '<ol class="ws-answers"><li>5</li><li>9</li></ol>';

function startServer() {
  let lastEdit = null; // last /api/generate body, so the test can inspect the request
  const srv = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const json = (obj) => {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(obj));
    };
    // ---- API stubs ----
    if (url.pathname === "/api/gate") return json({ ticket: "stub.ticket", ttlMinutes: 90 });
    if (url.pathname === "/api/track") return json({ ok: true });
    if (url.pathname === "/api/subscribe") return json({ ok: true, provider: "log-only" });
    if (url.pathname === "/api/_lastedit") return json(lastEdit || {});
    if (url.pathname === "/api/generate") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        try { lastEdit = JSON.parse(body); } catch (e) { lastEdit = { parseError: true }; }
        if (lastEdit.mode === "rewrite") {
          return json({ html: '<span class="rw">Rewritten question?</span>', answer: "42 \u2014 rewritten key", model: "stub" });
        }
        if (lastEdit.mode === "tweak") {
          return json({ html: '<span class="tw">Tweaked question?</span>', answer: "7 \u2014 tweaked key", model: "stub" });
        }
        json({ html: STUB_HTML, checked: true, model: "stub" });
      });
      return;
    }
    // ---- static ----
    let rel = url.pathname === "/" ? "/index.html" : url.pathname;
    let full = path.join(ROOT, rel);
    if (!full.startsWith(ROOT)) { res.writeHead(403); res.end("no"); return; }
    try { if (fs.statSync(full).isDirectory()) full = path.join(full, "index.html"); } catch (e) { /* fall through */ }
    fs.readFile(full, (err, data) => {
      if (err) { res.writeHead(404, { "Content-Type": "text/plain" }); res.end("404"); return; }
      res.writeHead(200, { "Content-Type": MIME[path.extname(full)] || "application/octet-stream" });
      res.end(data);
    });
  });
  return new Promise((res) => srv.listen(SRV_PORT, "127.0.0.1", () => res(srv)));
}

let msgId = 0;
const pending = new Map();
const send = (ws, method, params) =>
  new Promise((res, rej) => {
    const id = ++msgId;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
  });

async function wsUrlFor(port) {
  for (let i = 0; i < 40; i++) {
    try {
      const data = await new Promise((res, rej) => {
        http.get("http://127.0.0.1:" + port + "/json", (r) => {
          let b = ""; r.on("data", (c) => (b += c)); r.on("end", () => res(b));
        }).on("error", rej);
      });
      const pages = JSON.parse(data).filter((t) => t.type === "page");
      if (pages.length) return pages[0].webSocketDebuggerUrl;
    } catch (e) { /* not up yet */ }
    await sleep(500);
  }
  throw new Error("CDP never came up");
}

let pass = 0;
const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("PASS", name); }
  else { fails.push(name); console.log("FAIL", name, extra === undefined ? "" : "| " + extra); }
}

(async () => {
  const srv = await startServer();
  const edge = spawn(EDGE, [
    "--headless=new", "--disable-gpu", "--no-sandbox",
    "--remote-debugging-port=" + CDP_PORT,
    "--user-data-dir=" + PROFILE,
    "--window-size=430,900",
    "about:blank",
  ], { stdio: "ignore" });

  try {
    const ws = new WebSocket(await wsUrlFor(CDP_PORT));
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id).res(m.result); pending.delete(m.id); }
    };
    await send(ws, "Page.enable");
    await send(ws, "Runtime.enable");
    // Headless has no window focus, and Blink only applies :focus / :focus-within
    // when the document is focused — without this the keyboard-visibility
    // assertion below can never pass.
    await send(ws, "Emulation.setFocusEmulationEnabled", { enabled: true });
    const q = async (expr) => {
      const r = await send(ws, "Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
      return r.result && r.result.value;
    };
    const go = async () => {
      await send(ws, "Page.navigate", { url: "http://127.0.0.1:" + SRV_PORT + "/index.html" });
      await sleep(2300);
      await q("window.alert = window.prompt = function(){};");
    };
    // The profile dir is reused between runs, so localStorage carries over and a
    // "fresh homepage" would not be fresh. Wipe it, then reload for a true
    // first-visit state.
    const openClean = async () => {
      await go();
      await q("localStorage.clear()");
      await go();
    };
    // Generate once through the real submit handler (the API is stubbed).
    const generate = async () => {
      await q('(function(){ document.getElementById("subject").value="Math"; document.getElementById("topic").value="addition"; document.getElementById("genForm").dispatchEvent(new Event("submit",{cancelable:true})); })()');
      await sleep(2500);
    };
    // Scope every worksheet selector to #result: index.html also renders two
    // static sample worksheets that would otherwise be counted.
    const R = "#result ";

    // ---------- 1. fresh homepage, nothing selected ----------
    await openClean();
    const quotaFree = await q('document.getElementById("quota").textContent');
    ok("fresh quota names the whole allowance",
      quotaFree === "Free plan: 2 math worksheets a day, plus 1 in any other subject",
      JSON.stringify(quotaFree));
    ok("fresh quota has no empty subject slot / NaN",
      !/\s{2,}/.test(quotaFree || "") && !/NaN/.test(quotaFree || ""),
      JSON.stringify(quotaFree));

    // ---------- 2. Basic plan, nothing selected ----------
    await q('localStorage.setItem("wsai_plan","basic")');
    await go();
    const quotaBasic = await q('document.getElementById("quota").textContent');
    ok("basic quota (no subject) is well-formed",
      quotaBasic === "Basic plan: unlimited Math \u2714 \u00b7 3 worksheets a day in other subjects",
      JSON.stringify(quotaBasic));

    // ---------- 3. real generate through the stubbed API ----------
    await generate();
    const note = await q('document.getElementById("note").textContent');
    ok("Basic buyer is told Basic, not Pro", /Basic \u2014 watermark removed/.test(note || ""), JSON.stringify(note));
    ok("answer-key badge still shown", /Answer key checked/.test(note || ""), JSON.stringify(note));

    const qCount = await q('document.querySelectorAll("' + R + '.ws-questions > li").length');
    const toolSpans = await q('document.querySelectorAll("' + R + '.ws-questions > li > .li-tools").length');
    const toolButtons = await q('document.querySelectorAll("' + R + '.ws-questions > li > .li-tools button").length');
    ok("real code path attached tools to every question", toolSpans === qCount && qCount > 0, toolSpans + "/" + qCount);
    ok("each question got exactly 3 tools", toolButtons === qCount * 3, toolButtons + " for " + qCount + " questions");

    const opaIdle = await q('(function(){var t=document.querySelector("' + R + '.li-tools");return t?getComputedStyle(t).opacity:null;})()');
    ok("tools hidden at rest (desktop)", opaIdle === "0", String(opaIdle));

    // .li-tools has transition: opacity .15s — read only after it has settled,
    // otherwise getComputedStyle returns the mid-transition value (0).
    await q('(function(){var b=document.querySelector("' + R + '.li-tools button"); if(b) b.focus();})()');
    await sleep(400);
    const focusInfo = await q('(function(){var b=document.querySelector("' + R + '.li-tools button");var t=document.querySelector("' + R + '.li-tools");return b&&t?{active:document.activeElement===b,hasFocus:document.hasFocus(),opacity:getComputedStyle(t).opacity}:null;})()');
    console.log("   [info] focus: " + JSON.stringify(focusInfo));
    ok("tools visible when focus is inside", focusInfo && focusInfo.opacity === "1", JSON.stringify(focusInfo));

    // ---------- 4. Pro plan label ----------
    await q('localStorage.setItem("wsai_plan","pro")');
    await go();
    await generate();
    const notePro = await q('document.getElementById("note").textContent');
    ok("Pro buyer is told Pro", /Pro \u2014 watermark removed/.test(notePro || ""), JSON.stringify(notePro));

    // ---------- 5. rewrite must ALSO update the matching answer-key entry ----------
    // The shipped bug: 🔄 replaced the question but left the key describing the
    // OLD one, so a parent marking with the key marked a correct child wrong.
    const beforeAnswer = await q('document.querySelector("' + R + '.ws-answers > li").innerHTML');
    await q('document.querySelector("' + R + '.li-tools button:nth-of-type(2)").click()');
    await sleep(2000);
    const afterQ = await q('document.querySelector("' + R + '.ws-questions > li").innerHTML');
    const afterA = await q('document.querySelector("' + R + '.ws-answers > li").innerHTML');
    const sent = await q('fetch("/api/_lastedit").then(function(r){return r.json()})');
    console.log("   [info] rewrite request: mode=" + (sent && sent.mode) + "  answer=" + JSON.stringify(sent && sent.answer));
    ok("rewrite replaced the question", /Rewritten question/.test(afterQ || ""), JSON.stringify(afterQ));
    ok("rewrite updated the answer key", /rewritten key/.test(afterA || "") && afterA !== beforeAnswer, JSON.stringify(afterA));
    ok("rewrite sent the old answer to the server", !!(sent && sent.answer && sent.answer.indexOf("5") >= 0), JSON.stringify(sent && sent.answer));

    // the tweak button shares that plumbing — prove it still works.
    // tweakItem calls window.prompt(); the blanket stub returns undefined, which
    // would make it bail out before sending anything.
    await q('window.prompt = function(){ return "make the numbers smaller"; };');
    await q('document.querySelector("' + R + '.li-tools button:nth-of-type(3)").click()');
    await sleep(1200);
    const afterTweakA = await q('document.querySelector("' + R + '.ws-answers > li").innerHTML');
    ok("tweak still updates the answer key", /tweaked key/.test(afterTweakA || ""), JSON.stringify(afterTweakA));

    // ---------- 6. the Questions control is hidden where the generator ignores it ----------
    // api/generate.js pins the item count for spelling (10 words + 2 tasks),
    // vocabulary (8 + 5 + 2) and writing (no questions at all), so showing a
    // "Questions" number there silently lied to the user.
    const countDisplay = async (subj) => {
      await q('(function(){var s=document.getElementById("subject");s.value=' + JSON.stringify(subj) + ';s.dispatchEvent(new Event("change"));})()');
      return q('(function(){var f=document.getElementById("countField");return f?getComputedStyle(f).display:null;})()');
    };
    ok("Questions control shown for Math", (await countDisplay("Math")) !== "none");
    ok("Questions control shown for Reading", (await countDisplay("Reading")) !== "none");
    ok("Questions control hidden for Spelling", (await countDisplay("Spelling")) === "none");
    ok("Questions control hidden for Vocabulary", (await countDisplay("Vocabulary")) === "none");
    ok("Questions control hidden for Writing", (await countDisplay("Writing")) === "none");

    // ---------- 7. the email box must appear after a PACK too (not just a single sheet) ----------
    await q('localStorage.setItem("wsai_plan","pro"); localStorage.removeItem("wsai_subbed");');
    await go();
    await q('(function(){ localStorage.removeItem("wsai_subbed"); document.getElementById("subject").value="Math"; document.getElementById("topic").value="addition"; var p=document.getElementById("pack"); p.value="5"; p.dispatchEvent(new Event("change")); document.getElementById("genForm").dispatchEvent(new Event("submit",{cancelable:true})); })()');
    await sleep(12000);
    const packNote = await q('document.getElementById("note").textContent');
    const subHidden = await q('(function(){var b=document.getElementById("subBox");return b?b.hidden:null;})()');
    console.log("   [info] pack note: " + JSON.stringify(packNote) + "  subBox.hidden=" + subHidden);
    ok("a 5-sheet pack was built", /5-sheet pack ready/.test(packNote || ""), JSON.stringify(packNote));
    ok("email box appears after a pack", subHidden === false, String(subHidden));

    // ---------- 8. touch emulation: no hover ----------
    await send(ws, "Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await send(ws, "Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await q('localStorage.setItem("wsai_plan","free")');
    await go();
    await generate();
    const hoverNone = await q('window.matchMedia("(hover: none)").matches');
    const coarse = await q('window.matchMedia("(pointer: coarse)").matches');
    const touchOpa = await q('(function(){var t=document.querySelector("' + R + '.li-tools");return t?getComputedStyle(t).opacity:null;})()');
    const touchPos = await q('(function(){var t=document.querySelector("' + R + '.li-tools");return t?getComputedStyle(t).position:null;})()');
    console.log("   [info] touch emulation: hover:none=" + hoverNone + " pointer:coarse=" + coarse);
    if (hoverNone || coarse) {
      ok("tools visible on a no-hover device", touchOpa === "1", String(touchOpa));
      ok("tools flow inline on a no-hover device", touchPos === "static", String(touchPos));
    } else {
      console.log("   [skip] this Edge build does not report hover:none under touch emulation");
    }

    // ---------- 9. no horizontal overflow at 390px ----------
    const overflow = await q("({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth })");
    ok("390px: no horizontal overflow", overflow && overflow.sw <= overflow.cw + 1, JSON.stringify(overflow));

    // ---------- 10. validation must NOT use a blocking alert() ----------
    // alert() froze the page and, on a phone, covered the freshly generated
    // worksheet. Every message now lands in #wsNotice. Count real alert() calls
    // by replacing window.alert with a counter, then submit with no topic.
    await q('window.__alertCount = 0; window.alert = function(){ window.__alertCount++; }; localStorage.removeItem("wsai_count_" + new Date().toISOString().slice(0,10));');
    await go();
    await q('window.__alertCount = 0; window.alert = function(){ window.__alertCount++; };');
    await q('(function(){ document.getElementById("subject").value="Math"; document.getElementById("subject").dispatchEvent(new Event("change")); document.getElementById("topic").value=""; document.getElementById("genForm").dispatchEvent(new Event("submit",{cancelable:true})); })()');
    await sleep(600);
    const alertCount = await q("window.__alertCount");
    const notice = await q('(function(){ var n=document.getElementById("wsNotice"); if(!n) return null; return { hidden: n.hidden, text: (n.textContent||"").trim().slice(0,70) }; })()');
    console.log("   [info] alert() calls after empty-topic submit: " + alertCount + "  notice=" + JSON.stringify(notice));
    ok("an empty topic does not call alert()", alertCount === 0, "alert called " + alertCount + " time(s)");
    ok("an empty topic shows an inline notice instead", !!notice && notice.hidden === false, JSON.stringify(notice));
    ok("the notice explains what to do", !!notice && /topic/i.test(notice.text || ""), JSON.stringify(notice));

    // ---------- 11. progressive disclosure must HIDE, not REMOVE ----------
    // Nine visible controls read like a settings panel, so the cosmetic ones now
    // live inside <details id="advOptions">. The critical contract: the controls
    // must still exist in the DOM (savePref / readPref / syncSubjectFields /
    // runGenerate read them by id) even while the section is collapsed.
    const adv = await q(`(function(){
      var d = document.getElementById('advOptions');
      if (!d) return null;
      var ids = ['font','size','style','studentName','pack'];
      var present = ids.filter(function(i){ return !!document.getElementById(i); });
      return { open: d.open, present: present.length, ids: ids.length,
               visible: d.getBoundingClientRect().height > 0 };
    })()`);
    console.log("   [info] advanced options: " + JSON.stringify(adv));
    ok("a collapsed More-options section exists", !!adv && adv.open === false, JSON.stringify(adv));
    ok("every folded control is still in the DOM", !!adv && adv.present === adv.ids, JSON.stringify(adv));

    // The two controls that change WHAT is practised must stay in plain sight.
    const coreVisible = await q(`(function(){
      function vis(id){ var e=document.getElementById(id); if(!e) return false;
        var r=e.getBoundingClientRect(); return r.height>0 && r.top < window.innerHeight*3; }
      return { count: vis('countField'), level: vis('level') };
    })()`);
    ok("Questions stays visible (not folded away)", coreVisible && coreVisible.count === true, JSON.stringify(coreVisible));
    ok("Level stays visible (not folded away)", coreVisible && coreVisible.level === true, JSON.stringify(coreVisible));

    // ---------- 12. the result toolbar is grouped, and no action was lost ----------
    // Six equal-weight buttons in one row read like debug controls. They are now
    // split into "use this sheet" (Print / Answer key / Pin) and "make a
    // different sheet" (Easier / Harder / All 3 levels / Another version).
    // The regression guards the regrouping, and above all that regrouping did not
    // silently drop a button.
    const tb = await q(`(function(){
      var t = document.querySelector('#resultWrap .toolbar');
      if (!t) return null;
      var row1 = t.querySelector('.tb-row-main');
      var row2 = t.querySelector('.tb-row-make');
      var ids = ['printBtn','keyToggle','pinBtn','levelEasierBtn','levelHarderBtn','levelSetBtn','regenBtn'];
      return {
        rows: t.querySelectorAll('.tb-row').length,
        row1: row1 ? row1.querySelectorAll('button,label').length : 0,
        row2: row2 ? row2.querySelectorAll('button').length : 0,
        allPresent: ids.filter(function(i){ return !!document.getElementById(i); }).length,
        idsTotal: ids.length,
        label: (t.querySelector('.tb-label')||{}).textContent || '',
        hint: (t.querySelector('.tb-hint')||{}).textContent || ''
      };
    })()`);
    console.log("   [info] toolbar: " + JSON.stringify({ rows: tb && tb.rows, row1: tb && tb.row1, row2: tb && tb.row2, allPresent: tb && tb.allPresent }));
    ok("the toolbar is split into two intent rows", !!tb && tb.rows === 2, JSON.stringify(tb));
    ok("row 1 holds Print / Pin / Answer key", !!tb && tb.row1 === 3, JSON.stringify(tb));
    ok("row 2 holds the four make-a-different-sheet actions", !!tb && tb.row2 === 4, JSON.stringify(tb));
    ok("regrouping dropped no action", !!tb && tb.allPresent === tb.idsTotal, JSON.stringify(tb));
    ok("row 2 is labelled so its purpose is obvious", !!tb && /different sheet/i.test(tb.label), JSON.stringify(tb));
    ok(
      "the explainer states the structural advantage (question 3 stays question 3)",
      !!tb && /question 3 stays question 3/i.test(tb.hint),
      JSON.stringify(tb.hint || "")
    );

    ws.close();
  } finally {
    try { edge.kill(); } catch (e) { /* ignore */ }
    srv.close();
  }

  console.log("\nfront-end UX checks: " + pass + "/" + (pass + fails.length) + " passed");
  if (fails.length) { console.log("FAILED:"); fails.forEach((x) => console.log("  - " + x)); process.exit(1); }
  console.log("ALL PASS");
})().catch((e) => { console.error("UX CHECK ERROR:", e.message); process.exit(1); });
