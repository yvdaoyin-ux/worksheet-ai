// Defect hunt A2: real pack (5 sheets) page counts + regen-after-reopen.
const { spawn } = require("child_process");
const http = require("http");
const path = require("path");
const fs = require("fs");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const edge = spawn(EDGE, ["--headless=new", "--disable-gpu", "--no-sandbox", "--remote-debugging-port=9232", "--user-data-dir=" + path.join(process.cwd(), "_epB"), "--window-size=1100,2400", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HARD = setTimeout(() => { console.error("HARD TIMEOUT"); edge.kill(); process.exit(2); }, 420000);

(async () => {
  let wsUrl;
  for (let i = 0; i < 30; i++) {
    try {
      const d = await new Promise((res, rej) => { http.get("http://127.0.0.1:9232/json", (r) => { let b = ""; r.on("data", (c) => (b += c)); r.on("end", () => res(b)); }).on("error", rej); });
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
  const results = [];
  const check = (name, ok, detail) => { results.push({ name, ok }); console.log(ok ? "PASS" : "FAIL", name, detail ? ("| " + detail) : ""); };
  const pdfPages = async (name) => {
    const shot = await send("Page.printToPDF", { printBackground: false, preferCSSPageSize: true });
    const raw = Buffer.from(shot.data, "base64");
    fs.writeFileSync("_cnt_" + name + ".pdf", raw);
    const m = raw.toString("latin1").match(/\/Count (\d+)/);
    return m ? parseInt(m[1], 10) : -1;
  };

  await q('localStorage.setItem("wsai_plan","basic")');
  await send("Page.navigate", { url: "http://127.0.0.1:3000/" });
  await sleep(2200);

  // real pack of 5
  await q('var pk=document.getElementById("pack"); pk.value="5"; pk.dispatchEvent(new Event("change"));');
  await q(`(function(){ document.getElementById("subject").value="Math"; document.getElementById("topic").value="pack print test"; document.getElementById("genForm").dispatchEvent(new Event("submit",{cancelable:true})); })()`);
  for (let t = 0; t < 150; t++) { await sleep(1000); if (await q('!document.getElementById("genBtn").disabled')) break; }
  await sleep(800);
  const packHead = await q('document.querySelector(".ws-pack-head") ? document.querySelector(".ws-pack-head").textContent : "no-pack"');
  check("pack of 5 rendered", String(packHead).indexOf("5-sheet pack") >= 0, String(packHead).slice(0, 40));
  await q('var kt=document.getElementById("keyToggle"); kt.checked=true; kt.dispatchEvent(new Event("change"));');
  const onP = await pdfPages("pack5_on");
  await q('var kt=document.getElementById("keyToggle"); kt.checked=false; kt.dispatchEvent(new Event("change"));');
  const offP = await pdfPages("pack5_off");
  check("pack 5: key on = 6 pages (5 sheets + key page)", onP === 6, "got " + onP);
  check("pack 5: key off = 5 pages, no blank", offP === 5, "got " + offP);

  // regen after reopen adds to library
  const histBefore = await q('JSON.parse(localStorage.getItem("wsai_hist")||"[]").length');
  await q('var kt=document.getElementById("keyToggle"); kt.checked=true; kt.dispatchEvent(new Event("change"));');
  await q(`(function(){ const chips=[...document.querySelectorAll("#recentBox .chip")]; const c=chips.find(c=>(c.title||"").indexOf("Reprint")===0); if(c) c.click(); })()`);
  await sleep(500);
  await q('document.getElementById("regenBtn").click()');
  for (let t = 0; t < 50; t++) { await sleep(1000); if (await q('!document.getElementById("genBtn").disabled')) break; }
  await sleep(500);
  const histAfter = await q('JSON.parse(localStorage.getItem("wsai_hist")||"[]").length');
  check("regen after reopen adds to library", histAfter === histBefore + 1, histBefore + "->" + histAfter);

  const fails = results.filter((r) => !r.ok).length;
  console.log(fails === 0 ? "ALL " + results.length + " CHECKS PASS" : fails + " FAILURES");
  clearTimeout(HARD);
  ws.close(); edge.kill(); process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error("TEST ERROR:", e.message); clearTimeout(HARD); edge.kill(); process.exit(1); });
