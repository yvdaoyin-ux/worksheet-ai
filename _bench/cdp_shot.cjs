// CDP screenshot of a local page (per handover package 03-C method).
const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9224;
const URL_TO_OPEN = process.argv[2] || "http://127.0.0.1:3000/worksheets/3rd-grade-fractions-worksheets/";
const OUT = process.argv[3] || "_frac_check.png";

const edge = spawn(EDGE, [
  "--headless=new", "--disable-gpu", "--no-sandbox",
  "--remote-debugging-port=" + PORT,
  "--user-data-dir=" + __dirname + "\\_edgeprof",
  "--window-size=900,2400",
  "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getWsUrl() {
  for (let i = 0; i < 30; i++) {
    try {
      const data = await new Promise((res, rej) => {
        http.get("http://127.0.0.1:" + PORT + "/json", (r) => {
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

let msgId = 0;
const pending = new Map();
function send(ws, method, params) {
  return new Promise((res, rej) => {
    const id = ++msgId;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

(async () => {
  const wsUrl = await getWsUrl();
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id).res(m.result); pending.delete(m.id); }
  };
  await send(ws, "Page.enable");
  await send(ws, "Page.navigate", { url: URL_TO_OPEN });
  await sleep(3500); // let app.js render
  const shot = await send(ws, "Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(OUT, Buffer.from(shot.data, "base64"));
  console.log("saved", OUT, fs.statSync(OUT).size, "bytes");
  ws.close();
  edge.kill();
  process.exit(0);
})().catch((e) => { console.error(e.message); edge.kill(); process.exit(1); });
