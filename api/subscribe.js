// api/subscribe.js
// Email capture. POST { email } -> { ok: true }
//
// Without a mail provider configured the address is still recorded to the
// function log (Vercel -> Logs -> search "[wsai-sub]"), so no lead is lost
// while you decide on a provider.
//
// To make it really send, add ONE of these to Vercel env vars (and Redeploy):
//   BUTTONDOWN_API_KEY=...          (Buttondown, free tier fine)
//   MAILERLITE_API_KEY=... + MAILERLITE_GROUP_ID=...

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const email = String((req.body || {}).email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 200) {
    res.status(400).json({ ok: false, error: "That email doesn't look right." });
    return;
  }

  const source = String((req.body || {}).source || "").slice(0, 40);
  console.log("[wsai-sub]", JSON.stringify({ t: new Date().toISOString(), email, source }));

  const provider =
    process.env.BUTTONDOWN_API_KEY
      ? "buttondown"
      : process.env.MAILERLITE_API_KEY
      ? "mailerlite"
      : "log-only";

  try {
    if (provider === "buttondown") {
      const r = await fetch("https://api.buttondown.email/v1/subscribers", {
        method: "POST",
        headers: {
          Authorization: `Token ${process.env.BUTTONDOWN_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email_address: email, tags: ["worksheet-pack"] }),
      });
      // Buttondown returns 201 (new) or 200 (already subscribed) — both are fine.
      if (!r.ok && r.status !== 400) {
        const txt = await r.text();
        console.log("[wsai-sub] buttondown error", r.status, txt.slice(0, 200));
      }
    } else if (provider === "mailerlite") {
      const r = await fetch("https://connect.mailerlite.com/api/subscribers", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.MAILERLITE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          groups: process.env.MAILERLITE_GROUP_ID ? [process.env.MAILERLITE_GROUP_ID] : [],
        }),
      });
      if (!r.ok) {
        const txt = await r.text();
        console.log("[wsai-sub] mailerlite error", r.status, txt.slice(0, 200));
      }
    }
  } catch (e) {
    console.log("[wsai-sub] provider failed", String(e));
  }

  res.status(200).json({ ok: true, provider });
};
