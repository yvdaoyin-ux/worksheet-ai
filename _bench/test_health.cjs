// _bench/test_health.cjs
//
// /api/health must tell apart three states, not two:
//   "memory"        -> Upstash not configured
//   "upstash-error" -> configured but the call FAILS  <-- the one that matters
//   "upstash"       -> configured and reachable
//
// Why this test exists: api/generate.js swallows Upstash errors and falls back to
// a per-instance in-memory counter. So a typo'd token, a revoked database or a URL
// pasted into the wrong variable all USED to report "upstash" — i.e. the health
// endpoint said "the daily budget is a hard global ceiling" while it was not.
// A silently degraded rate limiter is worse than an obviously missing one.
//
// Offline-safe: the "bad" targets here fail fast without needing the network.
// Run: node _bench/test_health.cjs

const path = require("path");
const health = require(path.join(__dirname, "..", "api", "health.js"));

const call = async () => {
  let body = null;
  const res = { status() { return this; }, json(o) { body = o; return this; } };
  await health({ method: "GET", headers: {} }, res);
  return body || {};
};

let pass = 0;
const fails = [];
const check = (name, ok, extra) => {
  if (ok) { pass++; console.log("PASS", name); }
  else { fails.push(name); console.log("FAIL", name, extra === undefined ? "" : "| " + extra); }
};

(async () => {
  const savedUrl = process.env.UPSTASH_REDIS_REST_URL;
  const savedTok = process.env.UPSTASH_REDIS_REST_TOKEN;
  const restore = () => {
    if (savedUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL; else process.env.UPSTASH_REDIS_REST_URL = savedUrl;
    if (savedTok === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN; else process.env.UPSTASH_REDIS_REST_TOKEN = savedTok;
  };

  try {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    let r = await call();
    check("not configured -> memory", r.rateLimit === "memory", JSON.stringify(r.rateLimit));
    check("not configured -> no error text", r.rateLimitError === "", JSON.stringify(r.rateLimitError));

    // URL present but nothing listening: must NOT be reported as healthy.
    process.env.UPSTASH_REDIS_REST_URL = "http://127.0.0.1:9";
    process.env.UPSTASH_REDIS_REST_TOKEN = "bad-token";
    r = await call();
    check("unreachable -> upstash-error (NOT 'upstash')", r.rateLimit === "upstash-error", JSON.stringify(r.rateLimit));
    check("error is reported without echoing secrets", typeof r.rateLimitError === "string" && r.rateLimitError.length > 0 && r.rateLimitError.indexOf("bad-token") < 0, JSON.stringify(r.rateLimitError));

    // URL present but rejected (offline this still fails -> upstash-error, which is fine)
    process.env.UPSTASH_REDIS_REST_URL = "https://example.invalid";
    r = await call();
    check("bad host -> upstash-error", r.rateLimit === "upstash-error", JSON.stringify(r.rateLimit));

    check("still reports the other env checks", r.groq !== undefined && r.gate !== undefined && r.answerCheck !== undefined);
  } finally {
    restore();
  }

  console.log("\nhealth checks: " + pass + "/" + (pass + fails.length) + " passed");
  if (fails.length) { console.log("FAILED:"); fails.forEach((f) => console.log("  - " + f)); process.exit(1); }
  console.log("ALL PASS");
})().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
