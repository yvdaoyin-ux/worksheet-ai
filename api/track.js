// api/track.js
// Minimal, dependency-free analytics.
// POST { event, props, path, ref } -> { ok: true }
//
// Why this exists: Vercel's dashboard shows pageviews but NOT product events
// (did the free quota run out? was the paywall opened? was Buy clicked?).
// Until a real analytics product is wired in, every event is logged to the
// function log (visible in Vercel -> Project -> Logs) so the funnel is measurable.
//
// Optional upgrade (no code change needed): set PLAUSIBLE_DOMAIN + PLAUSIBLE_API_KEY
// as Vercel env vars and events are forwarded to Plausible as well.

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const body = req.body || {};
  const event = String(body.event || "").slice(0, 64);
  if (!event) {
    res.status(400).json({ error: "event required" });
    return;
  }

  const ip =
    (String(req.headers["x-forwarded-for"] || "").split(",")[0] || "").trim() ||
    req.headers["x-real-ip"] ||
    "unknown";

  const record = {
    t: new Date().toISOString(),
    event,
    path: String(body.path || "").slice(0, 200),
    ref: String(body.ref || "").slice(0, 200),
    ua: String(req.headers["user-agent"] || "").slice(0, 160),
    country: req.headers["x-vercel-ip-country"] || "",
    ipHash: hash(ip),
    props: safeProps(body.props),
  };

  // Primary sink: function log (grep-able, free, no vendor).
  console.log("[wsai-track]", JSON.stringify(record));

  // Optional sink: Plausible (only if configured).
  const domain = process.env.PLAUSIBLE_DOMAIN;
  const apiKey = process.env.PLAUSIBLE_API_KEY;
  if (domain && apiKey) {
    try {
      await fetch("https://plausible.io/api/event", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "User-Agent": req.headers["user-agent"] || "worksheet-ai",
          "X-Forwarded-For": ip,
        },
        body: JSON.stringify({
          domain,
          name: event,
          url: `https://${domain}${record.path || "/"}`,
          referrer: record.ref || "",
          props: record.props,
        }),
      });
    } catch (e) {
      console.log("[wsai-track] plausible failed", String(e));
    }
  }

  res.status(200).json({ ok: true });
};

function safeProps(p) {
  if (!p || typeof p !== "object") return {};
  const out = {};
  Object.keys(p).slice(0, 12).forEach((k) => {
    const v = p[k];
    if (typeof v === "string") out[k] = v.slice(0, 120);
    else if (typeof v === "number" || typeof v === "boolean") out[k] = v;
  });
  return out;
}

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return "h" + (h >>> 0).toString(36);
}
