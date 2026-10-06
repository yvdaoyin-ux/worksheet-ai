// lib/guard.js — shared anti-abuse helpers for the /api endpoints.
// NOT an endpoint itself: helpers live in lib/ (see AGENTS.md rule: api/ is
// one file = one endpoint).
//
// Three layers, all stateless (no database):
//   1. ORIGIN CHECK   — browsers always send Origin/Referer on cross-site
//                       POSTs; our own pages send our own host. A raw script
//                       (curl) sends neither. Cheap, kills the lazy 90%.
//   2. GATE TICKET    — the page first GETs /api/gate for an HMAC-signed
//                       ticket (TTL ~90 min) and sends it as x-gate. A script
//                       must now fetch the page first, then the ticket. Beats
//                       copy-paste scrapers; determined attackers move on to
//                       the rate limits below, which is by design.
//   3. SPEND CEILING  — GLOBAL_DAILY_BUDGET caps the whole site's generations
//                       per day (Upstash when configured, per-instance memory
//                       otherwise), so worst-case API spend is bounded even
//                       with IP rotation.
//
// GATE_OFF=1 disables layers 1–2 (kill switch). Keys for the HMAC come from
// GATE_SECRET when set, else derived from the provider keys — so it works
// with zero new configuration.

const crypto = require("crypto");

const TTL_MS = 90 * 60 * 1000;

function allowedHosts() {
  const list = new Set([
    "worksheet-ai-l1td.vercel.app",
    "localhost:3000",
    "127.0.0.1:3000",
  ]);
  String(process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim().replace(/^https?:\/\//, "").replace(/\/$/, ""))
    .filter(Boolean)
    .forEach((h) => list.add(h));
  return list;
}

function hostFrom(value) {
  if (!value) return "";
  try {
    return new URL(value).host;
  } catch (e) {
    return "";
  }
}

// True when the request plausibly comes from our own pages.
function originOk(req) {
  if (String(process.env.GATE_OFF || "") === "1") return true;
  const allowed = allowedHosts();
  if (allowed.has(hostFrom(req.headers.origin))) return true;
  // Some in-app browsers omit Origin on POSTs; fall back to Referer.
  if (!req.headers.origin && allowed.has(hostFrom(req.headers.referer))) return true;
  return false;
}

function gateKey() {
  if (process.env.GATE_SECRET) return process.env.GATE_SECRET;
  // Deterministic across instances, unknowable without the provider keys.
  return crypto
    .createHash("sha256")
    .update([process.env.GROQ_API_KEY, process.env.OPENROUTER_API_KEY, process.env.DEEPSEEK_API_KEY].join("|"))
    .digest("hex");
}

function sign(payload) {
  return crypto.createHmac("sha256", gateKey()).update(payload).digest("base64url");
}

function issueTicket() {
  const payload = Buffer.from(JSON.stringify({ t: Date.now() })).toString("base64url");
  return payload + "." + sign(payload);
}

function ticketOk(ticket) {
  if (String(process.env.GATE_OFF || "") === "1") return true;
  if (typeof ticket !== "string" || ticket.indexOf(".") < 0) return false;
  const [payload, sig] = [ticket.slice(0, ticket.lastIndexOf(".")), ticket.slice(ticket.lastIndexOf(".") + 1)];
  if (!payload || !sig) return false;
  let expected, data;
  try {
    expected = sign(payload);
    data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch (e) {
    return false;
  }
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  return typeof data.t === "number" && Date.now() - data.t <= TTL_MS && Date.now() - data.t >= -60000;
}

// One-call guard for POST endpoints. Returns false when the request is allowed;
// when true, a 403 has already been written.
function blocked(req, res, opts) {
  const o = opts || {};
  if (!originOk(req)) {
    res.status(403).json({ error: o.reason || "Request not allowed from this origin." });
    return true;
  }
  if (!o.skipTicket && !ticketOk(req.headers["x-gate"])) {
    res.status(403).json({ error: "Page verification missing or expired. Please reload and try again." });
    return true;
  }
  return false;
}

module.exports = { originOk, issueTicket, ticketOk, blocked };
