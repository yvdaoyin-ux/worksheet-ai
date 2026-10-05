// api/verify-license.js
// Verifies a Gumroad license key and reports WHICH plan it unlocks.
// POST { license_key } -> { valid: boolean, plan: "pro" | "basic" }
//
// Tiers (as agreed with the owner):
//   Basic = one-time $6.93  -> unlimited MATH, 3 worksheets/day in other subjects
//   Pro   = monthly sub     -> everything unlimited + future features
//
// Env vars (Vercel):
//   GUMROAD_PRODUCT_ID      = Basic product id(s), comma-separated
//   GUMROAD_PRO_PRODUCT_ID  = Pro (subscription) product id(s), comma-separated
// Each list may hold several ids; they are tried until one verifies.

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

  const basicIds = splitIds(process.env.GUMROAD_PRODUCT_ID);
  const proIds = splitIds(process.env.GUMROAD_PRO_PRODUCT_ID);

  if (!basicIds.length && !proIds.length) {
    res.status(400).json({
      valid: false,
      error: "Server not configured: GUMROAD_PRODUCT_ID is missing.",
    });
    return;
  }

  let lastReason = "That key was not recognised.";

  // Pro first: a Pro key must never be downgraded to Basic.
  for (const tier of [
    { name: "pro", ids: proIds },
    { name: "basic", ids: basicIds },
  ]) {
    for (const productId of tier.ids) {
      try {
        const params = new URLSearchParams({
          product_id: productId,
          license_key: String(license_key).trim(),
          // never bump the use counter on every page load
          increment_uses_count: "false",
        });

        const r = await fetch("https://api.gumroad.com/v2/licenses/verify", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: params,
        });

        const data = await r.json();
        if (data && data.success) {
          // A Pro subscription that was cancelled / ended / failed must not keep Pro access.
          if (!isActive(data.purchase)) {
            lastReason = "That subscription is no longer active.";
            continue;
          }
          res.status(200).json({ valid: true, plan: tier.name });
          return;
        }
      } catch (err) {
        /* try the next candidate */
      }
    }
  }

  res.status(200).json({ valid: false, error: lastReason });
};

// False when refunded/charged back, or when the membership is no longer in good standing.
function isActive(purchase) {
  if (!purchase) return true;
  if (purchase.refunded || purchase.disputed || purchase.chargebacked) return false;
  const dead = ["subscription_cancelled_at", "subscription_ended_at", "subscription_failed_at"].some(
    (k) => {
      const v = purchase[k];
      return v !== null && v !== undefined && String(v).trim() !== "";
    }
  );
  return !dead;
}

function splitIds(v) {
  return String(v || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
