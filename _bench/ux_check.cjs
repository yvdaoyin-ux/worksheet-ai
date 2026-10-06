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
//   4. no horizontal overflow at 390px.
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
    if (url.pathname === "/api/generate") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => json({ html: STUB_HTML, checked: true, model: "stub" }));
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

    // ---------- 5. touch emulation: no hover ----------
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

    // ---------- 6. no horizontal overflow at 390px ----------
    const overflow = await q("({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth })");
    ok("390px: no horizontal overflow", overflow && overflow.sw <= overflow.cw + 1, JSON.stringify(overflow));

    ws.close();
  } finally {
    try { edge.kill(); } catch (e) { /* ignore */ }
    srv.close();
  }

  console.log("\nfront-end UX checks: " + pass + "/" + (pass + fails.length) + " passed");
  if (fails.length) { console.log("FAILED:"); fails.forEach((x) => console.log("  - " + x)); process.exit(1); }
  console.log("ALL PASS");
})().catch((e) => { console.error("UX CHECK ERROR:", e.message); process.exit(1); });
