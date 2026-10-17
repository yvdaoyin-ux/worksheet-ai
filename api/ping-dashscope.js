// api/ping-dashscope.js — measures the round-trip latency from INSIDE the Vercel
// function to three targets, so "slow" can be attributed instead of guessed:
//
//   dashscope.aliyuncs.com       (cn-beijing, the production candidate)
//   dashscope-intl.aliyuncs.com  (international gateway, Singapore/global)
//   api.github.com               (US baseline — proves whether the function's
//                                 egress is slow in general or China specifically)
//
// WHY THE BASELINE MATTERS:
// A single "3122ms" number is uninterpretable. It could be a cold start, a slow
// cross-border hop, or the function's whole network path. Measuring all three on
// the SAME warm invocation removes that ambiguity: the difference between the
// China and the US target is the real cross-border cost.
//
// WHAT IT DOES NOT DO:
// - Never echoes the API key, the model's reply, or any request header.
// - Only accepts GET. The only paid call is one fixed 1-token "ping" to the
//   China endpoint (the other two are free GETs).
//
// STATE CODES: "ok" | "flaky" | "auth-error" | "error" | "unset"
//
// HISTORY:
// v1 read `req.query.s`, which may be absent on a plain Vercel Node function —
// a correct ?s= compared against undefined and returned 403 forever. We now parse
// req.url ourselves. 403 carries length-only diagnostics (never values) so a
// trailing space in the dashboard is visible instead of mysterious.
const CN = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
const INTL_MODELS = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/models";
const US = "https://api.github.com/zen";

async function timeGet(url) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { headers: { "User-Agent": "wsai-latency-probe" }, signal: AbortSignal.timeout(15000) });
    await r.arrayBuffer(); // drain so the timing includes the body
    return { ms: Date.now() - t0, status: r.status, ok: true };
  } catch (e) {
    const m = String((e && e.message) || e);
    return { ms: Date.now() - t0, status: 0, ok: false, err: /timeout|abort/i.test(m) ? "timeout" : "network failed" };
  }
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });

  let url;
  try { url = new URL(req.url || "/", "http://placeholder.local"); }
  catch { url = new URL("http://placeholder.local/"); }
  const q = (k) => {
    const a = req.query && req.query[k] !== undefined ? req.query[k] : undefined;
    const v = a !== undefined ? a : url.searchParams.get(k);
    return v === undefined || v === null ? null : String(v);
  };

  const secret = process.env.PING_SECRET;
  const provided = q("s");
  if (secret && provided !== secret) {
    return res.status(403).json({
      error: "forbidden",
      diag: {
        secretIsConfigured: true,
        secretLen: secret.length,
        receivedS: provided !== null,
        receivedLen: provided ? provided.length : 0,
        hint:
          provided === null
            ? "URL had no ?s= at all."
            : provided.length !== secret.length
            ? "Length differs: trailing space/newline in the dashboard value, or the URL was truncated."
            : "Same length, different value: the deployed env var may be stale (changing env vars needs a Redeploy).",
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
  const n = Math.min(Math.max(Number.isFinite(nRaw) ? nRaw : 1, 1), 3); // each round costs 3 network calls

  const rounds = [];
  for (let i = 0; i < n; i++) {
    // --- paid call: the actual production candidate ---
    const t0 = Date.now();
    let cn;
    try {
      const r = await fetch(CN, {
        method: "POST",
        headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages: [{ role: "user", content: "ping" }], max_tokens: 1, temperature: 0 }),
        signal: AbortSignal.timeout(15000),
      });
      const j = await r.json().catch(() => null);
      let err = "";
      if (!r.ok) {
        err = String(((j && j.error && (j.error.code || j.error.message)) || "HTTP " + r.status)).slice(0, 120);
      }
      cn = { ms: Date.now() - t0, status: r.status, ok: r.ok, ...(err ? { err } : {}) };
    } catch (e) {
      const m = String((e && e.message) || e);
      cn = { ms: Date.now() - t0, status: 0, ok: false, err: /timeout|abort/i.test(m) ? "timeout" : "network failed" };
    }
    // --- free GETs: same-way-out comparison ---
    const intl = await timeGet(INTL_MODELS);
    const us = await timeGet(US);
    rounds.push({ cn, intl, us });
  }

  const pick = (k) => rounds.map((r) => r[k]).filter((x) => x && x.ok).map((x) => x.ms).sort((a, b) => a - b);
  const cnOk = pick("cn"), intlOk = pick("intl"), usOk = pick("us");
  const med = (a) => (a.length ? a[Math.floor(a.length / 2)] : null);

  let state = "error";
  if (cnOk.length && cnOk.length === rounds.length) state = "ok";
  else if (cnOk.length) state = "flaky";
  else if (rounds[0] && rounds[0].cn && (rounds[0].cn.status === 401 || rounds[0].cn.status === 403)) state = "auth-error";

  const cnMed = med(cnOk), intlMed = med(intlOk), usMed = med(usOk);
  const crossBorderCost = cnMed !== null && usMed !== null ? cnMed - usMed : null;

  res.status(200).json({
    configured: true,
    state,
    model,
    rounds,
    summary: {
      chinaDashscope_medianMs: cnMed,
      intlDashscope_medianMs: intlMed,
      usBaseline_medianMs: usMed,
      crossBorderCostMs: crossBorderCost, // china - US baseline: the part you pay for going to China
    },
    verdict:
      state !== "ok"
        ? "not usable as-is"
        : cnMed === null
        ? "no successful China call"
        : crossBorderCost !== null && usMed !== null && usMed < 300 && cnMed > 1500
        ? "China hop is the problem (US baseline is fast) — use the international endpoint or drop it"
        : cnMed > 1500
        ? "egress from this function is slow in general — investigate cold start / region"
        : cnMed < 800
        ? "usable"
        : "usable but slow — progress bar will stall",
  });
};
