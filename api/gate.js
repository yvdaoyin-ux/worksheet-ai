// api/gate.js — hands out a short-lived signed ticket that /api/generate,
// /api/verify-license and /api/subscribe require as the x-gate header.
// Stateless (HMAC, no database). GET is enough: the browser only needs the
// ticket, and issuing one is cheap. See lib/guard.js for the design.
const { issueTicket } = require("../lib/guard");

module.exports = (req, res) => {
  if (req.method !== "GET" && req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  res.status(200).json({ ticket: issueTicket(), ttlMinutes: 90 });
};
