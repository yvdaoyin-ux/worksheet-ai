// api/ping-dashscope.js — measures the round-trip latency from INSIDE the Vercel
// function to Alibaba Cloud Model Studio (DashScope, cn-beijing).
//
// WHY THIS EXISTS:
// Every other latency number we have was measured from the developer's own PC
// through a local proxy. That number is useless for production: the real path is
// Vercel function -> dashscope.aliyuncs.com, and that is a cross-border hop.
// Guessing it would be exactly the kind of "should be fine" the project forbids.
//
// WHAT IT DOES NOT DO:
// - It never echoes the API key, the model's reply, or any header.
// - It only accepts GET and only sends a fixed 1-token prompt ("ping").
//   There is no user-controlled input, so it cannot be used as a free proxy.
// - Cost per call: roughly 20-30 tokens. Brushing it is harmless by design.
//
// STATE CODES (same three-state spirit as /api/health):
//   "ok"         every attempt succeeded        -> the hop is usable
//   "flaky"      some attempts failed           -> cross-border is unstable
//   "auth-error" 401/403                       -> key wrong, revoked or wrong region
//   "error"      all failed / network          -> treat as unusable
//   "unset"      DASHSCOPE_API_KEY missing
module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");

  if (req.method !== "GET") {
    return res.status(405).json({ error: "GET only" });
  }

  // Optional shared secret: set PING_SECRET in Vercel and call /api/ping-dashscope?s=...
  // Recommended, so the endpoint is not publicly probeable.
  const secret = process.env.PING_SECRET;
  if (secret && String(req.query.s || "") !== secret) {
    return res.status(403).json({ error: "forbidden" });
  }

  const key = process.env.DASHSCOPE_API_KEY;
  if (!key) {
    return res.status(200).json({
      configured: false,
      state: "unset",
      hint: "Vercel -> Settings -> Environment Variables -> add DASHSCOPE_API_KEY (new key) -> Redeploy.",
    });
  }

  const model = process.env.DASHSCOPE_MODEL || "deepseek-v4.1-flash";
  // Attempt count is clamped so a curious visitor cannot burn budget:
  const n = Math.min(Math.max(parseInt(req.query.n, 10) || 1, 1), 5);

  const attempts = [];
  for (let i = 0; i < n; i++) {
    const t0 = Date.now();
    try {
      const r = await fetch("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 1,
          temperature: 0,
        }),
        signal: AbortSignal.timeout(15000),
      });
      const j = await r.json().catch(() => null);
      let err = "";
      if (!r.ok) {
        err = (j && j.error && (j.error.code || j.error.message)) || "HTTP " + r.status;
        err = String(err).slice(0, 120); // never long enough to carry a secret
      }
      attempts.push({
        ms: Date.now() - t0,
        status: r.status,
        ok: r.ok,
        ...(err ? { err } : {}),
      });
    } catch (e) {
      const msg = String((e && e.message) || e);
      attempts.push({
        ms: Date.now() - t0,
        status: 0,
        ok: false,
        err: /timeout|abort/i.test(msg) ? "timeout" : "network failed",
      });
    }
  }

  const good = attempts.filter((a) => a.ok).map((a) => a.ms).sort((a, b) => a - b);
  let state = "error";
  if (good.length && good.length === attempts.length) state = "ok";
  else if (good.length) state = "flaky";
  else if (attempts[0] && (attempts[0].status === 401 || attempts[0].status === 403)) state = "auth-error";

  res.status(200).json({
    configured: true,
    state, // ok | flaky | auth-error | error
    model,
    region: "cn-beijing (dashscope.aliyuncs.com)",
    route: "Vercel function -> Alibaba Cloud (cross-border hop)",
    attempts, // per-attempt ms + status, most useful when something fails
    minMs: good.length ? good[0] : null,
    medianMs: good.length ? good[Math.floor(good.length / 2)] : null,
    verdict:
      state === "ok"
        ? good[good.length - 1] < 800
          ? "usable"
          : "usable but slow — expect the progress bar to stall"
        : state === "flaky"
        ? "unstable — do NOT put this in the critical path"
        : state === "auth-error"
        ? "key rejected — check it belongs to cn-beijing and is not deleted"
        : "unusable from this region right now",
  });
};
