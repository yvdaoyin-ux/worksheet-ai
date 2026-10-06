// Progress bar test: SSE stages during a real generation.
const { spawn } = require("child_process");
const http = require("http");
const path = require("path");
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const edge = spawn(EDGE, ["--headless=new", "--disable-gpu", "--no-sandbox", "--remote-debugging-port=9234", "--user-data-dir=" + path.join(process.cwd(), "_epD"), "--window-size=1100,2000", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  let wsUrl;
  for (let i = 0; i < 30; i++) {
    try {
      const d = await new Promise((res, rej) => { http.get("http://127.0.0.1:9234/json", (r) => { let b = ""; r.on("data", (c) => (b += c)); r.on("end", () => res(b)); }).on("error", rej); });
      const p = JSON.parse(d).filter((t) => t.type === "page");
      if (p.length) { wsUrl = p[0].webSocketDebuggerUrl; break; }
    } catch (e) { /* retry */ }
    await sleep(500);
  }
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pend = new Map();
  const send = (m, p) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
  await send("Page.enable"); await send("Runtime.enable");
  await send("Page.navigate", { url: "http://127.0.0.1:3000/" });
  await sleep(2500);
  const q = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true }); return r.result.value; };
  let fail = 0;
  const check = (n, ok, d) => { if (!ok) fail++; console.log(ok ? "PASS" : "FAIL", n, d ? "| " + d : ""); };

  await q('localStorage.setItem("wsai_plan","basic")');
  await q('window.alert = function(){};');
  await q(`(function(){ document.getElementById("subject").value="Math"; document.getElementById("topic").value="progress bar test"; document.getElementById("genForm").dispatchEvent(new Event("submit",{cancelable:true})); })()`);
  await sleep(1800);
  const early = await q(`(function(){ const b=document.getElementById("genProgress"); if(!b||b.hidden) return "hidden";
    const label=document.querySelector("#genProgress .gp-label").textContent;
    const w=parseFloat(document.querySelector("#genProgress .gp-fill").style.width);
    return {label: label.slice(0,45), width: w}; })()`);
  check("progress visible early with % and seconds", early && early.label && early.label.indexOf("Writing") === 0 && early.width > 0 && early.width < 60, JSON.stringify(early));
  await sleep(4000);
  const mid = await q(`(function(){ const b=document.getElementById("genProgress"); if(!b||b.hidden) return "hidden";
    return { label: document.querySelector("#genProgress .gp-label").textContent.slice(0,45), w: parseFloat(document.querySelector("#genProgress .gp-fill").style.width) }; })()`);
  check("stage advanced (label/percent moving)", mid && mid.label && (mid.label.indexOf("Checking") === 0 || mid.w > parseFloat(early.width)), JSON.stringify(mid));
  for (let t = 0; t < 240; t++) { await sleep(1000); if (await q('!document.getElementById("genBtn").disabled')) break; }
  await sleep(400);
  const done = await q(`(function(){ const b=document.getElementById("genProgress");
    return { painted: document.getElementById("result").textContent.length > 40, still: b && !b.hidden }; })()`);
  check("sheet painted after progress", done.painted === true);
  await sleep(1200);
  const hidden = await q('document.getElementById("genProgress").hidden');
  check("progress hides after done", hidden === true);
  console.log(fail === 0 ? "ALL PASS" : fail + " FAILURES");
  ws.close(); edge.kill(); process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error("TEST ERROR:", e.message); edge.kill(); process.exit(1); });
