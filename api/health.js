// api/health.js — reports which AI providers are configured (no secrets leaked).
module.exports = (req, res) => {
  res.status(200).json({
    groq: !!process.env.GROQ_API_KEY,
    groqModels: process.env.GROQ_MODEL || "openai/gpt-oss-120b,openai/gpt-oss-20b",
    openrouter: !!process.env.OPENROUTER_API_KEY,
    gumroadProductId: !!process.env.GUMROAD_PRODUCT_ID,
  });
};
