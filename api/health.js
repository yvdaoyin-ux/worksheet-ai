// api/health.js — reports which providers/keys are configured (no secrets leaked).
// Open /api/health after a deploy to confirm env vars actually reached the function.
module.exports = (req, res) => {
  res.status(200).json({
    groq: !!process.env.GROQ_API_KEY,
    groqModels: process.env.GROQ_MODEL || "openai/gpt-oss-120b,openai/gpt-oss-20b",
    openrouter: !!process.env.OPENROUTER_API_KEY,
    deepseek: !!process.env.DEEPSEEK_API_KEY,
    deepseekModel: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
    gumroadProductId: !!process.env.GUMROAD_PRODUCT_ID, // Basic ($13.30)
    gumroadProProductId: !!process.env.GUMROAD_PRO_PRODUCT_ID, // Pro monthly
    track: true,
    answerCheck: process.env.SKIP_ANSWER_CHECK ? "off" : "on", // second-pass answer-key proofread
    subscribe: process.env.BUTTONDOWN_API_KEY || process.env.MAILERLITE_API_KEY ? true : "log-only",
    rateLimit: process.env.UPSTASH_REDIS_REST_URL ? "upstash" : "memory",
  });
};
