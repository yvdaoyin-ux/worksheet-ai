// Diagnose the browser-side failure: capture console + exceptions during a real generate.
const { spawn } = require("child_process");
const http = require("http");
const path = require("path");
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const edge = spawn(EDGE, ["--headless=new", "--disable-gpu", "--no-sandbox", "--remote-debugging-port=9235", "--user-data-dir=" + path.join(process.cwd(), "_epE"), "--window-size=1100,2000", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  let wsUrl;
  for (let i = 0; i < 30; i++) {
    try {
      const d = await new Promise((res, rej) => { http.get("http://127.0.0.1:9235/json", (r) => { let b = ""; r.on("data", (c) => (b += c)); r.on("end", () => res(b)); }).on("error", rej); });
      const p = JSON.parse(d).filter((t) => t.type === "page");
      if (p.length) { wsUrl = p[0].webSocketDebuggerUrl; break; }
    } catch (e) { /* retry */ }
    await sleep(500);
  }
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pend = new Map();
  const send = (m, p) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); return; }
    if (m.method === "Runtime.consoleAPICalled") {
      const args = (m.params.args || []).map((a) => a.value !== undefined ? a.value : (a.description || a.type)).join(" ");
      console.log("CONSOLE[" + m.params.type + "]:", String(args).slice(0, 200));
    }
    if (m.method === "Runtime.exceptionThrown") {
      const d = m.params.exceptionDetails;
      console.log("EXCEPTION:", (d.exception && (d.exception.description || d.exception.value)) || d.text);
    }
    if (m.method === "Network.responseReceived") {
      const u = m.params.response.url;
      if (u.indexOf("/api/") >= 0) console.log("NET:", m.params.response.status, u, "| ct:", m.params.response.headers["content-type"] || m.params.response.headers["Content-Type"] || "(none)");
    }
  };
  await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");
  await send("Page.navigate", { url: "http://127.0.0.1:3000/" });
  await sleep(2500);
  const q = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); return r.result ? r.result.value : undefined; };
  await q('localStorage.setItem("wsai_plan","basic")');
  await q('window.alert = function(m){ console.log("ALERT:", m); };');
  // Direct fetch inside the page to see the raw behavior of generateOnce's fetch
  const probe = await q(`(async function(){
    try {
      var tk = await fetch("/api/gate").then(r=>r.json());
      var res = await fetch("/api/generate", { method:"POST", headers:{ "Content-Type":"application/json", "x-gate": tk.ticket }, body: JSON.stringify({ grade:"3", subject:"Math", topic:"probe fractions", count:5, stream:1 }) });
      return { status: res.status, ct: res.headers.get("content-type"), hasBody: !!res.body };
    } catch(e) { return { fetchError: String(e) }; }
  })()`);
  console.log("PROBE:", JSON.stringify(probe));
  // Now run the real flow and watch
  await q(`(function(){ document.getElementById("subject").value="Math"; document.getElementById("topic").value="browser flow check"; document.getElementById("genForm").dispatchEvent(new Event("submit",{cancelable:true})); })()`);
  for (let t = 0; t < 120; t++) { await sleep(1000); if (await q('!document.getElementById("genBtn").disabled')) break; }
  await sleep(500);
  const painted = await q('document.getElementById("result").textContent.length > 40');
  const noteTxt = await q('document.getElementById("note") ? document.getElementById("note").textContent : ""');
  console.log("RESULT painted:", painted, "| note:", String(noteTxt).slice(0, 60));
  ws.close(); edge.kill(); process.exit(0);
})().catch((e) => { console.error("DIAG ERROR:", e.message); edge.kill(); process.exit(1); });
