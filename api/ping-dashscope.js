// api/ping-dashscope.js — measures the round-trip latency from INSIDE the Vercel
// function to Alibaba Cloud Model Studio (DashScope, cn-beijing).
//
// WHY THIS EXISTS:
// Every latency number we have was measured from the developer's own PC through a
// local proxy. That number is useless for production: the real path is
// Vercel function -> dashscope.aliyuncs.com, and that is a cross-border hop.
//
// WHAT IT DOES NOT DO:
// - Never echoes the API key, the model's reply, or any request header.
// - Only accepts GET and only sends a fixed 1-token prompt ("ping").
//   No user-controlled input, so it cannot be used as a free proxy.
// - Cost per call: roughly 20-30 tokens.
//
// STATE CODES (same three-state spirit as /api/health):
//   "ok" | "flaky" | "auth-error" | "error" | "unset"
//
// HISTORY / WHY THE QUERY PARSING LOOKS DEFENSIVE:
// The first version read `req.query.s`. On a plain Vercel Node function `req` is
// a Node IncomingMessage which does NOT always carry `.query` — so a correct
// `?s=...` still compared against `undefined` and returned 403 forever.
// We now parse `req.url` ourselves and treat `req.query` as an optional bonus.
// The 403 body also carries non-secret diagnostics (lengths only) so a mismatch
// caused by a trailing space in the dashboard is visible instead of mysterious.
module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");

  if (req.method !== "GET") {
    return res.status(405).json({ error: "GET only" });
  }

  // --- query parsing that does not depend on req.query existing ---
  let url;
  try {
    url = new URL(req.url || "/", "http://placeholder.local");
  } catch {
    url = new URL("http://placeholder.local/");
  }
  const q = (k) => {
    const fromQuery = req.query && req.query[k] !== undefined ? req.query[k] : undefined;
    const v = fromQuery !== undefined ? fromQuery : url.searchParams.get(k);
    return v === undefined || v === null ? null : String(v);
  };

  const secret = process.env.PING_SECRET;
  const provided = q("s");

  if (secret && provided !== secret) {
    // Diagnostics: lengths only. Never the value, never a prefix.
    return res.status(403).json({
      error: "forbidden",
      diag: {
        secretIsConfigured: true,
        secretLen: secret.length,
        receivedS: provided !== null,
        receivedLen: provided ? provided.length : 0,
        hint:
          provided === null
            ? "URL had no ?s= at all (check that the query string survived the browser / copy-paste)."
            : provided.length !== secret.length
            ? "Length differs: the dashboard value may have a trailing space/newline, or the URL was truncated."
            : "Same length but different value: the deployed env var may be an older value (change env vars needs a Redeploy).",
      },
    });
  }

  const key = process.env.DASHSCOPE_API_KEY;
  if (!key) {
    return res.status(200).json({
      configured: false,
      state: "unset",
      hint: "Vercel -> Settings -> Environment Variables -> add DASHSCOPE_API_KEY -> Redeploy.",
    });
  }

  const model = process.env.DASHSCOPE_MODEL || "deepseek-v4.1-flash";
  const nRaw = parseInt(q("n"), 10);
  const n = Math.min(Math.max(Number.isFinite(nRaw) ? nRaw : 1, 1), 5); // cost guard

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
      attempts.push({ ms: Date.now() - t0, status: r.status, ok: r.ok, ...(err ? { err } : {}) });
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
    attempts,
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
