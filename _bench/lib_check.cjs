// Functional test v2: library/pin/toggle with quota-aware plan handling.
const { spawn } = require("child_process");
const http = require("http");
const path = require("path");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const edge = spawn(EDGE, [
  "--headless=new", "--disable-gpu", "--no-sandbox",
  "--remote-debugging-port=9228",
  "--user-data-dir=" + path.join(process.cwd(), "_ep5"),
  "--window-size=1100,2400",
  "about:blank",
], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let wsUrl;
  for (let i = 0; i < 30; i++) {
    try {
      const d = await new Promise((res, rej) => {
        http.get("http://127.0.0.1:9228/json", (r) => { let b = ""; r.on("data", (c) => (b += c)); r.on("end", () => res(b)); }).on("error", rej);
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

  const results = [];
  const check = (name, ok, detail) => { results.push({ name, ok }); console.log(ok ? "PASS" : "FAIL", name, detail ? ("| " + detail) : ""); };

  // Basic plan: unlimited math, unlimited pins.
  await q('localStorage.setItem("wsai_plan","basic")');
  await q('window.alert = function(){};');
  await send("Page.navigate", { url: "http://127.0.0.1:3000/" });
  await sleep(2200);

  // 1. generate 3 sheets and pin each
  let prevResult = "";
  for (let i = 0; i < 2; i++) {
    let ok = false;
    for (let attempt = 0; attempt < 2 && !ok; attempt++) {
      await q(`(function(){ document.getElementById("subject").value="Math"; document.getElementById("topic").value="library test ${i + 1}"; document.getElementById("genForm").dispatchEvent(new Event("submit",{cancelable:true})); })()`);
      for (let t = 0; t < 45; t++) { await sleep(1000); if (await q('!document.getElementById("genBtn").disabled')) break; }
      await sleep(400);
      const now = await q('document.getElementById("result").innerHTML');
      ok = typeof now === "string" && now.length > 40 && now !== prevResult;
      if (ok) prevResult = now;
    }
    check("sheet " + (i + 1) + " generated", ok === true);
    const st = await q('(function(){ document.getElementById("pinBtn").click(); return document.getElementById("pinBtn").textContent; })()');
    check("sheet " + (i + 1) + " pins (basic)", st === "★ Pinned", st);
  }
  const favCount = await q('JSON.parse(localStorage.getItem("wsai_favs")||"[]").length');
  check("2 favorites stored", favCount === 2, "count=" + favCount);

  // 2. library rows + reopen
  const libText = await q('document.getElementById("recentBox").textContent');
  check("library has Pinned row", String(libText).indexOf("Pinned") >= 0);
  check("library has Recent row", String(libText).indexOf("Recent") >= 0);
  const reopened = await q(`(function(){
    const entry=(JSON.parse(localStorage.getItem("wsai_hist")||"[]")||[]).find(function(x){return x.topic==="library test 1";});
    if(!entry) return "no-history-entry";
    const d=document.createElement("div"); d.innerHTML=entry.html;
    const wantTitle=(d.querySelector(".ws-title")||{textContent:""}).textContent.trim();
    const chips=[...document.querySelectorAll("#recentBox .chip")];
    const recent=chips.find(c=>(c.title||"").indexOf("Reprint")===0 && c.textContent.indexOf("library test 1")>=0);
    if(!recent) return "chip-not-found";
    recent.click();
    const gotTitle=((document.querySelector("#result .ws-title")||{}).textContent||"").trim();
    return wantTitle && gotTitle===wantTitle ? "repainted" : "title-mismatch:"+JSON.stringify(wantTitle)+" vs "+JSON.stringify(gotTitle);
  })()`);
  check("library chip repaints the stored sheet", reopened === "repainted", String(reopened).slice(0,80));

  // 3. answer-key toggle both ways (IIFE so consts don't collide)
  const t1 = await q(`(function(){ var kt=document.getElementById("keyToggle"); kt.checked=false; kt.dispatchEvent(new Event("change")); return document.body.classList.contains("print-no-key"); })()`);
  check("toggle off sets print-no-key", t1 === true);
  const cssHasRule = await q(`(function(){ var out=false; [...document.styleSheets].forEach(function(ss){ try{ var rules=[...ss.cssRules]; rules.forEach(function(r){ try{ if((r.selectorText||"").indexOf("print-no-key")>=0) out=true; if(r.media){ [...r.cssRules].forEach(function(rr){ if((rr.selectorText||"").indexOf("print-no-key")>=0) out=true; }); } }catch(e){} }); }catch(e){} }); return out; })()`);
  check("print-no-key CSS rule shipped", cssHasRule === true, String(cssHasRule));
  const t2 = await q(`(function(){ var kt=document.getElementById("keyToggle"); kt.checked=true; kt.dispatchEvent(new Event("change")); return document.body.classList.contains("print-no-key"); })()`);
  check("toggle on removes class", t2 === false);
  const persisted = await q('localStorage.getItem("wsai_print_key")');
  check("toggle preference stored", persisted === "1", persisted);

  // 4. FREE favorites wall: free plan + 3 seeded favs + reopen a different sheet + pin
  await q(`(function(){
    localStorage.setItem("wsai_plan","free");
    var seed={t:Date.now(),grade:"3",subject:"Math",topic:"pinwall seed",html:'<h2 class="ws-title">Pinwall Seed</h2><ol class="ws-questions"><li>q</li></ol><hr class="ws-pagebreak"><h3 class="ws-answers-title">Answer Key</h3><ol class="ws-answers"><li>a</li></ol>'};
    var favs=[0,1,2].map(function(i){ return Object.assign({},seed,{topic:"pinwall seed "+i}); });
    localStorage.setItem("wsai_favs",JSON.stringify(favs));
  })()`);
  await send("Page.navigate", { url: "http://127.0.0.1:3000/" });
  await sleep(2200);
  const wallResult = await q(`(function(){
    var chips=[...document.querySelectorAll("#recentBox .chip")];
    var recent=chips.find(function(c){return (c.title||"").indexOf("Reprint")===0 && c.textContent.indexOf("library test")>=0;});
    if(!recent) return "chip-not-found";
    recent.click();
    document.getElementById("pinBtn").click();
    return { wall: !document.getElementById("paywall").hidden, pin: document.getElementById("pinBtn").textContent };
  })()`);
  check("4th pin on FREE opens paywall", wallResult && wallResult.wall === true, JSON.stringify(wallResult));

  // 5. persistence across reload
  const libAfter = await q('document.getElementById("recentBox").textContent');
  check("library survives reload", String(libAfter).indexOf("Pinned") >= 0 && String(libAfter).indexOf("Recent") >= 0);

  const fails = results.filter((r) => !r.ok).length;
  console.log(fails === 0 ? "ALL " + results.length + " CHECKS PASS" : fails + " FAILURES");
  ws.close();
  edge.kill();
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error("TEST ERROR:", e.message); edge.kill(); process.exit(1); });
