// CDP functional check: paywall modal, classroom block hidden, subscribe copy, prices intact.
const { spawn } = require("child_process");
const http = require("http");
const path = require("path");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const edge = spawn(EDGE, [
  "--headless=new", "--disable-gpu", "--no-sandbox",
  "--remote-debugging-port=9226",
  "--user-data-dir=" + path.join(process.cwd(), "_ep3"),
  "about:blank",
], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let wsUrl;
  for (let i = 0; i < 30; i++) {
    try {
      const d = await new Promise((res, rej) => {
        http.get("http://127.0.0.1:9226/json", (r) => { let b = ""; r.on("data", (c) => (b += c)); r.on("end", () => res(b)); }).on("error", rej);
      });
      const p = JSON.parse(d).filter((t) => t.type === "page");
      if (p.length) { wsUrl = p[0].webSocketDebuggerUrl; break; }
    } catch (e) { /* retry */ }
    await sleep(500);
  }
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pend = new Map();
  const send = (method, params) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Page.navigate", { url: "http://127.0.0.1:3000/" });
  await sleep(2500);
  const q = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true }); return r.result.value; };

  console.log("classroom hidden by default:", await q('document.getElementById("classroomBlock").hidden'));
  await q('document.getElementById("upsellBtn") && document.getElementById("upsellBtn").click()');
  await sleep(400);
  console.log("modal visible:", await q('!document.getElementById("paywall").hidden'));
  console.log("classroom still hidden inside modal:", await q('document.getElementById("classroomBlock").hidden'));
  console.log("Basic $13.30 intact:", await q('document.getElementById("paywall").textContent.includes("$13.30")'));
  console.log("30-day refund intact:", await q('document.getElementById("paywall").textContent.includes("30-day")'));
  console.log("compare table intact:", await q('document.getElementById("paywall").textContent.includes("Typical worksheet sites")'));
  console.log("home sub copy has Starter Pack:", await q('document.getElementById("homeSubBox").textContent.includes("Starter Pack")'));
  // simulate successful subscribe to confirm download link appears (mock fetch)
  await q('window._realFetch = window.fetch; window.fetch = (u, o) => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, provider: "test" }) });');
  await q('document.getElementById("homeSubEmail").value = "test@example.com"; document.getElementById("homeSubForm").dispatchEvent(new Event("submit", { cancelable: true }));');
  await sleep(600);
  console.log("success shows download link:", await q('document.getElementById("homeSubMsg").innerHTML.indexOf("/starter-pack.pdf") >= 0'));
  ws.close();
  edge.kill();
  process.exit(0);
})().catch((e) => { console.error("CHECK FAILED:", e.message); edge.kill(); process.exit(1); });
