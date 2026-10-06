// api/health.js — reports which providers/keys are configured (no secrets leaked).
// Open /api/health after a deploy to confirm env vars actually reached the function.
//
// WHY THIS DEEP-CHECKS UPSTASH:
// "UPSTASH_REDIS_REST_URL is set" is NOT the same as "Upstash works".
// api/generate.js swallows Upstash errors and falls back to a per-instance
// in-memory counter — so a typo'd token, a revoked database or a URL pasted into
// the wrong variable all look IDENTICAL to a healthy setup. Since the whole point
// of Upstash is that GLOBAL_DAILY_BUDGET becomes a real site-wide ceiling, that
// silent fallback is exactly the failure you must be able to see.
//   "upstash"        -> configured AND reachable  (the ceiling is real)
//   "upstash-error"  -> configured but the call failed (silently degraded!)
//   "memory"         -> not configured at all
// The probe is a read-only GET of a key that never exists. No secrets are echoed;
// rateLimitError only ever carries an HTTP status or a generic reason.
module.exports = async (req, res) => {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  let rateLimit = "memory";
  let rateLimitError = "";
  if (url && token) {
    rateLimit = "upstash";
    try {
      const r = await fetch(url.replace(/\/$/, "") + "/get/wsai-health-probe", {
        headers: { Authorization: "Bearer " + token },
        signal: AbortSignal.timeout(5000),
      });
      if (!r.ok) { rateLimit = "upstash-error"; rateLimitError = "HTTP " + r.status; }
    } catch (e) {
      rateLimit = "upstash-error";
      rateLimitError = /timeout|abort/i.test(String(e && e.message)) ? "timeout" : "request failed";
    }
  }
  res.status(200).json({
    groq: !!process.env.GROQ_API_KEY,
    groqModels: process.env.GROQ_MODEL || "openai/gpt-oss-120b,openai/gpt-oss-20b",
    openrouter: !!process.env.OPENROUTER_API_KEY,
    deepseek: !!process.env.DEEPSEEK_API_KEY,
    deepseekModel: process.env.DEEPSEEK_MODEL || "deepseek-flash,deepseek-v4-flash",
    gumroadProductId: !!process.env.GUMROAD_PRODUCT_ID, // Basic ($13.30)
    gumroadProProductId: !!process.env.GUMROAD_PRO_PRODUCT_ID, // Pro monthly
    gumroadClassroomProductId: !!process.env.GUMROAD_CLASSROOM_PRODUCT_ID, // Classroom ($59 once)
    mailerliteGroupId: !!process.env.MAILERLITE_GROUP_ID,
    track: true,
    answerCheck: process.env.SKIP_ANSWER_CHECK ? "off" : "on", // second-pass answer-key proofread
    subscribe: process.env.BUTTONDOWN_API_KEY || process.env.MAILERLITE_API_KEY ? true : "log-only",
    gate: String(process.env.GATE_OFF || "") === "1" ? "off" : "on",
    rateLimit, // "upstash" | "upstash-error" | "memory" — see the note above
    rateLimitError, // "" when healthy; an HTTP status or generic reason otherwise
  });
};
