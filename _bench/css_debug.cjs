// Debug: does the loaded page's app.css contain the print-no-key rule?
const { spawn } = require("child_process");
const http = require("http");
const path = require("path");
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const edge = spawn(EDGE, ["--headless=new", "--disable-gpu", "--no-sandbox", "--remote-debugging-port=9229", "--user-data-dir=" + path.join(process.cwd(), "_ep6"), "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  let wsUrl;
  for (let i = 0; i < 30; i++) {
    try {
      const d = await new Promise((res, rej) => { http.get("http://127.0.0.1:9229/json", (r) => { let b = ""; r.on("data", (c) => (b += c)); r.on("end", () => res(b)); }).on("error", rej); });
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
  console.log("sheet hrefs:", JSON.stringify(await q('[...document.styleSheets].map(s=>s.href)')));
  console.log("rule scan:", JSON.stringify(await q(`(function(){
    var out=[];
    [...document.styleSheets].forEach(function(ss,si){
      var n=0, found=false;
      try { var rules=[...ss.cssRules]; n=rules.length;
        rules.forEach(function(r){ try{ if((r.selectorText||"").indexOf("print-no-key")>=0) found=true; if(r.media){ [...r.cssRules].forEach(function(rr){ if((rr.selectorText||"").indexOf("print-no-key")>=0) found=true; }); } }catch(e){} });
      } catch(e) { out.push(si+":ERR "+e.message); return; }
      out.push(si+(ss.href?" link":" inline")+" rules="+n+" found="+found);
    });
    return out;
  })()`)));
  console.log("body class now:", await q('document.body.className'));
  console.log("keyToggle exists:", await q('!!document.getElementById("keyToggle")'));
  ws.close(); edge.kill(); process.exit(0);
})().catch((e) => { console.error(e.message); edge.kill(); process.exit(1); });
