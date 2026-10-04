// server.js — zero-dependency local dev server.
// Lets you run the whole app with just `node server.js` (no Vercel CLI needed).
// It loads .env, serves index.html, and routes /api/* to the same handlers
// used in production (api/generate.js, api/verify-license.js).

const http = require("http");
const fs = require("fs");
const path = require("path");

// --- tiny .env loader (no dependency) ---
(function loadEnv() {
  try {
    const txt = fs.readFileSync(path.join(__dirname, ".env"), "utf8");
    txt.split(/\r?\n/).forEach((line) => {
      if (/^\s*#/.test(line)) return;
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in process.env)) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    });
  } catch {
    /* no .env — fine, runs in demo mode */
  }
})();

const generate = require("./api/generate.js");
const verifyLicense = require("./api/verify-license.js");

const PORT = process.env.PORT || 3000;
const ROUTES = {
  "/api/generate": generate,
  "/api/verify-license": verifyLicense,
};

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        resolve({});
      }
    });
  });
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const server = http.createServer(async (req, res) => {
  const pathname = decodeURIComponent((req.url || "/").split("?")[0]);

  // --- API routes ---
  if (ROUTES[pathname]) {
    req.body = await readBody(req);
    const wrapped = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(obj) {
        const payload = JSON.stringify(obj);
        res.writeHead(this.statusCode, { "Content-Type": MIME[".json"] });
        res.end(payload);
        return this;
      },
    };
    try {
      await ROUTES[pathname](req, wrapped);
    } catch (e) {
      res.writeHead(500, { "Content-Type": MIME[".json"] });
      res.end(JSON.stringify({ error: String(e) }));
    }
    return;
  }

  // --- static files ---
  let rel = pathname === "/" ? "/index.html" : pathname;
  let full = path.join(__dirname, rel);
  if (!full.startsWith(__dirname)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  try {
    if (fs.statSync(full).isDirectory()) full = path.join(full, "index.html");
  } catch {
    /* not found — fall through to readFile error */
  }
  fs.readFile(full, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found: " + rel);
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(full)] || "application/octet-stream" });
    res.end(data);
  });
});

server.listen(PORT, () => {
  const provider = process.env.OPENROUTER_API_KEY
    ? "REAL via OpenRouter"
    : process.env.GEMINI_API_KEY
    ? "REAL via Gemini"
    : "DEMO (no API key — sample worksheets)";
  console.log("\n  WorksheetAI is running:  http://localhost:" + PORT + "\n");
  console.log("  AI mode: " + provider);
  console.log("  Press Ctrl+C to stop.\n");
});
