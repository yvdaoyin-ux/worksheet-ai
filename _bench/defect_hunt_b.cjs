// Defect hunt B: mobile 390x844 experience — overflow, form, result, paywall, library.
const { spawn } = require("child_process");
const http = require("http");
const path = require("path");
const fs = require("fs");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const edge = spawn(EDGE, ["--headless=new", "--disable-gpu", "--no-sandbox", "--remote-debugging-port=9233", "--user-data-dir=" + path.join(process.cwd(), "_epC"), "--window-size=390,844", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HARD = setTimeout(() => { console.error("HARD TIMEOUT"); edge.kill(); process.exit(2); }, 300000);

(async () => {
  let wsUrl;
  for (let i = 0; i < 30; i++) {
    try {
      const d = await new Promise((res, rej) => { http.get("http://127.0.0.1:9233/json", (r) => { let b = ""; r.on("data", (c) => (b += c)); r.on("end", () => res(b)); }).on("error", rej); });
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
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send("Page.navigate", { url: "http://127.0.0.1:3000/" });
  await sleep(2500);
  const q = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true }); return r.result.value; };
  const shot = async (name) => {
    const s = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync("_mob_" + name + ".png", Buffer.from(s.data, "base64"));
  };
  const results = [];
  const check = (name, ok, detail) => { results.push({ name, ok }); console.log(ok ? "PASS" : "FAIL", name, detail ? ("| " + detail) : ""); };

  // 1. homepage: no horizontal overflow
  const overflow = await q('({w: document.documentElement.scrollWidth, iw: window.innerWidth})');
  check("home: no horizontal overflow", overflow.w <= 391, "scrollWidth=" + overflow.w + " innerWidth=" + overflow.iw);
  const genVisible = await q('(function(){ const b=document.getElementById("genBtn").getBoundingClientRect(); return b.top < window.innerHeight && b.left >= 0 && b.right <= 391; })()');
  check("home: generate button in viewport", genVisible === true);
  await shot("home");

  // 2. generate on mobile
  await q('localStorage.setItem("wsai_plan","basic")');
  await q(`(function(){ document.getElementById("subject").value="Math"; document.getElementById("topic").value="mobile test fractions"; document.getElementById("genForm").dispatchEvent(new Event("submit",{cancelable:true})); })()`);
  for (let t = 0; t < 50; t++) { await sleep(1000); if (await q('!document.getElementById("genBtn").disabled')) break; }
  await sleep(600);
  const resOverflow = await q('({w: document.documentElement.scrollWidth, iw: window.innerWidth})');
  check("result: no horizontal overflow", resOverflow.w <= 391, "scrollWidth=" + resOverflow.w);
  // fraction stacked rendering not broken on mobile
  const fracOk = await q('!!document.querySelector("#result .frac .num")');
  check("result: fractions rendered", fracOk === true);
  // toolbar buttons present and within screen
  const tb = await q(`(function(){
    const ids=["pinBtn","keyToggle"];
    let out={};
    ids.forEach(function(id){ const el=document.getElementById(id); if(!el){out[id]="missing";return;}
      const r=el.getBoundingClientRect(); out[id]=(r.width>0 && r.right<=392)?"ok":"offscreen:"+Math.round(r.right); });
    return out; })()`);
  check("result: pin + key toggle on screen", JSON.stringify(tb).indexOf("offscreen") < 0 && JSON.stringify(tb).indexOf("missing") < 0, JSON.stringify(tb));
  await q('document.getElementById("result").scrollIntoView()');
  await sleep(400);
  await shot("result");

  // 3. paywall on mobile
  await q('document.getElementById("upsellBtn") ? document.getElementById("upsellBtn").click() : document.getElementById("paywall").hidden=false;');
  await sleep(500);
  const pw = await q(`(function(){
    const m=document.querySelector("#paywall .modal");
    if(!m) return "no-modal";
    const r=m.getBoundingClientRect();
    return { w: Math.round(r.width), right: Math.round(r.right), fits: r.left>=0 && r.right<=391, scrollable: m.scrollHeight>m.clientHeight+2 };
  })()`);
  check("paywall: modal fits 390px", pw && pw.fits === true, JSON.stringify(pw));
  await shot("paywall");

  // 4. library rows on mobile
  await q('document.getElementById("paywall").hidden=true');
  const lib = await q(`(function(){
    const box=document.getElementById("recentBox");
    if(!box || box.hidden) return "hidden";
    const r=box.getBoundingClientRect();
    return box.scrollWidth<=391 && r.width>0 ? "ok" : "overflow:"+box.scrollWidth;
  })()`);
  check("library fits mobile width", lib === "ok", String(lib));

  const fails = results.filter((r) => !r.ok).length;
  console.log(fails === 0 ? "ALL " + results.length + " CHECKS PASS" : fails + " FAILURES");
  clearTimeout(HARD);
  ws.close(); edge.kill(); process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error("TEST ERROR:", e.message); clearTimeout(HARD); edge.kill(); process.exit(1); });
