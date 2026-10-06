// Guard unit tests: origin check, ticket roundtrip, tamper, expiry, kill switch.
const path = require("path");
const root = path.join(__dirname, "..");
process.env.GROQ_API_KEY = "k1";
process.env.OPENROUTER_API_KEY = "k2";
delete process.env.GATE_SECRET;
delete process.env.GATE_OFF;

const guard = require(path.join(root, "lib", "guard.js"));

let fail = 0;
const check = (name, ok) => { if (!ok) fail++; console.log(ok ? "PASS" : "FAIL", name); };

const req = (origin, referer, ticket) => ({ headers: Object.assign({}, origin ? { origin } : {}, referer ? { referer } : {}, ticket ? { "x-gate": ticket } : {}) });

// origin
check("own origin allowed", guard.originOk(req("https://worksheet-ai-l1td.vercel.app")) === true);
check("localhost allowed", guard.originOk(req("http://localhost:3000")) === true);
check("custom domain via env", (process.env.ALLOWED_ORIGINS = "myworksheet.com", guard.originOk(req("https://myworksheet.com")) === true, delete process.env.ALLOWED_ORIGINS, true));
check("attacker origin blocked", guard.originOk(req("https://evil.example")) === false);
check("no origin + no referer blocked", guard.originOk(req()) === false);
check("no origin but own referer allowed", guard.originOk(req(null, "https://worksheet-ai-l1td.vercel.app/x")) === true);

// ticket roundtrip
const t = guard.issueTicket();
check("fresh ticket valid", guard.ticketOk(t) === true);
check("no ticket invalid", guard.ticketOk(undefined) === false);
check("garbage ticket invalid", guard.ticketOk("abc.def") === false);
check("tampered payload invalid", guard.ticketOk(Buffer.from(JSON.stringify({ t: Date.now() })).toString("base64url") + "." + t.split(".")[1]) === false);
check("truncated sig invalid", guard.ticketOk(t.slice(0, t.length - 4)) === false);

// expiry: pretend an hour passed
const realNow = Date.now;
Date.now = () => realNow() + 2 * 60 * 60 * 1000;
check("expired ticket rejected", guard.ticketOk(t) === false);
Date.now = realNow;
check("valid again after clock restore", guard.ticketOk(t) === true);

// kill switch
process.env.GATE_OFF = "1";
check("GATE_OFF disables origin check", guard.originOk(req()) === true);
check("GATE_OFF disables ticket check", guard.ticketOk("whatever") === true);
delete process.env.GATE_OFF;

// blocked() writes a 403 and returns true
let status = 0, body = "";
const fakeRes = { status(c) { status = c; return this; }, json(o) { body = JSON.stringify(o); return this; } };
check("blocked() 403s a bad request", guard.blocked(req("https://evil.example"), fakeRes) === true && status === 403 && body.indexOf("origin") >= 0);

console.log(fail === 0 ? "ALL PASS" : fail + " FAILURES");
process.exit(fail === 0 ? 0 : 1);
