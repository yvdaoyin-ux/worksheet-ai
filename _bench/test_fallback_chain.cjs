// Fallback chain test: free tiers first, DeepSeek V4.1 Flash last; a full chain
// with every key set must try Groq -> OpenRouter -> DeepSeek in that order.
const path = require("path");
const root = path.join(__dirname, "..");
process.env.GROQ_API_KEY = "test";
process.env.OPENROUTER_API_KEY = "test";
process.env.DEEPSEEK_API_KEY = "test";
delete process.env.DEEPSEEK_MODEL;
delete process.env.GROQ_MODEL;
const { _buildAttempts } = require(path.join(root, "api", "generate.js"));

const attempts = _buildAttempts();
const chain = attempts.map((a) => a.model);
console.log("chain:", chain.join(" -> "));

let fail = 0;
const expect = [
  "openai/gpt-oss-120b", "openai/gpt-oss-20b",            // Groq (free)
  "nvidia/nemotron-3-super-120b-a12b:free", "openrouter/free", // OpenRouter (free)
  "deepseek-flash",                                        // DeepSeek V4.1 Flash
  "deepseek-v4-flash",                                     // V4 fallback name
];
if (chain.length !== expect.length) { console.log("FAIL length", chain.length); fail++; }
expect.forEach((m, i) => { if (chain[i] !== m) { console.log("FAIL at", i, "want", m, "got", chain[i]); fail++; } });
const ds = attempts.find((a) => a.model === "deepseek-flash");
if (!ds || ds.url !== "https://api.deepseek.com/chat/completions") { console.log("FAIL deepseek url"); fail++; }

// without DEEPSEEK_API_KEY the chain must stop after the free tiers
delete process.env.DEEPSEEK_API_KEY;
const freeOnly = _buildAttempts().map((a) => a.model);
if (freeOnly.some((m) => m.indexOf("deepseek") >= 0)) { console.log("FAIL: deepseek present without key"); fail++; }
console.log(fail === 0 ? "ALL PASS" : fail + " FAILURES");
process.exit(fail === 0 ? 0 : 1);
