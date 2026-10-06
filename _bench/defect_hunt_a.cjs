// Defect hunt A: print toggle page counts, landing-page integration, watermark on reopen.
const { spawn } = require("child_process");
const http = require("http");
const path = require("path");
const fs = require("fs");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const edge = spawn(EDGE, ["--headless=new", "--disable-gpu", "--no-sandbox", "--remote-debugging-port=9231", "--user-data-dir=" + path.join(process.cwd(), "_epA"), "--window-size=1100,2400", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let wsUrl;
  for (let i = 0; i < 30; i++) {
    try {
      const d = await new Promise((res, rej) => { http.get("http://127.0.0.1:9231/json", (r) => { let b = ""; r.on("data", (c) => (b += c)); r.on("end", () => res(b)); }).on("error", rej); });
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
  const genAndWait = async (topic) => {
    await q(`(function(){ document.getElementById("subject").value="Math"; document.getElementById("topic").value="${topic}"; document.getElementById("genForm").dispatchEvent(new Event("submit",{cancelable:true})); })()`);
    for (let t = 0; t < 50; t++) { await sleep(1000); if (await q('!document.getElementById("genBtn").disabled')) break; }
    await sleep(500);
  };
  const pdfPages = async (name) => {
    const shot = await send("Page.printToPDF", { printBackground: false, preferCSSPageSize: true });
    fs.writeFileSync("_cnt_" + name + ".pdf", Buffer.from(shot.data, "base64"));
    const raw = fs.readFileSync("_cnt_" + name + ".pdf");
    const m = raw.toString("latin1").match(/\/Count (\d+)/);
    if (!m) {
      for (const mm of raw.toString("latin1").matchAll(/stream\r?\n/g)) {
        const seg = raw.slice(mm.index + 8);
        const e = seg.indexOf("endstream");
        try {
          const zlib = require("zlib");
          const d = zlib.inflateSync(seg.slice(0, e));
          const c = d.toString("latin1").match(/\/Count (\d+)/);
          if (c) return parseInt(c[1], 10);
        } catch (e) { /* skip */ }
      }
      return -1;
    }
    return parseInt(m[1], 10);
  };

  // basic plan for unlimited generation
  await q('localStorage.setItem("wsai_plan","basic")');
  await send("Page.navigate", { url: "http://127.0.0.1:3000/" });
  await sleep(2200);

  // 1. single sheet: key on = 2 pages, key off = 1 page
  await genAndWait("print count test A");
  await q('var kt=document.getElementById("keyToggle"); kt.checked=true; kt.dispatchEvent(new Event("change"));');
  const on1 = await pdfPages("single_on");
  await q('var kt=document.getElementById("keyToggle"); kt.checked=false; kt.dispatchEvent(new Event("change"));');
  const off1 = await pdfPages("single_off");
  check("single: key on = 2 pages", on1 === 2, "got " + on1);
  check("single: key off = 1 page", off1 === 1, "got " + off1);

  // 2. pack of 3: key on = 4 pages, key off = 3 pages
  await q('var pk=document.getElementById("pack"); pk.value="3"; pk.dispatchEvent(new Event("change"));');
  await genAndWait("print count pack test");
  for (let t = 0; t < 90; t++) { await sleep(1000); if (await q('!document.getElementById("genBtn").disabled')) break; }
  await sleep(800);
  await q('var kt=document.getElementById("keyToggle"); kt.checked=true; kt.dispatchEvent(new Event("change"));');
  const onP = await pdfPages("pack_on");
  await q('var kt=document.getElementById("keyToggle"); kt.checked=false; kt.dispatchEvent(new Event("change"));');
  const offP = await pdfPages("pack_off");
  check("pack of 3: key on = 4 pages", onP === 4, "got " + onP);
  check("pack of 3: key off = 3 pages (no blank page)", offP === 3, "got " + offP);
  await q('var kt=document.getElementById("keyToggle"); kt.checked=true; kt.dispatchEvent(new Event("change"));');

  // 3. landing page: toggle exists, seasonal chip, library shared, reopen works
  await send("Page.navigate", { url: "http://127.0.0.1:3000/worksheets/3rd-grade-fractions-worksheets/" });
  await sleep(2500);
  check("landing has keyToggle", (await q('!!document.getElementById("keyToggle")')) === true);
  check("landing shows seasonal chip", (await q('[...document.querySelectorAll("#topicChips .chip")].some(c=>c.classList.contains("chip-season"))')) === true);
  const libOnLanding = await q('document.getElementById("recentBox") ? document.getElementById("recentBox").textContent : "none"');
  check("landing shares the library", String(libOnLanding).indexOf("Recent") >= 0, String(libOnLanding).slice(0, 50));
  const landReopen = await q(`(function(){
    const chips=[...document.querySelectorAll("#recentBox .chip")];
    const recent=chips.find(c=>(c.title||"").indexOf("Reprint")===0);
    if(!recent) return "no-chip";
    recent.click();
    return document.getElementById("result").textContent.length>40 ? "repainted" : "empty";
  })()`);
  check("landing library chip repaints", landReopen === "repainted", String(landReopen));

  // 4. free plan: reopened sheet carries the watermark
  await q('localStorage.setItem("wsai_plan","free")');
  await send("Page.navigate", { url: "http://127.0.0.1:3000/" });
  await sleep(2200);
  await q(`(function(){ const chips=[...document.querySelectorAll("#recentBox .chip")]; const c=chips.find(c=>(c.title||"").indexOf("Reprint")===0); if(c) c.click(); })()`);
  await sleep(600);
  const wm = await q('!!document.querySelector("#result .watermark")');
  check("free user: reopened sheet has watermark", wm === true);

  // 5. reopen then "Another version" uses the right context and adds to library
  await q('localStorage.setItem("wsai_plan","basic")');
  await send("Page.navigate", { url: "http://127.0.0.1:3000/" });
  await sleep(2200);
  const histBefore = await q('JSON.parse(localStorage.getItem("wsai_hist")||"[]").length');
  await q(`(function(){ const chips=[...document.querySelectorAll("#recentBox .chip")]; const c=chips.find(c=>(c.title||"").indexOf("Reprint")===0); if(c) c.click(); })()`);
  await sleep(400);
  await q('document.getElementById("regenBtn").click()');
  for (let t = 0; t < 50; t++) { await sleep(1000); if (await q('!document.getElementById("genBtn").disabled')) break; }
  await sleep(500);
  const histAfter = await q('JSON.parse(localStorage.getItem("wsai_hist")||"[]").length');
  const regenNote = await q('document.getElementById("note") ? document.getElementById("note").textContent : ""');
  check("regen after reopen adds to library", histAfter === histBefore + 1, histBefore + "->" + histAfter + " | " + String(regenNote).slice(0, 50));

  const fails = results.filter((r) => !r.ok).length;
  console.log(fails === 0 ? "ALL " + results.length + " CHECKS PASS" : fails + " FAILURES");
  ws.close(); edge.kill(); process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error("TEST ERROR:", e.message); edge.kill(); process.exit(1); });
