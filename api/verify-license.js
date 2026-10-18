// api/verify-license.js
// Verifies a Gumroad license key and reports WHICH plan it unlocks.
// POST { license_key } -> { valid: boolean, plan: "pro" | "basic" }
//
// Guard: origin check only (no ticket) — this endpoint runs right after the
// Gumroad purchase redirect, before the page has fetched a ticket. It forwards
// to Gumroad's own rate-limited API, so key guessing dies there.
//
// Tiers (as agreed with the owner):
//   Basic     = one-time $13.30  -> unlimited MATH, 3 worksheets/day in other subjects
//   Pro       = monthly sub     -> everything unlimited + future features
//   Classroom = one-time $59    -> everything in Pro, for ONE teacher's class.
//                Reported to the front-end as "pro" (same unlimited rights);
//                the classroom SCOPE (one teacher, own class) lives in the
//                terms of the Gumroad product, not in code.
//
// Env vars (Vercel):
//   GUMROAD_PRODUCT_ID            = Basic product id(s), comma-separated
//   GUMROAD_PRO_PRODUCT_ID        = Pro (subscription) product id(s), comma-separated
//   GUMROAD_CLASSROOM_PRODUCT_ID  = Classroom product id(s), comma-separated
// Each list may hold several ids; they are tried until one verifies.

const guard = require("../lib/guard");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ valid: false, error: "Method not allowed" });
    return;
  }
  if (guard.blocked(req, res, { skipTicket: true })) return;

  const { license_key } = req.body || {};
  if (!license_key) {
    res.status(400).json({ valid: false, error: "license_key required" });
    return;
  }

  const basicIds = splitIds(process.env.GUMROAD_PRODUCT_ID);
  const proIds = splitIds(process.env.GUMROAD_PRO_PRODUCT_ID);
  const classroomIds = splitIds(process.env.GUMROAD_CLASSROOM_PRODUCT_ID);

  if (!basicIds.length && !proIds.length && !classroomIds.length) {
    res.status(400).json({
      valid: false,
      error: "Server not configured: GUMROAD_PRODUCT_ID is missing.",
    });
    return;
  }

  let lastReason = "That key was not recognised.";
  // Whether we actually got an ANSWER out of Gumroad at all.
  //
  // This distinction is the whole point of the tri-state response. Verify used
  // to report `{valid:false}` for every failure, including "Gumroad could not be
  // reached". The client treats valid:false as "this key is dead", deletes the
  // stored key, and then never retries (silentRecheck returns early when no key
  // is stored). So one network blip permanently downgraded a paying customer.
  // If any lookup failed to complete we say `uncertain` instead, and the client
  // leaves the plan and the key exactly as they were.
  let reachedGumroad = false;

  // Pro first: a Pro key must never be downgraded. Classroom also outranks Basic.
  // `label` is only what the buyer is TOLD they own — Classroom keeps identical
  // rights (the client maps both to the "pro" plan) but must not be described to
  // a $59 customer as "Pro", which is the $4.99/month product.
  for (const tier of [
    { name: "pro", label: "pro", ids: proIds },
    { name: "pro", label: "classroom", ids: classroomIds }, // Classroom == Pro rights, one-time
    { name: "basic", label: "basic", ids: basicIds },
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
        // A 5xx / rate-limit / gateway page is not an answer about THIS key.
        if (!r.ok) throw new Error("gumroad http " + r.status);

        const data = await r.json();
        reachedGumroad = true;
        if (data && data.success) {
          // A Pro subscription that was cancelled / ended / failed must not keep Pro access.
          if (!isActive(data.purchase)) {
            lastReason = "That subscription is no longer active.";
            continue;
          }
          res.status(200).json({ valid: true, plan: tier.name, label: tier.label });
          return;
        }
        if (data && data.message) lastReason = String(data.message).slice(0, 200);
      } catch (err) {
        /* try the next candidate */
      }
    }
  }

  // Never got a clean answer from Gumroad for any configured product: we do not
  // know, so we must not decide. 503 + uncertain keeps the customer's plan.
  if (!reachedGumroad) {
    res.status(503).json({
      valid: false,
      uncertain: true,
      error: "Could not reach the license server just now — your plan is unchanged and we'll check again later.",
    });
    return;
  }

  res.status(200).json({ valid: false, definitive: true, error: lastReason });
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
