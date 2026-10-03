// api/verify-license.js
// Verifies a Gumroad license key against the Gumroad Licenses API.
// POST { license_key } -> { valid: boolean }
//
// GUMROAD_PRODUCT_ID may contain several candidate ids separated by commas;
// we try each until one verifies (handles the permalink-vs-internal-id ambiguity).

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ valid: false, error: "Method not allowed" });
    return;
  }

  const { license_key } = req.body || {};
  if (!license_key) {
    res.status(400).json({ valid: false, error: "license_key required" });
    return;
  }

  const ids = String(process.env.GUMROAD_PRODUCT_ID || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!ids.length) {
    res.status(400).json({
      valid: false,
      error: "Server not configured: GUMROAD_PRODUCT_ID is missing.",
    });
    return;
  }

  let lastError = "";

  for (const productId of ids) {
    try {
      const params = new URLSearchParams({
        product_id: productId,
        license_key: String(license_key).trim(),
      });

      const r = await fetch("https://api.gumroad.com/v2/licenses/verify", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params,
      });

      const data = await r.json();
      if (data && data.success) {
        res.status(200).json({ valid: true });
        return;
      }
      lastError = (data && data.message) || "Invalid license key.";
    } catch (err) {
      lastError = "Server error: " + String(err);
    }
  }

  res.status(200).json({ valid: false, error: lastError || "Invalid license key." });
};
